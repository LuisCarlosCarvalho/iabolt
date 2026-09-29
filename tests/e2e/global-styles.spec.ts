import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

/**
 * Estilos globais no browser (modo local): um template nativo e as duas amostras importadas.
 * Abrir sem alterar; cor e fonte partilhadas com efeito em duas páginas; valor próprio e regras de
 * telemóvel preservados; desfazer/refazer (um passo por arrasto de cor); guardar e reabrir;
 * template e cópia independente; menus e carrosséis funcionais; Escape na pré-visualização.
 */
const SAVED = 'Alterações guardadas neste browser';
const STUDIO = 'amostra/projeto-teste-2026-09-16-091529.grapesjs';
const ELEMENTOR = 'amostra/[Modelo] [Elementor] Carla Santos.json';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const frame = (page: Page) => page.frameLocator('.gjs-frame');
const slot = (page: Page, name: string, scope?: string) =>
  page.locator(`[data-testid="global-slot"][data-name="${name}"]${scope ? `[data-scope="${scope}"]` : ''}`);
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function createNimbus(page: Page, name = 'Globais') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

async function importFile(page: Page, path: string, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('https://cdn.grapesjs.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(/daniel-machado\.site|joanapinho\.pt/, (route) => route.abort('namenotresolved'));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort('internetdisconnected'));
  await page.goto('/importar');
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

/** Abre a ferramenta e confirma que abrir não mudou nada (revisão, estado, histórico). */
async function openGlobalStyles(page: Page) {
  const revision = await page.getByTestId('diag-revision').textContent();
  await tool(page, 'styles');
  await expect(page.getByTestId('global-styles-panel')).toBeVisible();
  await expect(page.getByTestId('global-scope-note')).toHaveText(/Estas alterações afetam todas as páginas que utilizam este estilo\./);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(await page.getByTestId('diag-revision').textContent()).toBe(revision);
}

async function setValue(s: Locator, value: string) {
  const input = s.getByTestId('global-value');
  await input.fill(value);
  await input.press('Enter');
}

/** Arrasto no seletor de cor: vários «input» e um «change» no fim. */
async function dragColor(s: Locator, values: string[]) {
  await s.getByTestId('global-color').evaluate((el, vs) => {
    if (!(el instanceof HTMLInputElement)) throw new Error('não é input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    for (const v of vs) {
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, values);
}

/** Abre uma ferramenta do painel esquerdo (clicar na ativa recolhia o painel). */
async function tool(page: Page, id: string) {
  const b = page.getByTestId(`tool-${id}`);
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
}

async function save(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

async function addPageWith(page: Page, blocks: string[]) {
  await tool(page, 'layers');
  await page.getByTestId('page-add').click();
  await tool(page, 'blocks');
  for (const b of blocks) await page.getByTestId(`block-${b}`).click();
}

const pageRow = (page: Page, index: number) => page.getByTestId('page-row').nth(index);
async function goToPage(page: Page, index: number) {
  await tool(page, 'layers');
  await pageRow(page, index).click();
  await expect(pageRow(page, index)).toHaveAttribute('aria-current', 'page');
}

async function slideWidths(f: FrameLocator): Promise<number[]> {
  return f.locator('[data-bolt-type="carousel"]').evaluateAll((roots) =>
    roots.map((r) => [...(r.querySelector('[data-bolt-type="carousel-track"]')?.children ?? [])].filter((x) => !x.hasAttribute('data-bolt-clone')).length),
  );
}

test('template nativo: cor e fonte partilhadas em duas páginas, valor próprio, telemóvel, histórico, reabrir, template independente e Escape', async ({ page }) => {
  test.setTimeout(180_000);
  await createNimbus(page);
  // Personalização própria: o título principal tem cor própria.
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await page.getByTestId('style-color').fill('#123456');
  await page.getByTestId('style-color').press('Enter');
  await expect.poll(() => css(h1, 'color')).toBe('rgb(18, 52, 86)');
  await expect(page.getByTestId('global-override-note')).toContainText('própria deste elemento');
  // Segunda página com um título e um botão (sem estilos próprios).
  await addPageWith(page, ['heading', 'button']);
  await save(page);
  const h2p2 = frame(page).getByText('Novo título');
  const btnp2 = frame(page).locator('.bolt-btn').first();
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  await openGlobalStyles(page);
  await expect(slot(page, '--bolt-primary')).toBeVisible();
  await expect(page.getByTestId('global-reset-all')).toBeDisabled();
  // Nomes amigáveis primeiro; a variável e o seletor ficam como informação secundária.
  const btnBg = page.locator('[data-testid="global-slot"][data-name="background-color"][data-scope=".bolt-btn"]');
  await expect(btnBg.getByTestId('global-resolved')).toContainText('definido em «Cor principal»');
  await expect(btnBg.getByTestId('global-tech')).toHaveText('background-color em .bolt-btn');
  await expect(slot(page, '--bolt-primary').getByTestId('global-tech')).toHaveText('--bolt-primary em body');

  // Cor partilhada por arrasto: um único passo de histórico.
  await dragColor(slot(page, '--bolt-heading'), ['#111111', '#555555', '#b91c1c']);
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#b91c1c');
  await page.getByTestId('undo').click();
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#0f172a');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#b91c1c');

  // Fonte partilhada.
  await slot(page, '--bolt-font-heading').getByTestId('global-font').selectOption({ label: 'Com serifa (Georgia)' });
  // Cor principal alterada e reposta pelo próprio campo.
  await setValue(slot(page, '--bolt-primary'), '#e11d48');
  await expect(slot(page, '--bolt-primary').getByTestId('global-reset')).toBeVisible();
  await slot(page, '--bolt-primary').getByTestId('global-reset').click();
  await expect(slot(page, '--bolt-primary').getByTestId('global-value')).toHaveValue('#4f46e5');
  await setValue(slot(page, '--bolt-primary'), '#e11d48');

  // Página 1: títulos seguem (exceto o que tem cor própria); botão segue a cor principal.
  await goToPage(page, 0);
  const sectionTitle = frame(page).locator('h2').first();
  await expect.poll(() => css(sectionTitle, 'color')).toBe('rgb(185, 28, 28)');
  await expect.poll(() => css(sectionTitle, 'font-family')).toContain('Georgia');
  await expect.poll(() => css(h1, 'color')).toBe('rgb(18, 52, 86)');
  await expect.poll(() => css(frame(page).locator('.bolt-btn').first(), 'background-color')).toBe('rgb(225, 29, 72)');
  // Telemóvel: a regra responsiva do título continua a aplicar-se.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect.poll(() => css(h1, 'font-size')).toBe('34px');
  await page.getByRole('button', { name: 'Computador', exact: true }).click();
  // Página 2: o mesmo estilo global.
  await goToPage(page, 1);
  await expect.poll(() => css(h2p2, 'color')).toBe('rgb(185, 28, 28)');
  await expect.poll(() => css(h2p2, 'font-family')).toContain('Georgia');
  await expect.poll(() => css(btnp2, 'background-color')).toBe('rgb(225, 29, 72)');

  // Pré-visualização: a fonte aparece; Escape com o foco no iframe fecha e devolve o foco.
  await page.getByTestId('open-preview').click();
  const pv = page.frameLocator('[data-testid="preview-frame"]');
  await expect.poll(() => css(pv.getByText('Novo título'), 'font-family')).toContain('Georgia');
  await pv.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project-preview')).toHaveCount(0);
  await expect(page.getByTestId('open-preview')).toBeFocused();

  // Guardar, F5 e reabrir.
  await save(page);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await tool(page, 'styles');
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#b91c1c');
  await expect(slot(page, '--bolt-primary').getByTestId('global-value')).toHaveValue('#e11d48');
  await expect.poll(() => css(frame(page).locator('h2').first(), 'font-family')).toContain('Georgia');

  // Template e cópia independente.
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill('Globais T');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  const fromTemplate = async (name: string) => {
    await page.goto('/templates');
    await page.getByTestId('team-template-card').filter({ hasText: 'Globais T' }).getByTestId('use-team-template').click();
    await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
    await expect(page.getByTestId('save-status')).toHaveText(SAVED);
    await tool(page, 'layers');
    await expect(page.getByTestId('page-row')).toHaveCount(2);
    await tool(page, 'styles');
  };
  await fromTemplate('Cópia A');
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#b91c1c');
  await setValue(slot(page, '--bolt-heading'), '#00aa00');
  await save(page);
  await fromTemplate('Cópia B');
  await expect(slot(page, '--bolt-heading').getByTestId('global-value')).toHaveValue('#b91c1c');
});

test('amostra Studio: variáveis ligadas editadas no registo, fonte do corpo, duas páginas, valor próprio, menu e carrosséis', async ({ page }) => {
  test.setTimeout(180_000);
  await importFile(page, STUDIO, 'Studio globais');
  await openGlobalStyles(page);
  await expect(slot(page, '--gjs-t-color-primary')).toContainText('Primary');

  const root = frame(page).locator('html');
  // Um elemento do tema que mostrava a cor principal (sem cor própria) passa à nova.
  const themed = frame(page).locator('.gjs-t-link, .gjs-t-h2');
  const idx = await themed.evaluateAll((els) => els.findIndex((el) => getComputedStyle(el).color === 'rgb(34, 211, 238)'));
  expect(idx).toBeGreaterThanOrEqual(0);
  const link = themed.nth(idx);
  await setValue(slot(page, '--gjs-t-color-primary'), '#ff6600');
  await expect.poll(() => css(root, '--gjs-t-color-primary')).toBe('#ff6600');
  await expect.poll(() => css(link, 'color')).toBe('rgb(255, 102, 0)');
  const bodyFont = slot(page, 'font-family', '.gjs-t-body');
  await bodyFont.getByTestId('global-font').selectOption({ label: 'Com serifa (Georgia)' });
  // O corpo do tema é o elemento com a classe global (wrapper da página).
  const body = frame(page).locator('.gjs-t-body').first();
  await expect.poll(() => css(body, 'font-family')).toContain('Georgia');
  // Elemento com fonte própria (regra #id) mantém a sua, e o inspetor explica porquê.
  const own = frame(page).locator('#iplayer2rank');
  await expect.poll(() => css(own, 'font-family')).toContain('Barlow');
  await own.click();
  await expect(page.getByTestId('global-override-note')).toContainText('A fonte é própria deste elemento');

  // Desfazer/refazer.
  await page.getByTestId('undo').click();
  await expect.poll(() => css(body, 'font-family')).toContain('Barlow');
  await page.getByTestId('redo').click();
  await expect.poll(() => css(body, 'font-family')).toContain('Georgia');

  // Segunda página: segue o corpo global (fundo e fonte) e a cor dos títulos H2 do tema.
  await addPageWith(page, ['heading']);
  const body2 = frame(page).locator('.gjs-t-body').first();
  await expect.poll(() => css(body2, 'font-family')).toContain('Georgia');
  await expect.poll(() => css(body2, 'background-color')).toBe('rgb(11, 14, 20)');

  // Guardar, F5, reabrir.
  await save(page);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await tool(page, 'styles');
  await expect(slot(page, '--gjs-t-color-primary').getByTestId('global-value')).toHaveValue('#ff6600');
  await expect.poll(() => css(frame(page).locator('html'), '--gjs-t-color-primary')).toBe('#ff6600');

  // Menu e carrosséis continuam funcionais (pré-visualização).
  await page.getByTestId('open-preview').click();
  const pv = page.frameLocator('[data-testid="preview-frame"]');
  await expect.poll(() => slideWidths(pv)).toEqual([3, 4, 3]);
  await page.getByRole('dialog').getByRole('button', { name: 'Telemóvel' }).click();
  const menu = pv.locator('[data-bolt-type="menu"]').first();
  await menu.locator('[data-bolt-type="menu-toggle"]').click();
  await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeVisible();
});

test('amostra Elementor: sem configuração global → criar explicitamente; texto e fonte do corpo em duas páginas; valores próprios mantidos', async ({ page }) => {
  test.setTimeout(180_000);
  await importFile(page, ELEMENTOR, 'Elementor globais');
  await openGlobalStyles(page);
  const setup = page.getByTestId('global-setup');
  await expect(setup).toContainText('não tem variáveis globais');
  await expect(setup).toContainText('#333333');
  await expect(setup).toContainText('continuam com elas');
  await page.getByTestId('global-create').click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByTestId('save-status')).not.toHaveText(SAVED);

  // Um título de Elementor com cor e fonte próprias.
  const ownTitle = frame(page).locator('.elementor-heading-title').first();
  const ownColor = await css(ownTitle, 'color');
  const ownFont = await css(ownTitle, 'font-family');

  await setValue(slot(page, '--bolt-text'), '#aa0000');
  await slot(page, '--bolt-font-body').getByTestId('global-font').selectOption({ label: 'Com serifa (Georgia)' });
  await expect.poll(() => css(frame(page).locator('body'), 'color')).toBe('rgb(170, 0, 0)');
  expect(await css(ownTitle, 'color')).toBe(ownColor);
  expect(await css(ownTitle, 'font-family')).toBe(ownFont);
  await ownTitle.click();
  await expect(page.getByTestId('global-override-note')).toContainText('própria deste elemento');

  // Desfazer/refazer: a fonte e depois a cor.
  const body = frame(page).locator('body');
  await page.getByTestId('undo').click();
  await expect.poll(() => css(body, 'font-family')).not.toContain('Georgia');
  await page.getByTestId('undo').click();
  await expect.poll(() => css(body, 'color')).toBe('rgb(51, 51, 51)');
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await expect.poll(() => css(body, 'font-family')).toContain('Georgia');
  await expect.poll(() => css(body, 'color')).toBe('rgb(170, 0, 0)');

  await addPageWith(page, ['heading']);
  const t2 = frame(page).getByText('Novo título');
  await expect.poll(() => css(t2, 'color')).toBe('rgb(170, 0, 0)');
  await expect.poll(() => css(t2, 'font-family')).toContain('Georgia');

  await save(page);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await tool(page, 'styles');
  await expect(page.getByTestId('global-setup')).toHaveCount(0);
  await expect(slot(page, '--bolt-text').getByTestId('global-value')).toHaveValue('#aa0000');
});
