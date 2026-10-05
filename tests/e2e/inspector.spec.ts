import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Inspetor de estilos no browser real (modo local, dados de teste). Verifica que abrir não
 * altera o documento, que cada grupo escreve na regra própria do dispositivo em edição, que
 * repor volta ao estilo herdado, e o histórico e a gravação.
 */
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const layer = (page: Page, name: string) => page.getByTestId('layer-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) }).first();
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const GROUPS = ['typography', 'layout', 'size', 'spacing', 'background', 'borders', 'effects', 'position'] as const;

async function createNimbus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function openGroup(page: Page, g: (typeof GROUPS)[number]) {
  const head = page.getByTestId(`group-${g}`);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

async function setField(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await input.press('Enter');
}

async function importSample(page: Page, file: string, name: string) {
  await page.route('https://cdn.grapesjs.com/**', (r) => r.abort());
  await page.route(/daniel-machado\.site|joanapinho\.pt|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('import-name').fill(name);
  const partial = page.getByTestId('import-accept-partial');
  if (await partial.count()) await partial.check();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser', { timeout: 60_000 });
}

test('abrir o inspetor e selecionar elementos não altera o documento', async ({ page }) => {
  await createNimbus(page);
  const revision = await page.getByTestId('diag-revision').textContent();
  for (const name of ['Título', 'Coluna', 'Secção', 'Imagem', 'Botão']) {
    await layer(page, name).click();
    for (const g of GROUPS) {
      const head = page.getByTestId(`group-${g}`);
      if (await head.count()) await openGroup(page, g);
    }
    await expect(page.getByTestId('style-inspector')).toBeVisible();
  }
  await page.waitForTimeout(1600); // mais do que a gravação automática
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  expect(await page.getByTestId('diag-revision').textContent()).toBe(revision);
});

test('layout, espaçamento ligado, fundo, bordas e efeitos escrevem no elemento; desfazer e refazer', async ({ page }) => {
  await createNimbus(page);
  await layer(page, 'Coluna').click();
  const col = frame(page).locator('.gjs-selected');
  const colId = await col.getAttribute('id');
  const el = frame(page).locator(`#${colId ?? ''}`);

  // Layout: controlos flex só aparecem depois de escolher Flex.
  await openGroup(page, 'layout');
  await expect(page.getByTestId('style-flex-direction')).toHaveCount(0);
  await page.getByTestId('style-display').selectOption('flex');
  await expect(page.getByTestId('style-flex-direction')).toBeVisible();
  await page.getByTestId('style-flex-direction').selectOption('column');
  await page.getByTestId('style-align-items').selectOption('center');
  await setField(page, 'style-gap', '24');
  await expect.poll(() => css(el, 'display')).toBe('flex');
  expect(await css(el, 'flex-direction')).toBe('column');
  expect(await css(el, 'gap')).toBe('24px');
  await expect(page.locator('[data-prop="display"] .source-tag')).toHaveText('Neste dispositivo');

  // Espaçamento com os quatro lados ligados: um valor, quatro lados, um passo.
  await openGroup(page, 'spacing');
  await page.getByTestId('link-padding').click();
  await setField(page, 'style-padding-top', '20');
  await expect.poll(() => css(el, 'padding-left')).toBe('20px');
  expect([await css(el, 'padding-top'), await css(el, 'padding-right'), await css(el, 'padding-bottom')]).toEqual(['20px', '20px', '20px']);
  await page.getByTestId('undo').click();
  await expect.poll(() => css(el, 'padding-left')).not.toBe('20px');
  expect(await css(el, 'padding-top')).not.toBe('20px');
  await page.getByTestId('redo').click();
  await expect.poll(() => css(el, 'padding-right')).toBe('20px');

  // Fundo: cor e imagem pela seleção de imagens existente.
  await openGroup(page, 'background');
  await setField(page, 'style-background-color', '#fef3c7'); // campo de texto da cor
  await expect.poll(() => css(el, 'background-color')).toBe('rgb(254, 243, 199)');
  await page.getByTestId('pick-background').click();
  const dialog = page.getByRole('dialog', { name: 'Imagem de fundo' });
  await dialog.getByPlaceholder('https://…').fill('https://exemplo.pt/fundo.png');
  await expect(dialog.getByRole('button', { name: 'Usar esta imagem' }).first()).toBeVisible(); // imagens da página reutilizáveis
  await dialog.getByRole('button', { name: 'Usar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => css(el, 'background-image')).toContain('https://exemplo.pt/fundo.png');
  await expect(page.getByTestId('style-background-size')).toBeVisible(); // só com imagem
  await page.getByTestId('style-background-size').selectOption('cover');
  await expect.poll(() => css(el, 'background-size')).toBe('cover');

  // Bordas.
  await openGroup(page, 'borders');
  await setField(page, 'style-border-width', '3');
  await page.getByTestId('style-border-style').selectOption('dashed');
  await expect.poll(() => css(el, 'border-top-style')).toBe('dashed');
  expect(await css(el, 'border-top-width')).toBe('3px');

  // Efeitos: arrastar a opacidade é um único passo de histórico.
  await openGroup(page, 'effects');
  const range = page.getByTestId('range-opacity');
  const r = await range.boundingBox();
  if (!r) throw new Error('range');
  await page.mouse.move(r.x + r.width - 4, r.y + r.height / 2);
  await page.mouse.down();
  for (const f of [0.9, 0.8, 0.7, 0.6, 0.5]) await page.mouse.move(r.x + r.width * f, r.y + r.height / 2);
  await page.mouse.up();
  await expect.poll(async () => Number(await css(el, 'opacity'))).toBeLessThan(0.7);
  await page.getByTestId('undo').click();
  await expect.poll(() => css(el, 'opacity')).toBe('1');
  await expect(page.getByTestId('style-border-style')).toHaveValue('dashed'); // o passo anterior mantém-se

  // Posição: campos de deslocamento só com posição diferente de «Normal».
  await openGroup(page, 'position');
  await expect(page.getByTestId('style-top')).toHaveCount(0);
  await page.getByTestId('style-position').selectOption('relative');
  await setField(page, 'style-top', '4');
  await setField(page, 'style-z-index', '3');
  await expect.poll(() => css(el, 'top')).toBe('4px');
  expect(await css(el, 'z-index')).toBe('3');

  // Guardar, F5 e reabrir.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await page.reload();
  const again = frame(page).locator(`#${colId ?? ''}`);
  await expect.poll(() => css(again, 'display')).toBe('flex');
  expect(await css(again, 'padding-bottom')).toBe('20px');
  expect(await css(again, 'border-top-style')).toBe('dashed');
  expect(await css(again, 'background-image')).toContain('fundo.png');
  expect(await css(again, 'position')).toBe('relative');
});

test('telemóvel escreve no breakpoint e preserva o computador; repor volta ao herdado', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await openGroup(page, 'spacing');
  await setField(page, 'style-padding-top', '30');
  await expect.poll(() => css(h1, 'padding-top')).toBe('30px');

  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect(page.getByTestId('device-banner')).toContainText('A editar: Telemóvel');
  await expect(page.locator('[data-prop="padding-top"]')).toHaveCount(0); // lados não têm cabeçalho próprio
  await expect(page.getByTestId('style-padding-top')).toHaveAttribute('placeholder', '30px'); // herdado do computador
  await setField(page, 'style-padding-top', '6');
  await expect.poll(() => css(h1, 'padding-top')).toBe('6px');

  await page.getByRole('button', { name: 'Computador', exact: true }).click();
  await expect(page.getByTestId('device-banner')).toContainText('A editar: Computador');
  await expect.poll(() => css(h1, 'padding-top')).toBe('30px');

  // Repor no telemóvel: remove só a alteração local; volta aos 30px do computador.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await page.getByTestId('reset-padding').click();
  await expect.poll(() => css(h1, 'padding-top')).toBe('30px');
  await expect(page.getByTestId('style-padding-top')).toHaveValue('');

  // Repor no computador volta ao estilo do tema (regra partilhada intacta).
  await page.getByRole('button', { name: 'Computador', exact: true }).click();
  await openGroup(page, 'typography');
  await setField(page, 'style-font-size', '20');
  await expect.poll(() => css(h1, 'font-size')).toBe('20px');
  await page.getByTestId('reset-font-size').click();
  await expect.poll(() => css(h1, 'font-size')).not.toBe('20px');
  await expect(page.locator('[data-prop="font-size"] .source-tag')).not.toHaveText('Neste dispositivo');
});

test('projeto Elementor: origem das regras importadas, edição móvel sem normalizar os breakpoints e repor', async ({ page }) => {
  test.setTimeout(120_000);
  await importSample(page, 'amostra/[Modelo] [Elementor] Carla Santos.json', 'Cópia Elementor inspetor');
  const heading = frame(page).locator('.elementor-heading-title').first();
  await heading.click();
  await openGroup(page, 'typography');
  // O tamanho vem de uma regra importada do elemento ou de uma classe; o inspetor não a copia.
  const tag = page.locator('[data-prop="font-size"] .source-tag');
  await expect(tag).toBeVisible();
  const original = await css(heading, 'font-size');

  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  const mobileBefore = await css(heading, 'font-size');
  await setField(page, 'style-font-size', '19');
  await expect.poll(() => css(heading, 'font-size')).toBe('19px');
  await page.getByRole('button', { name: 'Computador', exact: true }).click();
  await expect.poll(() => css(heading, 'font-size')).toBe(original);
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await page.getByTestId('reset-font-size').click();
  await expect.poll(() => css(heading, 'font-size')).toBe(mobileBefore);

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await page.reload();
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect.poll(() => css(frame(page).locator('.elementor-heading-title').first(), 'font-size')).toBe(mobileBefore);
});

test('projeto GrapesJS: editar pelo inspetor mantém menu móvel, carrossel e barra contextual', async ({ page }) => {
  test.setTimeout(120_000);
  await importSample(page, 'amostra/projeto-teste-2026-09-16-091529.grapesjs', 'Cópia Studio inspetor');
  const section = frame(page).locator('section').nth(1);
  await layer(page, 'Secção').click();
  await openGroup(page, 'spacing');
  await setField(page, 'style-margin-top', '12');
  await openGroup(page, 'borders');
  await setField(page, 'style-border-radius', '16');
  await expect(page.getByTestId('canvas-toolbar')).toBeVisible();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await page.reload();
  await expect.poll(() => frame(page).locator('[data-bolt-type="carousel"]').first().evaluate((c) => !!(c as HTMLElement & { __boltCarousel?: unknown }).__boltCarousel)).toBe(true);
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  const menu = frame(page).locator('[data-bolt-type="menu"]').first();
  await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeHidden();
  await menu.locator('[data-bolt-type="menu-toggle"]').click();
  await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeVisible();
  expect(await section.count()).toBe(1);
});

test('fonte do Google Fonts: escolher carrega as @font-face no projeto, outra pelo nome, erro legível e mantém-se depois de recarregar', async ({ page }) => {
  // Sem rede real: o CSS da Google é simulado (formato do css2) e os ficheiros de fonte são recusados.
  const asked: string[] = [];
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.searchParams.get('family') ?? '');
    const family = (url.searchParams.get('family') ?? '').split(':')[0] ?? '';
    if (family.startsWith('Nao Existe')) return route.fulfill({ status: 400, body: 'bad' });
    return route.fulfill({
      status: 200,
      contentType: 'text/css',
      headers: { 'access-control-allow-origin': '*' },
      body: `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(https://fonts.gstatic.com/s/teste/v1/a.woff2) format('woff2'); }`,
    });
  });
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await openGroup(page, 'typography');

  const select = page.getByTestId('style-font-family');
  await select.selectOption({ label: 'Poppins' });
  await expect.poll(() => css(h1, 'font-family')).toContain('Poppins');
  await expect(select).toHaveValue("'Poppins', sans-serif");
  await expect(select.locator('optgroup[label="Fontes do projeto"] option')).toHaveText(['Poppins (fonte do projeto)']);
  expect(asked).toEqual(['Poppins:wght@400;500;600;700;800']);

  // Outra família pelo nome.
  await select.selectOption({ label: 'Outra do Google Fonts…' });
  await page.getByTestId('style-font-family-other').fill('Quicksand');
  await page.getByTestId('style-font-family-other-add').click();
  await expect.poll(() => css(h1, 'font-family')).toContain('Quicksand');

  // Família inexistente: mensagem e nada muda.
  await select.selectOption({ label: 'Outra do Google Fonts…' });
  await page.getByTestId('style-font-family-other').fill('Nao Existe');
  await page.getByTestId('style-font-family-other-add').click();
  await expect(page.getByTestId('style-font-family-error')).toContainText('não existe no Google Fonts');
  expect(await css(h1, 'font-family')).toContain('Quicksand');

  // As @font-face são estilos do projeto, desenhados no canvas.
  const faces = () => frame(page).locator('body').evaluate(() => [...document.querySelectorAll('style')].map((x) => x.textContent ?? '').filter((t) => t.includes('@font-face')).join('\n'));
  expect(await faces()).toContain("font-family:'Poppins'");
  // Gravado: depois de recarregar, a fonte e as @font-face continuam no projeto.
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await page.reload();
  await expect.poll(() => css(frame(page).locator('h1').first(), 'font-family')).toContain('Quicksand');
  await expect.poll(faces).toContain("font-family:'Poppins'");
  expect(await faces()).toContain("font-family:'Quicksand'");
});
