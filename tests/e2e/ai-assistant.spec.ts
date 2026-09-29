import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * [simulado] Assistente IA, versão 1, no browser (modo local). TODAS as propostas vêm do
 * SIMULADOR (sem IA, sem rede): estes testes provam o percurso do editor (validação, prévia,
 * confirmação, aplicação atómica, desfazer único, gravação), não a qualidade de um modelo.
 */
// Ganchos só de desenvolvimento expostos pelo editor (ver AiAssistantPanel e ai/apply).
declare global {
  interface Window {
    __boltAiLastRequest?: { context: { capabilities: unknown; styles: Record<string, unknown> } };
    __boltAiFailAfter?: number;
  }
}

const SAVED = 'Alterações guardadas neste browser';
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function createNimbus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill('Assistente');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

async function openAi(page: Page) {
  const b = page.getByTestId('tool-ai');
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
}

async function ask(page: Page, text: string) {
  await page.getByTestId('ai-instruction').fill(text);
  await page.getByTestId('ai-propose').click();
}

test('[simulado] pré-visualização, confirmação, desfazer único e persistência; contexto com herança e variáveis', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  const original = (await h1.textContent()) ?? '';
  await h1.click();
  await openAi(page);
  await expect(page.getByTestId('ai-engine')).toHaveText(/Simulador · sem IA/);
  await expect(page.getByTestId('ai-scope-name')).toContainText('Título');
  await expect(page.getByTestId('ai-caps')).toContainText('Ligação (não se aplica)');
  // Só a ação implementada está ativa: nenhuma de inserir, mover, duplicar ou eliminar.
  const names = await page.getByTestId('ai-panel').getByRole('button').allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['Propor alterações']);
  await expect(page.getByTestId('ai-next-steps')).toContainText('Próximas etapas');

  await ask(page, 'texto: Título do assistente; nível h2; cor #b91c1c');
  await expect(page.getByTestId('ai-change')).toHaveCount(3);
  await expect(page.getByTestId('ai-changes')).toContainText('Tipo de texto');
  // Antes/depois numa cópia; o documento real não muda antes de confirmar.
  const pv = page.frameLocator('[data-testid="ai-preview"]');
  await expect(pv.getByText('Título do assistente')).toBeVisible();
  await page.getByTestId('ai-preview-before').click();
  await expect(pv.getByText(original)).toBeVisible();
  await expect(h1).toHaveText(original);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(page.getByTestId('undo')).toBeDisabled();

  // O contexto enviado leva a origem dos estilos e a ligação à variável dos títulos.
  const ctx = await page.evaluate(() => window.__boltAiLastRequest?.context);
  expect(ctx?.capabilities).toEqual({ text: true, link: false, tag: true });
  expect(ctx?.styles.color).toMatchObject({ source: 'rule', variable: '--bolt-heading', variableLabel: 'Títulos' });
  expect(ctx?.styles['font-size']).toMatchObject({ source: 'rule', from: '.nb-title' });

  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toContainText('Um só «Desfazer»');
  const h2 = frame(page).getByText('Título do assistente');
  await expect(h2).toBeVisible();
  expect(await h2.evaluate((el) => el.tagName)).toBe('H2');
  await expect.poll(() => css(h2, 'color')).toBe('rgb(185, 28, 28)');

  // Um único desfazer reverte o lote inteiro.
  await page.getByTestId('undo').click();
  await expect(frame(page).locator('h1').first()).toHaveText(original);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).not.toBe('rgb(185, 28, 28)');
  await page.getByTestId('redo').click();
  await expect(frame(page).getByText('Título do assistente')).toBeVisible();

  // Gravação pela via existente; reabrir mantém.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  const again = frame(page).getByText('Título do assistente');
  await expect(again).toBeVisible();
  expect(await again.evaluate((el) => el.tagName)).toBe('H2');
});

