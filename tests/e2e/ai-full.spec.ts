import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * [simulado] Assistente IA, versão 2, no browser (modo local): âmbitos (elemento, secção, página,
 * site inteiro), imagens e fundos, estrutura e várias páginas. TODAS as propostas vêm do SIMULADOR
 * e as imagens «geradas» do simulador de imagens (identificadas como SIMULADAS): sem IA real, sem
 * rede, sem custo. Usa cópias novas do template Nimbus (nunca projetos de trabalho).
 */
declare global {
  interface Window {
    __boltAiRequests?: Array<{ scope: { kind: string }; imageGeneration: boolean; context: { part?: { index: number; total: number }; pages: Array<{ id: string }> } }>;
    __boltAiSent?: number;
  }
}

const SAVED = 'Alterações guardadas neste browser';
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const rows = (page: Page) => page.getByTestId('page-row');
const row = (page: Page, name: string) => rows(page).filter({ has: page.locator('.page-name', { hasText: new RegExp(`^${name}$`) }) });

async function createNimbus(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByTestId('template-card').filter({ hasText: 'Nimbus' }).getByRole('button', { name: 'Usar este template' }).click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

/** HTML sem as classes de interface do canvas (seleção, passagem do rato): só o conteúdo. */
const clean = (html: string) =>
  html.replace(/ class="([^"]*)"/g, (_m, c: string) => {
    const kept = c.split(/\s+/).filter((t) => t && !t.startsWith('gjs-')).join(' ');
    return kept ? ` class="${kept}"` : '';
  });

