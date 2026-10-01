import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] Pedido do print, pela janela «Editar com IA», com o Cabeçalho selecionado:
 * «criar uma imagem de fundo com alunos vindo para casa». Modo local (simulador de imagens, sem
 * rede, sem custo). Percurso: pedido → painel com a proposta e a confirmação «Gerar imagem» aberta
 * → imagem gerada como proposta → antes/depois → aplicar ao fundo (textos, botões e estrutura
 * intactos) → desfazer/refazer → guardar → F5.
 * E: valores financeiros só para administradores; geração não configurada (causa e o que fazer).
 *
 * NÃO comprova a geração real: o gerador é o simulador. A geração real precisa de uma chamada paga.
 */
const ZIP = 'amostra/startbootstrap-stylish-portfolio-gh-pages.zip';
const SAVED = 'Alterações guardadas neste browser';
const PEDIDO = 'criar uma imagem de fundo com alunos vindo para casa';
const canvas = (page: Page) => page.frameLocator('.gjs-frame');

async function offline(page: Page) {
  await page.route(/use\.fontawesome|cdnjs|fonts\.(googleapis|gstatic)|google\.com|jsdelivr/, (r) => r.abort('internetdisconnected'));
}

/** Papel e imagens simulados do modo local (ver LocalAiAdminClient). */
async function localSettings(page: Page, settings: Record<string, string>) {
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) window.localStorage.setItem(k, v);
  }, settings);
}

async function importCopy(page: Page): Promise<string> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(ZIP);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('import-name').fill('Stylish original');
  await page.getByTestId('import-accept-partial').check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  // Cópia a partir de um template (como no print: «Start Bootstrap Template»).
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill('Start Bootstrap Template');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toContainText('versão 1');
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  await page.goto('/templates');
  await page.getByTestId('team-template-card').filter({ hasText: 'Start Bootstrap Template' }).getByTestId('use-team-template').click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill('Cópia para a imagem');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  return page.url();
}

async function askOnHeader(page: Page, text: string) {
  await canvas(page).locator('header.masthead').click({ position: { x: 12, y: 300 } });
  await expect(page.getByTestId('selected-name')).toHaveText('Cabeçalho');
  await page.getByTestId('ct-ai').click();
  await expect(page.getByTestId('ai-quick')).toContainText('Cabeçalho');
  await page.getByTestId('ai-quick-input').fill(text);
}

const bg = (page: Page) => canvas(page).locator('header.masthead').evaluate((el) => getComputedStyle(el).backgroundImage);
const structure = (page: Page) =>
  canvas(page)
    .locator('header.masthead')
    .evaluate((el) => ({ html: el.querySelectorAll('*').length, h1: el.querySelector('h1')?.textContent, h3: el.querySelector('h3')?.textContent, btn: el.querySelector('a.btn')?.textContent, href: el.querySelector('a.btn')?.getAttribute('href') }));

