import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] Painel «Configurações de IA» no browser, em modo local: a mesma lógica da função
 * ai-admin corre em memória com fornecedores SIMULADOS. Nada sai do browser. A autorização no
 * servidor, o cofre e a escolha automática estão provados em tests/db/ e tests/unit/aiAdmin.test.ts.
 *
 * Cada fornecedor: chave + um botão «Ativo». Para cada função (edição, imagens), o servidor usa o
 * melhor fornecedor ativo com chave reconhecida.
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

const toggle = (page: Page, provider: string) => page.getByTestId(`ai-provider-enabled-${provider}`);

test('[simulado] um fornecedor: chave, teste sem custo, ativar, substituição recusada, limites, consumo, remover', async ({ page }) => {
  test.setTimeout(90_000);
  const external = watchExternal(page);
  await openSettings(page);

  // Por omissão: sem chaves, nada ativo; o botão «Ativo» só funciona com a chave reconhecida.
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Sem chave');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Cole a chave abaixo');
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente desativado');
  await expect(toggle(page, 'anthropic')).toBeDisabled();
  await expect(page.getByTestId('ai-route-edit')).toContainText('Indisponível');
  // O botão de guardar fica disponível assim que se escreve; uma chave incompleta é explicada.
  await expect(page.getByTestId('ai-key-save-anthropic')).toBeDisabled();
  await page.getByTestId('ai-key-input-anthropic').fill('curta');
  await expect(page.getByTestId('ai-key-save-anthropic')).toBeEnabled();
  await page.getByTestId('ai-key-save-anthropic').click();
  await expect(page.getByTestId('ai-key-test-result-anthropic')).toContainText('incompleta');

  // Guardar a chave: testada sem custo; nunca volta à página. Guardar NÃO ativa sozinho.
  await saveKey(page, 'anthropic', KEY_A);
  await expect(page.getByTestId('ai-settings-message')).toContainText('Chave Anthropic guardada (…AAAA). Credenciais reconhecidas');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-key-input-anthropic')).toHaveValue('');
  expect(await everything(page)).not.toContain(KEY_A);
  await expect(toggle(page, 'anthropic')).not.toBeChecked();
  await expect(toggle(page, 'anthropic')).toBeEnabled();

  // Testar ligação (ação explícita, sem custo). Credenciais ≠ geração validada.
  await page.getByTestId('ai-key-test-anthropic').click();
  await expect(page.getByTestId('ai-key-test-result-anthropic')).toContainText('Isto não comprova a geração');
  await expect(page.getByTestId('ai-cred-anthropic')).toContainText('Reconhecidas');
  await expect(page.getByTestId('ai-gen-anthropic')).toContainText('Por validar');

  // Ativar: um só botão. O assistente fica ativo com o melhor modelo da Anthropic.
  await toggle(page, 'anthropic').check();
  await expect(toggle(page, 'anthropic')).toBeChecked();
  await expect(page.getByTestId('ai-settings-message')).toContainText('Anthropic ativado. Edição: Claude Sonnet 5.5');
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente ativo');
  await expect(page.getByTestId('ai-route-edit')).toContainText('Em uso: Claude Sonnet 5.5 (Anthropic)');
  await expect(page.getByTestId('ai-provider-anthropic')).toContainText('Em uso: edição (Claude Sonnet 5.5)');
  await expect(page.getByTestId('ai-check-key')).toContainText('Reconhecidas');
  await expect(page.getByTestId('ai-check-generation')).toContainText('Por validar');

  // Substituição recusada: mantém a anterior e o assistente ativo.
  await saveKey(page, 'anthropic', KEY_BAD);
  await expect(page.getByTestId('ai-settings-message')).toContainText('Mantém-se a chave anterior (…AAAA)');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA');
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente ativo');
  expect(await everything(page)).not.toContain(KEY_BAD);

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

  // Desativar: um só botão desliga o assistente.
  await toggle(page, 'anthropic').uncheck();
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente desativado');
  await toggle(page, 'anthropic').check();
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente ativo');

  // Remover: confirmação; o fornecedor deixa de poder ser usado.
  await page.getByTestId('ai-key-remove-anthropic').click();
  await page.getByTestId('ai-key-remove-confirm').click();
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('Sem chave');
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente desativado');

  // Registo: quem e quando, sem segredos.
  const list = page.getByTestId('ai-audit-list');
  await expect(page.getByTestId('ai-audit-entry').first()).toContainText('Chave removida');
  await expect(list).toContainText('Chave nova recusada');
  await expect(list).toContainText('Fornecedor ativado');
  await expect(list).toContainText('Fornecedor desativado');
  await expect(list).toContainText('administrador local (simulação)');
  const final = await everything(page);
  expect(final).not.toContain(KEY_A);
  expect(final).not.toContain(KEY_BAD);
  expect(external).toEqual([]);
});