async function openTool(page: Page, id: string) {
  const b = page.getByTestId(`tool-${id}`);
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
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

async function save(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

/** Secção do herói (a primeira com o título principal). */
const hero = (page: Page) => frame(page).locator('section').filter({ has: frame(page).locator('h1') }).first();

test('[simulado] imagem e fundo substituídos em separado: gerar (com custo mostrado e confirmação), escolher existente; nada muda antes de aplicar; desfazer, refazer, guardar e reabrir', async ({ page }) => {
  test.setTimeout(120_000);
  await createNimbus(page, `IA imagens ${Date.now()}`);
  const img = frame(page).locator('img').first();
  const originalSrc = (await img.getAttribute('src')) ?? '';

  // 1. Imagem: gerar (simulador), com confirmação; a atual só muda ao aplicar.
  await img.click();
  await page.getByTestId('ct-ai').click();
  await page.getByTestId('ai-quick-more').click(); // imagens geradas: no painel completo
  await expect(page.getByTestId('ai-scope-name')).toContainText('Elemento · Imagem');
  await ask(page, 'imagem: gerar um parque infantil ao sol');
  await expect(page.getByTestId('ai-changes')).toContainText('Imagem');
  await expect(page.getByTestId('ai-image-missing')).toBeVisible();
  await expect(page.getByTestId('ai-apply')).toBeDisabled();
  await expect(page.getByTestId('ai-generate-prompt')).toHaveValue('um parque infantil ao sol');
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('ai-generate-cost')).toContainText('SIMULADA');
  await page.getByTestId('ai-generate-confirm').click();
  await expect(page.getByTestId('ai-image-chosen')).toContainText('SIMULADA');
  // Gerada, mas não aplicada: o canvas mantém a imagem original.
  await expect(img).toHaveAttribute('src', originalSrc);
  await expect(page.getByTestId('undo')).toBeDisabled();
  const pv = page.frameLocator('[data-testid="ai-preview"]');
  await expect(pv.locator('img').first()).toBeVisible();
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  await expect.poll(async () => (await img.getAttribute('src')) !== originalSrc).toBe(true);
  const generatedSrc = (await img.getAttribute('src')) ?? '';
  expect(generatedSrc).toMatch(/^data:image\/png/); // modo local: dentro do documento (referência permanente), nunca um endereço do fornecedor

  // 2. Fundo da secção: operação distinta; escolher uma imagem existente da página.
  const section = hero(page);
  await section.click({ position: { x: 6, y: 6 } });
  await page.getByTestId('ai-scope-kind-section').click();
  await expect(page.getByTestId('ai-scope-name')).toContainText('Secção');
  await ask(page, 'fundo-imagem: escolher');
  await expect(page.getByTestId('ai-changes')).toContainText('Imagem de fundo (Computador)');
  await page.getByTestId('ai-image-pick').click();
  await page.getByTestId('ai-pick-page-image').first().click();
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  await expect.poll(() => css(section, 'background-image')).toContain('url(');
  // A imagem do elemento não foi tocada pelo fundo.
  await expect(img).toHaveAttribute('src', generatedSrc);

  // 3. Desfazer só o fundo; refazer; guardar e reabrir mantém os dois.
  await page.getByTestId('undo').click();
  await expect.poll(() => css(section, 'background-image')).not.toContain('url(');
  await expect(img).toHaveAttribute('src', generatedSrc);
  await page.getByTestId('redo').click();
  await expect.poll(() => css(section, 'background-image')).toContain('url(');
  await save(page);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(frame(page).locator('img').first()).toHaveAttribute('src', generatedSrc);
  await expect.poll(() => css(hero(page), 'background-image')).toContain('url(');
});

test('[simulado] caso do estacionamento: com o painel de métricas selecionado, o assistente pergunta que imagem alterar e oferece a secção; nada muda sozinho', async ({ page }) => {
  test.setTimeout(90_000);
  await createNimbus(page, `IA ambiguidade ${Date.now()}`);
  // A secção passa a ter uma fotografia de fundo (como o estacionamento do print).
  const section = hero(page);
  await section.click({ position: { x: 6, y: 6 } });
  await openAi(page);
  await page.getByTestId('ai-scope-kind-section').click();
  await ask(page, 'fundo-imagem: escolher');
  await page.getByTestId('ai-image-pick').click();
  await page.getByTestId('ai-pick-page-image').first().click();
  await page.getByTestId('ai-apply').click();
  await expect.poll(() => css(section, 'background-image')).toContain('url(');
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  const bgBefore = await css(section, 'background-image');
  const srcBefore = await frame(page).locator('img').first().getAttribute('src');
  const unchanged = async () => {
    expect(await css(section, 'background-image')).toBe(bgBefore);
    expect(await frame(page).locator('img').first().getAttribute('src')).toBe(srcBefore);
    await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  };

  // Selecionado: o painel de métricas (imagem). Pedido sobre «o estacionamento».
  const img = frame(page).locator('img').first();
  await img.click();
  await page.getByTestId('ai-scope-kind-element').click();
  await expect(page.getByTestId('ai-scope-name')).toContainText('Elemento · Imagem');
  await ask(page, '[simulado:ambiguo] a imagem que tem um estacionamento, troca por um parque infantil');
  await expect(page.getByTestId('ai-clarify-question')).toContainText('Que imagem quer alterar?');
  await expect(page.getByTestId('ai-proposal')).toHaveCount(0);
  // Nada mudou; o âmbito só muda se o utilizador escolher.
  await unchanged();
  const toSection = page.getByTestId('ai-clarify-option').filter({ hasText: 'Mudar o âmbito' });
  await expect(toSection).toContainText('imagem de fundo');
  await toSection.click();
  await expect(page.getByTestId('ai-scope-kind-section')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ai-scope-name')).toContainText('Secção');
  await expect(page.getByTestId('ai-note')).toContainText('Reveja o pedido e envie de novo');
  await unchanged();
});

test('[simulado] secção: inserir e estilizar dentro dela preservando as outras secções; um só desfazer; guardar e reabrir', async ({ page }) => {
  test.setTimeout(90_000);
  await createNimbus(page, `IA secção ${Date.now()}`);
  const sections = frame(page).locator('body section');
  const count = await sections.count();
  expect(count).toBeGreaterThan(1);
  const others = async () => {
    const html = await sections.evaluateAll((els) => els.map((e) => e.outerHTML));
    return html.slice(1).map(clean);
  };
  const othersBefore = await others();
  await hero(page).click({ position: { x: 6, y: 6 } });
  await openAi(page);
  await page.getByTestId('ai-scope-kind-section').click();
  await ask(page, 'inserir título: Novidades desta secção');
  await expect(page.getByTestId('ai-changes')).toContainText('Inserir Título');
  await expect(page.getByTestId('ai-affected-pages')).toContainText('Página afetada');
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  await expect(hero(page).getByText('Novidades desta secção')).toBeVisible();
  // As outras secções ficam exatamente iguais.
  expect(await others()).toEqual(othersBefore);
  await page.getByTestId('undo').click();
  await expect(frame(page).getByText('Novidades desta secção')).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  await expect(hero(page).getByText('Novidades desta secção')).toBeVisible();
  await save(page);
  await page.reload();
  await expect(frame(page).getByText('Novidades desta secção')).toBeVisible();
  expect(await others()).toEqual(othersBefore);
});

test('[simulado] site inteiro com várias páginas: proposta mostra as páginas afetadas; aplicar, desfazer, refazer, guardar e reabrir', async ({ page }) => {
  test.setTimeout(120_000);
  await createNimbus(page, `IA site ${Date.now()}`);
  // Segunda página (cópia da inicial).
  await openTool(page, 'layers');
  await page.getByTestId('page-duplicate').click();
  await expect(row(page, 'Página inicial \\(cópia\\)')).toHaveAttribute('aria-current', 'page');
  await row(page, 'Página inicial').click();
  const h1 = () => frame(page).locator('h1').first();
  const color = await css(h1(), 'color');

  await openAi(page);
  await page.getByTestId('ai-scope-kind-site').click();
  await expect(page.getByTestId('ai-scope-name')).toContainText('Site inteiro · 2 páginas');
  await ask(page, 'títulos: cor #b91c1c');
  await expect(page.getByTestId('ai-affected-pages')).toContainText('Páginas afetadas (2)');
  await expect(page.getByTestId('ai-affected-pages')).toContainText('Página inicial (cópia)');
  await expect(page.getByTestId('ai-preview-page').locator('option')).toHaveCount(2);
  // O pedido enviado leva as duas páginas (âmbito «site»).
  const reqs = await page.evaluate(() => window.__boltAiRequests ?? []);
  expect(reqs[0]?.scope.kind).toBe('site');
  expect(reqs.flatMap((r) => r.context.pages.map((p) => p.id))).toHaveLength(2);
  await expect(h1()).not.toHaveCSS('color', 'rgb(185, 28, 28)');
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toContainText('em 2 páginas');
  await expect.poll(() => css(h1(), 'color')).toBe('rgb(185, 28, 28)');
  await openTool(page, 'layers');
  await row(page, 'Página inicial \\(cópia\\)').click();
  await expect.poll(() => css(h1(), 'color')).toBe('rgb(185, 28, 28)');

  // Um só desfazer reverte as duas páginas (o aviso indica a outra página).
  await page.getByTestId('undo').click();
  await expect.poll(() => css(h1(), 'color')).toBe(color);
  await row(page, 'Página inicial').click();
  await expect.poll(() => css(h1(), 'color')).toBe(color);
  // (O passo anterior no histórico é «duplicar página», feito antes do pedido.)
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId('redo').click();
  await expect.poll(() => css(h1(), 'color')).toBe('rgb(185, 28, 28)');
  await save(page);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(185, 28, 28)');
  await openTool(page, 'layers');
  await row(page, 'Página inicial \\(cópia\\)').click();
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(185, 28, 28)');
});

// ---------------------------------------------------------------- amostras importadas (cópias)

const STUDIO = 'amostra/projeto-teste-2026-09-16-091529.grapesjs';
const ELEMENTOR = 'amostra/[Modelo] [Elementor] Carla Santos.json';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/** Importa uma CÓPIA da amostra (o ficheiro original só é lido) para um projeto novo. */
async function importCopy(page: Page, path: string, name: string) {
  await page.route('https://cdn.grapesjs.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(/daniel-machado\.site|joanapinho\.pt/, (route) => route.abort('namenotresolved'));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort('internetdisconnected'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('import-name').fill(name);
  const rights = page.getByTestId('import-rights');
  if (await rights.count()) await rights.check();
  const partial = page.getByTestId('import-accept-partial');
  if (await partial.count()) await partial.check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

for (const sample of [
  { label: 'GrapesJS Studio', path: STUDIO },
  { label: 'Elementor', path: ELEMENTOR },
]) {
  test(`[simulado] amostra ${sample.label} (cópia importada): pedido à página inteira nos títulos; o resto fica igual; desfazer, guardar e reabrir`, async ({ page }) => {
    test.setTimeout(150_000);
    await importCopy(page, sample.path, `IA amostra ${sample.label} ${Date.now()}`);
    const headings = frame(page).locator('h1, h2, h3');
    const texts = frame(page).locator('p');
    expect(await headings.count()).toBeGreaterThan(0);
    const pColors = await texts.evaluateAll((els) => els.slice(0, 10).map((e) => getComputedStyle(e).color));
    const hColors = await headings.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));

    await openAi(page);
    await page.getByTestId('ai-scope-kind-page').click();
    await expect(page.getByTestId('ai-scope-name')).toContainText('Página · ');
    await ask(page, 'títulos: cor #b91c1c');
    // Medido isoladamente: proposta visível em ~1,4 s (Studio, 2 partes) e ~0,7 s (Elementor). O limite
    // largo cobre a carga de 4 processos de teste em paralelo na mesma máquina; não é uma correção.
    await expect(page.getByTestId('ai-change').first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('ai-apply').click();
    await expect(page.getByTestId('ai-applied')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => headings.evaluateAll((els) => els.every((e) => getComputedStyle(e).color === 'rgb(185, 28, 28)'))).toBe(true);
    // Os parágrafos não mudaram.
    expect(await texts.evaluateAll((els) => els.slice(0, 10).map((e) => getComputedStyle(e).color))).toEqual(pColors);
    await page.getByTestId('undo').click();
    await expect.poll(() => headings.evaluateAll((els) => els.map((e) => getComputedStyle(e).color))).toEqual(hColors);
    await page.getByTestId('redo').click();
    await save(page);
    await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText(SAVED);
    await expect.poll(() => frame(page).locator('h1, h2, h3').evaluateAll((els) => els.every((e) => getComputedStyle(e).color === 'rgb(185, 28, 28)'))).toBe(true);
  });
}

test('[simulado] secção nova com título, texto, botão e imagem pedidos: exatamente esse conteúdo (sem textos genéricos); imagem gerada só entra ao aplicar; desfazer, guardar e reabrir', async ({ page }) => {
  test.setTimeout(90_000);
  await createNimbus(page, `IA secção nova ${Date.now()}`);
  const sectionsBefore = await frame(page).locator('body section').count();
  await openAi(page);
  await page.getByTestId('ai-scope-kind-page').click();
  await ask(page, 'secção: título=Fale connosco | texto=Respondemos em menos de um dia útil. | botão=Marcar reunião -> /contactos | imagem=gerar equipa de apoio sorridente');
  await expect(page.getByTestId('ai-changes')).toContainText('Inserir secção');
  await expect(page.getByTestId('ai-changes')).toContainText('título «Fale connosco»');
  await expect(page.getByTestId('ai-changes')).toContainText('botão «Marcar reunião» → /contactos');
  await expect(page.getByTestId('ai-image-slot')).toContainText('Imagem da secção nova');
  await expect(page.getByTestId('ai-apply')).toBeDisabled();
  await page.getByTestId('ai-generate').click();
  await page.getByTestId('ai-generate-confirm').click();
  await expect(page.getByTestId('ai-image-chosen')).toContainText('SIMULADA');
  // Ainda nada no documento.
  expect(await frame(page).locator('body section').count()).toBe(sectionsBefore);
  await expect(page.getByTestId('ai-preview')).toBeVisible();
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  const added = frame(page).locator('section').filter({ hasText: 'Fale connosco' });
  await expect(added).toHaveCount(1);
  await expect(added.locator('h2')).toHaveText('Fale connosco');
  await expect(added.getByText('Respondemos em menos de um dia útil.')).toBeVisible();
  await expect(added.locator('a.bolt-btn')).toHaveText('Marcar reunião');
  await expect(added.locator('a.bolt-btn')).toHaveAttribute('href', '/contactos');
  await expect(added.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(added).not.toContainText('Título da secção');
  await expect(added).not.toContainText('Escreva aqui');
  await page.getByTestId('undo').click();
  await expect(frame(page).locator('section').filter({ hasText: 'Fale connosco' })).toHaveCount(0);
  await page.getByTestId('redo').click();
  await save(page);
  await page.reload();
  await expect(frame(page).locator('section').filter({ hasText: 'Fale connosco' }).locator('a.bolt-btn')).toHaveAttribute('href', '/contactos');
});

test('[simulado] espera: progresso visível; sem envios duplicados; cancelar descarta a resposta mesmo que chegue depois', async ({ page }) => {
  test.setTimeout(60_000);
  await createNimbus(page, `IA espera ${Date.now()}`);
  await frame(page).locator('h1').first().click();
  await openAi(page);
  await page.getByTestId('ai-instruction').fill('[simulado:lento] texto: Nunca aplicado');
  await page.evaluate(() => {
    window.__boltAiSent = 0;
  });
  // Duplo clique e Enter repetido: um só envio.
  await page.getByTestId('ai-propose').dblclick();
  await expect(page.getByTestId('ai-waiting')).toContainText('A pedir a proposta ao assistente');
  await expect(page.getByTestId('ai-propose')).toHaveCount(0);
  await expect(page.getByTestId('ai-instruction')).toBeDisabled();
  expect(await page.evaluate(() => window.__boltAiSent)).toBe(1);
  // Cancelar; a resposta do simulador chegaria ~1,5 s depois: nunca aparece nem é aplicada.
  await page.getByTestId('ai-cancel-request').click();
  await expect(page.getByTestId('ai-note')).toContainText('cancelado');
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('ai-proposal')).toHaveCount(0);
  await expect(frame(page).locator('h1').first()).not.toHaveText('Nunca aplicado');
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(await page.evaluate(() => window.__boltAiSent)).toBe(1);
});