test('[simulado] pedido do print: gerar imagem de fundo do Cabeçalho, confirmar, pré-visualizar, aplicar, desfazer/refazer, guardar e reabrir', async ({ page }) => {
  test.setTimeout(240_000);
  await offline(page);
  await importCopy(page);

  const original = await bg(page);
  expect(original).toContain('data:image/'); // fundo vindo do CSS original (bg-masthead.jpg), guardado no projeto
  const before = await structure(page);

  await askOnHeader(page, PEDIDO);
  await expect(page.getByTestId('ai-quick')).toContainText('Simulador: sem custo.'); // administrador (local)
  await page.getByTestId('ai-quick-apply').click();

  // Painel completo JÁ com a proposta: fundo do Cabeçalho, imagem a gerar, confirmação aberta.
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'ai');
  await expect(page.getByTestId('ai-scope-name')).toContainText('Cabeçalho');
  await expect(page.getByTestId('ai-changes')).toContainText('Cabeçalho');
  const confirm = page.getByRole('dialog', { name: 'Gerar imagem?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('«alunos vindo para casa»');
  await expect(page.getByTestId('ai-generate-prompt')).toHaveValue('alunos vindo para casa');
  // Nada mudou ainda.
  expect(await bg(page)).toBe(original);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('ai-generate-confirm').click();
  await expect(page.getByTestId('ai-image-chosen')).toContainText('SIMULADA');
  const pv = page.frameLocator('[data-testid="ai-preview"]');
  await expect(pv.locator('header.masthead')).toBeVisible();
  expect(await bg(page)).toBe(original); // a imagem gerada é só proposta até aplicar

  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  await expect.poll(() => bg(page)).not.toBe(original);
  const applied = await bg(page);
  expect(applied).toMatch(/url\("data:image\/(png|webp)/);
  expect(await structure(page)).toEqual(before); // textos, botão e estrutura intactos

  await page.getByTestId('undo').click();
  await expect.poll(() => bg(page)).toBe(original);
  await page.getByTestId('redo').click();
  await expect.poll(() => bg(page)).toBe(applied);

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect.poll(() => bg(page)).toBe(applied);
  expect(await structure(page)).toEqual(before);
});

test('[simulado] utilizador comum: gera com confirmação, sem valores financeiros em lado nenhum', async ({ page }) => {
  test.setTimeout(240_000);
  await localSettings(page, { 'bolt-local-papel': 'utilizador' });
  await offline(page);
  await importCopy(page);
  await expect(page.getByTestId('nav-ai-settings')).toHaveCount(0);

  await askOnHeader(page, PEDIDO);
  await expect(page.getByTestId('ai-quick')).not.toContainText(/custo|USD|\$|orçamento|crédito/i);
  await page.getByTestId('ai-quick-apply').click();
  const confirm = page.getByRole('dialog', { name: 'Gerar imagem?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('SIMULADA');
  await expect(confirm).not.toContainText(/custo|USD|\$|orçamento|crédito/i);
  await expect(page.getByTestId('ai-generate-confirm')).toHaveText('Gerar imagem');
  await page.getByTestId('ai-generate-confirm').click();
  await expect(page.getByTestId('ai-image-chosen')).toContainText('SIMULADA');
  await expect(page.getByTestId('ai-panel')).not.toContainText(/custo|USD|\$|orçamento|crédito/i);
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
});

test('[simulado] geração não configurada: o administrador vê o que configurar e o pedido fica guardado; o utilizador comum é informado', async ({ page }) => {
  test.setTimeout(240_000);
  await localSettings(page, { 'bolt-local-imagens': 'desligadas' });
  await offline(page);
  const copy = await importCopy(page);

  await askOnHeader(page, PEDIDO);
  await page.getByTestId('ai-quick-apply').click();
  const notice = page.getByTestId('ai-quick-image-unavailable');
  await expect(notice).toContainText('A geração de imagens com IA não está configurada.');
  await expect(notice).toContainText('Google');
  await expect(page.getByTestId('ai-quick-result')).toContainText('Nada foi alterado.');
  await expect(page.getByTestId('ai-quick-result')).not.toContainText(/carregar/i);
  await expect(page.getByTestId('undo')).toBeDisabled();
  // «Abrir Configurações de IA»: o pedido fica guardado e volta ao reabrir a janela no mesmo elemento.
  await page.getByTestId('ai-image-configure').click();
  await expect(page).toHaveURL(/\/configuracoes\/ia$/);
  await page.goto(copy);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await canvas(page).locator('header.masthead').click({ position: { x: 12, y: 300 } });
  await page.getByTestId('ct-ai').click();
  await expect(page.getByTestId('ai-quick-input')).toHaveValue(PEDIDO);
  await expect(page.getByTestId('ai-quick-restored')).toBeVisible();

  // Utilizador comum: sem acesso à configuração; informado de que deve contactar o administrador.
  await page.evaluate(() => window.localStorage.setItem('bolt-local-papel', 'utilizador'));
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await askOnHeader(page, PEDIDO);
  await page.getByTestId('ai-quick-apply').click();
  const userNotice = page.getByTestId('ai-quick-image-unavailable');
  await expect(userNotice).toContainText('A geração de imagens com IA não está disponível.');
  await expect(userNotice).toContainText('Contacte o administrador');
  await expect(page.getByTestId('ai-image-configure')).toHaveCount(0);
});