test('[simulado] descartar, cancelar, resposta inválida, fora do âmbito, documento alterado na espera e falha na aplicação: nada é alterado', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  const original = (await h1.textContent()) ?? '';
  await h1.click();
  await openAi(page);

  await ask(page, 'texto: Descartado');
  await page.getByTestId('ai-discard').click();
  await expect(page.getByTestId('ai-note')).toContainText('Nada foi alterado');

  await ask(page, '[simulado:lento] texto: Cancelado');
  await page.getByTestId('ai-cancel-request').click();
  await expect(page.getByTestId('ai-note')).toContainText('cancelado');

  await ask(page, '[simulado:invalido]');
  await expect(page.getByTestId('ai-error')).toContainText('formato');

  await ask(page, '[simulado:fora] texto: Outro elemento');
  await expect(page.getByTestId('ai-error')).toContainText('não passou na validação');
  await expect(page.getByTestId('ai-error')).toContainText('fora do âmbito');

  await expect(h1).toHaveText(original);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(page.getByTestId('undo')).toBeDisabled();

  // Documento alterado (sem gravar) enquanto espera pela resposta.
  await ask(page, '[simulado:lento] texto: Tarde demais');
  await page.getByTestId('prop-text').fill('Mudado durante a espera');
  await page.getByTestId('prop-text').press('Tab');
  await expect(page.getByTestId('ai-error')).toContainText('O documento mudou enquanto esperava');
  await expect(h1).toHaveText('Mudado durante a espera');

  // Proposta aberta que fica desatualizada: não pode ser aplicada.
  await ask(page, 'texto: Proposta antiga');
  await expect(page.getByTestId('ai-proposal')).toBeVisible();
  await page.getByTestId('prop-text').fill('Nova edição local');
  await page.getByTestId('prop-text').press('Tab');
  await expect(page.getByTestId('ai-stale')).toBeVisible();
  await expect(page.getByTestId('ai-apply')).toBeDisabled();
  await page.getByTestId('ai-discard').click();

  // Falha durante a aplicação: documento e histórico ficam como estavam; nada é gravado.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.getByTestId('undo').click(); // deixa um «Refazer» disponível
  await expect(h1).toHaveText('Mudado durante a espera');
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.evaluate(() => {
    window.__boltAiFailAfter = 1;
  });
  await ask(page, 'texto: Nunca aplicado; cor #ff0000');
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-error')).toContainText('A aplicação falhou e o documento foi reposto');
  await expect(h1).toHaveText('Mudado durante a espera');
  await expect.poll(() => css(h1, 'color')).not.toBe('rgb(255, 0, 0)');
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.evaluate(() => {
    window.__boltAiFailAfter = undefined;
  });
  await page.getByTestId('redo').click();
  await expect(h1).toHaveText('Nova edição local');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(frame(page).locator('h1').first()).toHaveText('Nova edição local');
});

test('[simulado] ligação (destino e novo separador), destino inseguro recusado e estilos só no dispositivo escolhido', async ({ page }) => {
  await createNimbus(page);
  const link = frame(page).locator('.nb-menu-link').first();
  await link.click();
  await openAi(page);
  await expect(page.getByTestId('ai-caps')).not.toContainText('Ligação (não se aplica)');

  await ask(page, 'ligação: javascript:alert(1)');
  await expect(page.getByTestId('ai-error')).toContainText('destino não permitido');

  await ask(page, 'ligação: https://exemplo.pt/contacto; nova janela');
  await page.getByTestId('ai-apply').click();
  await expect(link).toHaveAttribute('href', 'https://exemplo.pt/contacto');
  await expect(link).toHaveAttribute('target', '_blank');

  // Estilo só no telemóvel: o computador fica igual.
  const desktopSize = await css(link, 'font-size');
  await page.getByTestId('ai-device').selectOption({ label: 'Telemóvel' });
  await ask(page, 'tamanho 40px');
  await expect(page.getByTestId('ai-changes')).toContainText('Tamanho da letra (Telemóvel)');
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  expect(await css(link, 'font-size')).toBe(desktopSize);
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect.poll(() => css(frame(page).locator('.nb-menu-link').first(), 'font-size')).toBe('40px');
});