test('[simulado] vários fornecedores ativos ao mesmo tempo: chave em qualquer um, o melhor para cada função, reserva automática', async ({ page }) => {
  test.setTimeout(90_000);
  const external = watchExternal(page);
  await openSettings(page);

  // Chave em qualquer fornecedor, mesmo com outro já configurado e ativo.
  await saveKey(page, 'anthropic', KEY_A);
  await toggle(page, 'anthropic').check();
  await expect(page.getByTestId('ai-route-edit')).toContainText('Claude Sonnet 5.5');
  await saveKey(page, 'openai', KEY_OPENAI);
  await expect(page.getByTestId('ai-key-status-openai')).toContainText('…OOOO');
  await expect(page.getByTestId('ai-key-test-result-openai')).toContainText('O formato do pedido e a geração só ficam comprovados');
  await saveKey(page, 'google', KEY_GOOGLE);
  await expect(page.getByTestId('ai-key-status-google')).toContainText('…GGGG');

  // Todos ativos: edição com o Claude (melhor para edição), imagens com o Gemini (único com imagens).
  await toggle(page, 'openai').check();
  await toggle(page, 'google').check();
  await expect(page.getByTestId('ai-route-edit')).toContainText('Em uso: Claude Sonnet 5.5 (Anthropic)');
  await expect(page.getByTestId('ai-route-image')).toContainText('Em uso: Gemini 3.1 Flash Image (Google Gemini)');
  await expect(page.getByTestId('ai-provider-google')).toContainText('Em uso: imagens (Gemini 3.1 Flash Image)');
  await expect(page.getByTestId('ai-provider-openai')).toContainText('de reserva');

  // Desativar o Claude: a edição passa para o melhor ativo seguinte (OpenAI); as imagens não mudam.
  await toggle(page, 'anthropic').uncheck();
  await expect(page.getByTestId('ai-route-edit')).toContainText('Em uso: GPT-6.1 Sol (OpenAI)');
  await expect(page.getByTestId('ai-route-image')).toContainText('Gemini 3.1 Flash Image');
  await expect(page.getByTestId('ai-key-status-anthropic')).toContainText('…AAAA'); // a chave fica guardada

  // Remover a chave Google: só as imagens ficam indisponíveis.
  await page.getByTestId('ai-key-remove-google').click();
  await page.getByTestId('ai-key-remove-confirm').click();
  await expect(page.getByTestId('ai-route-image')).toContainText('Indisponível');
  await expect(page.getByTestId('ai-enabled')).toHaveText('Assistente ativo');
  await expect(page.getByTestId('ai-key-status-openai')).toContainText('…OOOO');

  const final = await everything(page);
  for (const k of [KEY_A, KEY_OPENAI, KEY_GOOGLE]) expect(final).not.toContain(k);
  expect(external).toEqual([]);
});

test('[simulado] diagnóstico do pedido ao Gemini: só no cartão Google com chave, pago com teto explícito, bloqueado até autorizar', async ({ page }) => {
  const external = watchExternal(page);
  await openSettings(page);
  await expect(page.getByTestId('ai-diagnosis')).toHaveCount(0);
  await saveKey(page, 'google', KEY_GOOGLE);
  await expect(page.getByTestId('ai-key-status-google')).toContainText('Chave configurada');
  const diag = page.getByTestId('ai-provider-google').getByTestId('ai-diagnosis');
  await expect(diag).toHaveCount(1);
  await expect(page.getByTestId('ai-provider-anthropic').getByTestId('ai-diagnosis')).toHaveCount(0);
  await diag.locator('summary').click();
  await expect(diag).toContainText('pago, até 0,02 USD');
  await expect(page.getByTestId('ai-diagnosis-run')).toBeDisabled();
  await page.getByTestId('ai-diagnosis-agree').check();
  await expect(page.getByTestId('ai-diagnosis-run')).toBeEnabled();
  // Modo local: não há fornecedor real; o pedido é recusado e nada sai do browser.
  await page.getByTestId('ai-diagnosis-run').click();
  await expect(page.getByTestId('ai-diagnosis-report')).toHaveCount(0);
  expect(external).toEqual([]);
});
