import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] Painel «Configurações de IA» no browser, em modo local: a mesma lógica da função
 * ai-admin corre em memória com fornecedores SIMULADOS. Nada sai do browser. A autorização no
 * servidor e o cofre estão provados em tests/db/ e tests/unit/aiAdmin.test.ts.
 */
const KEY_A = 'sk-teste-chave-valida-000000000000AAAA';
const KEY_BAD = 'sk-teste-chave-invalida-00000000000XXXX';
const KEY_OPENAI = 'sk-teste-openai-valida-00000000000OOOO';
const KEY_GOOGLE = 'AIza-teste-google-valida-000000000GGGG';

/** Tudo o que a página guarda ou mostra (texto, campos, armazenamento). */
const everything = (page: Page) =>
  page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input, textarea, select')].map((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : ''));
    const storage = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k) ?? ''}`);
    return [document.body.innerText, document.documentElement.outerHTML, ...inputs, ...storage(localStorage), ...storage(sessionStorage)].join('\n');
  });

function watchExternal(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(u.hostname);
  });
  return external;
}

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('nav-ai-settings').click();
  await expect(page).toHaveURL(/\/configuracoes\/ia$/);
  await expect(page.getByTestId('ai-settings-simulated')).toBeVisible();
}

async function saveKey(page: Page, provider: string, key: string) {
  const input = page.getByTestId(`ai-key-input-${provider}`);
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(key);
  await page.getByTestId(`ai-key-save-${provider}`).click();
}

test('[simulado] configurar a IA pelo painel: chave, teste sem custo, ativar, substituição recusada, modelo, limites, consumo, remover', async ({ page }) => {
  test.setTimeout(90_000);
  const external = watchExternal(page);
  await openSettings(page);

  // Por omissão: desativado, sem chaves, não se pode ativar. Só os três fornecedores implementados.
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Sem chave');
  await expect(page.getByTestId('ai-provider').locator('option')).toHaveText([/Anthropic/, /OpenAI/, /Google Gemini/]);
  await expect(page.getByTestId('ai-enabled')).not.toBeChecked();
  await expect(page.getByTestId('ai-enabled')).toBeDisabled();
  await expect(page.getByTestId('ai-provider')).toHaveValue('anthropic');
  await expect(page.getByTestId('ai-model')).toHaveValue('claude-sonnet-5-5');

  // Guardar a chave: testada sem custo antes de ficar ativa; nunca volta à página.
  await saveKey(page, 'anthropic', KEY_A);
  await expect(page.getByTestId('ai-settings-message')).toContainText('Chave Anthropic guardada (…AAAA). Credenciais reconhecidas');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Chave configurada');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-key-input-anthropic')).toHaveValue('');
  expect(await everything(page)).not.toContain(KEY_A);

  // Testar ligação (ação explícita, sem custo). Credenciais ≠ geração validada.
  await expect(page.getByTestId('ai-key-test-anthropic')).toContainText('sem custo');
  await page.getByTestId('ai-key-test-anthropic').click();
  await expect(page.getByTestId('ai-key-test-result-anthropic')).toContainText('Isto não comprova a geração');
  await expect(page.getByTestId('ai-key-test-result-anthropic')).toContainText('Sem custo');
  await expect(page.getByTestId('ai-cred-anthropic')).toContainText('Reconhecidas');
  await expect(page.getByTestId('ai-gen-anthropic')).toContainText('Por validar');
  await expect(page.getByTestId('ai-check-key')).toContainText('Reconhecidas');
  await expect(page.getByTestId('ai-check-generation')).toContainText('Por validar');

  // Ativar.
  await page.getByTestId('ai-enabled').check();
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');

  // Substituição recusada: mantém a anterior e o assistente ativo.
  await saveKey(page, 'anthropic', KEY_BAD);
  await expect(page.getByTestId('ai-settings-message')).toContainText('Mantém-se a chave anterior (…AAAA)');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  expect(await everything(page)).not.toContain(KEY_BAD);

  // Modelo (só os suportados do fornecedor) e preços usados nas reservas.
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

  // Consumo do mês: confirmado, estimado (desconhecido), reservado e imagens em separado.
  await expect(page.getByTestId('ai-usage-confirmed')).toContainText('Consumo confirmado');
  await expect(page.getByTestId('ai-usage-unknown')).toContainText('consumo desconhecido');
  await expect(page.getByTestId('ai-usage-reserved')).toContainText('Reservado');
  await expect(page.getByTestId('ai-usage-images')).toContainText('Imagens');
  await expect(page.getByTestId('ai-usage-remaining')).toContainText('40,00 USD');

  // Remover: confirmação; desativa.
  await page.getByTestId('ai-key-remove-anthropic').click();
  await page.getByTestId('ai-key-remove-confirm').click();
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Sem chave');
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
  expect(external).toEqual([]);
});

test('[simulado] vários fornecedores: chaves independentes, trocar o fornecedor de edição preserva as chaves, imagens com modelo próprio', async ({ page }) => {
  test.setTimeout(90_000);
  const external = watchExternal(page);
  await openSettings(page);

  await saveKey(page, 'anthropic', KEY_A);
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await saveKey(page, 'openai', KEY_OPENAI);
  await expect(page.getByTestId('ai-key-status-openai')).toContainText('…OOOO');
  // OpenAI: o teste sem custo confirma só credenciais (sem verificação de formato).
  await expect(page.getByTestId('ai-key-test-result-openai')).toContainText('O formato do pedido e a geração só ficam comprovados');
  await saveKey(page, 'google', KEY_GOOGLE);
  await expect(page.getByTestId('ai-key-status-google')).toContainText('…GGGG');

  // Edição: passar para Google Gemini e ativar.
  await page.getByTestId('ai-provider').selectOption('google');
  await expect(page.getByTestId('ai-model').locator('option')).toHaveText(['Gemini 3.5 Flash-Lite', 'Gemini 3.8 Flash']);
  await page.getByTestId('ai-model').selectOption({ label: 'Gemini 3.8 Flash' });
  await expect(page.getByTestId('ai-model-prices')).toContainText('01/01/2027');
  await page.getByTestId('ai-model-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');
  await page.getByTestId('ai-enabled').check();
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  await expect(page.getByTestId('ai-check-generation')).toContainText('Gemini 3.8 Flash');
  await expect(page.getByTestId('ai-provider-google')).toContainText('em uso: edição');
  // As outras chaves continuam configuradas.
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-key-status-openai')).toContainText('…OOOO');

  // Voltar à Anthropic: a chave Google fica guardada.
  await page.getByTestId('ai-provider').selectOption('anthropic');
  await page.getByTestId('ai-model').selectOption({ label: 'Claude Sonnet 5.5' });
  await page.getByTestId('ai-model-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');
  await expect(page.getByTestId('ai-key-status-google')).toContainText('…GGGG');

  // Imagens: fornecedor e modelo próprios, custo por imagem visível; ativar.
  await page.getByTestId('ai-image-provider').selectOption('google');
  await page.getByTestId('ai-image-model').selectOption({ label: 'Gemini 3.1 Flash Image' });
  await expect(page.getByTestId('ai-image-price')).toContainText('0,067 USD');
  await page.getByTestId('ai-image-save').click();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Configurações guardadas');
  await page.getByTestId('ai-image-enabled').check();
  await expect(page.getByTestId('ai-image-enabled')).toBeChecked();
  await expect(page.getByTestId('ai-image-generation')).toContainText('por validar');
  await expect(page.getByTestId('ai-provider-google')).toContainText('em uso: imagens');

  // Remover a chave Google desativa só as imagens; a edição (Anthropic) continua ativa.
  await page.getByTestId('ai-key-remove-google').click();
  await page.getByTestId('ai-key-remove-confirm').click();
  await expect(page.getByTestId('ai-image-enabled')).not.toBeChecked();
  await expect(page.getByTestId('ai-enabled')).toBeChecked();
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-key-status-openai')).toContainText('…OOOO');

  const final = await everything(page);
  for (const k of [KEY_A, KEY_OPENAI, KEY_GOOGLE]) expect(final).not.toContain(k);
  expect(external).toEqual([]);
});
