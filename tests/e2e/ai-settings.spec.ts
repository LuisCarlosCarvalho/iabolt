import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] Painel «Configurações de IA» no browser, em modo local: a mesma lógica da função
 * ai-admin corre em memória com um fornecedor SIMULADO. Nada sai do browser. A autorização no
 * servidor e o cofre estão provados em tests/db/ai_settings.test.ts e tests/unit/aiAdmin.test.ts.
 */
const KEY_A = 'sk-teste-chave-valida-000000000000AAAA';
const KEY_BAD = 'sk-teste-chave-invalida-00000000000XXXX';

/** Tudo o que a página guarda ou mostra (texto, campos, armazenamento). */
const everything = (page: Page) =>
  page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input, textarea, select')].map((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : ''));
    const storage = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`);
    return [document.body.innerText, document.documentElement.outerHTML, ...inputs, ...storage(localStorage), ...storage(sessionStorage)].join('\n');
  });

test('[simulado] configurar a IA pelo painel: chave, teste sem custo, ativar, substituição recusada, modelo, limites, consumo, remover', async ({ page }) => {
  test.setTimeout(90_000);
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(u.hostname);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('nav-ai-settings').click();
  await expect(page).toHaveURL(/\/configuracoes\/ia$/);
  await expect(page.getByTestId('ai-settings-simulated')).toBeVisible();

  // Por omissão: desativado, sem chave, não se pode ativar.
  await expect(page.getByTestId('ai-key-status')).toContainText('Sem chave');
  await expect(page.getByTestId('ai-enabled')).not.toBeChecked();
  await expect(page.getByTestId('ai-enabled')).toBeDisabled();
  await expect(page.getByTestId('ai-provider')).toHaveValue('anthropic');
  await expect(page.getByTestId('ai-model')).toHaveValue('claude-sonnet-5-5');

  // Guardar a chave: testada sem custo antes de ficar ativa; nunca volta à página.
  const input = page.getByTestId('ai-key-input');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(KEY_A);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Chave guardada (…AAAA): o fornecedor reconheceu a chave e o modelo');
  await expect(page.getByTestId('ai-key-status')).toContainText('Chave configurada');
  await expect(page.getByTestId('ai-key-status')).toContainText('…AAAA');
  await expect(input).toHaveValue('');
  expect(await everything(page)).not.toContain(KEY_A);

  // Testar ligação (ação explícita, sem custo).
  await expect(page.getByTestId('ai-key-test')).toContainText('sem custo');
  await page.getByTestId('ai-key-test').click();
  await expect(page.getByTestId('ai-key-test-result')).toContainText('A geração só fica comprovada no piloto');
  await expect(page.getByTestId('ai-key-test-result')).toContainText('Sem custo');

  // Ativar.
  await page.getByTestId('ai-enabled').check();
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');

  // Substituição recusada: mantém a anterior e o assistente ativo.
  await input.fill(KEY_BAD);
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Mantém-se a chave anterior (…AAAA)');
  await expect(page.getByTestId('ai-key-status')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  expect(await everything(page)).not.toContain(KEY_BAD);

  // Modelo (só os suportados) e preços usados nas reservas.
  await page.getByTestId('ai-model').selectOption({ label: 'Claude Haiku 4.5' });
  await expect(page.getByTestId('ai-model-prices')).toContainText('entrada 1');
  await page.getByTestId('ai-model-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');

  // Limites e orçamento.
  await page.getByTestId('ai-limit-monthly_budget_usd').fill('40');
  await page.getByTestId('ai-limit-requests_per_user_day').fill('20');
  await page.getByTestId('ai-limits-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');
  await expect(page.getByTestId('ai-limit-monthly_budget_usd')).toHaveValue('40');

  // Consumo do mês: confirmado, estimado (desconhecido) e reservado em separado.
  await expect(page.getByTestId('ai-usage-confirmed')).toContainText('Consumo confirmado');
  await expect(page.getByTestId('ai-usage-unknown')).toContainText('consumo desconhecido');
  await expect(page.getByTestId('ai-usage-reserved')).toContainText('Reservado');
  await expect(page.getByTestId('ai-usage-remaining')).toContainText('40,00 USD');

  // Remover: confirmação; desativa.
  await page.getByTestId('ai-key-remove').click();
  await page.getByTestId('ai-key-remove-confirm').click();
  await expect(page.getByTestId('ai-key-status')).toContainText('Sem chave');
  await expect(page.getByTestId('ai-enabled')).not.toBeChecked();

  // Registo: quem e quando, sem segredos.
  const entries = page.getByTestId('ai-audit-entry');
  await expect(entries.first()).toContainText('Chave removida');
  expect(await entries.count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId('ai-audit-list')).toContainText('Chave nova recusada');
  await expect(page.getByTestId('ai-audit-list')).toContainText('administrador local (simulação)');
  const final = await everything(page);
  expect(final).not.toContain(KEY_A);
  expect(final).not.toContain(KEY_BAD);
  // Nada saiu do browser (simulação local).
  expect(external).toEqual([]);
});