test('[simulado] antes/depois à largura e no breakpoint do dispositivo escolhido; corresponde ao resultado aplicado (computador e telemóvel)', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await openAi(page);
  const id = await h1.getAttribute('id');
  const pv = page.frameLocator('[data-testid="ai-preview"]');
  const inPreview = () => pv.locator(`[id="${id}"]`);
  const innerWidth = () => pv.locator('body').evaluate(() => window.innerWidth);

  // Computador: renderizado a 1280 px (reduzido só por escala).
  await ask(page, 'cor #b91c1c');
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-width', '1280');
  await expect(page.getByTestId('ai-preview-device')).toHaveText('Computador · 1280 px');
  expect(await innerWidth()).toBe(1280);
  await expect.poll(() => css(inPreview(), 'color')).toBe('rgb(185, 28, 28)');
  const previewSize = await css(inPreview(), 'font-size');
  // Antes e depois com as mesmas dimensões.
  await page.getByTestId('ai-preview-before').click();
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-width', '1280');
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-height', '800');
  await expect.poll(() => css(inPreview(), 'color')).not.toBe('rgb(185, 28, 28)');
  await page.getByTestId('ai-preview-after').click();
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-height', '800');
  await page.getByTestId('ai-apply').click();
  await expect.poll(() => css(h1, 'color')).toBe('rgb(185, 28, 28)');
  expect(await css(h1, 'font-size')).toBe(previewSize);

  // Telemóvel: renderizado a 375 px; a regra de telemóvel do template aplica-se na prévia.
  await page.getByTestId('ai-device').selectOption({ label: 'Telemóvel' });
  await ask(page, 'tamanho 30px');
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-width', '375');
  expect(await innerWidth()).toBe(375);
  await expect.poll(() => css(inPreview(), 'font-size')).toBe('30px');
  await page.getByTestId('ai-preview-before').click();
  await expect.poll(() => css(inPreview(), 'font-size')).toBe('34px'); // regra .nb-title do telemóvel
  await page.getByTestId('ai-preview-after').click();

  // Ampliar: mesma largura de renderização, escala maior.
  const small = Number(await page.getByTestId('ai-preview-box').getAttribute('data-scale'));
  await page.getByTestId('ai-zoom').click();
  await expect(page.getByTestId('ai-zoom-preview')).toHaveAttribute('data-width', '375');
  const big = Number(await page.getByTestId('ai-zoom-preview-box').getAttribute('data-scale'));
  expect(big).toBeGreaterThan(small);
  await page.getByRole('dialog', { name: 'Pré-visualização da proposta' }).getByRole('button', { name: 'Fechar', exact: true }).click();

  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  // O resultado aplicado no canvas (telemóvel) corresponde à prévia; o computador não mudou.
  expect(await css(h1, 'font-size')).toBe(previewSize);
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect.poll(() => css(frame(page).locator('h1').first(), 'font-size')).toBe('30px');
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(185, 28, 28)');
});

test('[simulado] espelho do piloto: Nimbus pelo nome; cor principal por variável; o título acompanha a cor global; F5 e Dashboard', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Piloto espelho ${Date.now()}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByTestId('template-card').filter({ hasText: 'Nimbus' }).getByRole('button', { name: 'Usar este template' }).click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  const h1 = frame(page).locator('h1').first();
  const inherited = await css(h1, 'color');
  await h1.click();
  await openAi(page);
  // O simulador entende «cor VALOR»: aqui, a variável do tema (o pedido real diz o mesmo por palavras).
  await ask(page, 'cor var(--bolt-primary)');
  await expect(page.getByTestId('ai-changes')).toContainText('var(--bolt-primary)');
  expect(await css(h1, 'color')).toBe(inherited);
  await page.getByTestId('ai-apply').click();
  const primary = await frame(page).locator('.bolt-btn').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => css(h1, 'color')).toBe(primary);

  // Mudar a cor principal pelos Estilos globais: o título acompanha (está ligado, não copiado).
  await page.getByTestId('tool-styles').click();
  const slot = page.locator('[data-testid="global-slot"][data-name="--bolt-primary"]');
  await slot.getByTestId('global-value').fill('#0f7a3a');
  await slot.getByTestId('global-value').press('Enter');
  await expect.poll(() => css(h1, 'color')).toBe('rgb(15, 122, 58)');
  await page.getByTestId('undo').click();
  await expect.poll(() => css(h1, 'color')).toBe(primary);
  await page.getByTestId('redo').click();
  await expect.poll(() => css(h1, 'color')).toBe('rgb(15, 122, 58)');

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(15, 122, 58)');
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(15, 122, 58)');
});
