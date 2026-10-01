import { expect, test, type Page } from '@playwright/test';

/**
 * Seleção sincronizada entre o canvas e «Páginas e camadas» (modo local, página importada real).
 * A seleção é a do motor; a árvore abre só o caminho necessário, destaca a linha do componente REAL
 * e desloca só a lista de camadas. Selecionar não altera o documento, o histórico nem a gravação.
 */
const ZIP = 'amostra/startbootstrap-stylish-portfolio-gh-pages.zip';
const SAVED = 'Alterações guardadas neste browser';
const canvas = (page: Page) => page.frameLocator('.gjs-frame');

/** Seleção no canvas (classe do motor) e linhas destacadas na árvore. */
async function sync(page: Page) {
  const inCanvas = await canvas(page).locator('.gjs-selected').evaluateAll((els) => els.map((e) => e.id));
  const rows = await page.locator('[data-testid="layer-row"][aria-selected="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-layer-id')));
  return { inCanvas, rows };
}

/** A linha destacada é a do elemento selecionado no canvas e está dentro da área visível da lista. */
async function expectRevealed(page: Page, id: string) {
  await expect.poll(() => sync(page)).toEqual({ inCanvas: [id], rows: [id] });
  const row = page.locator(`[data-testid="layer-row"][data-layer-id="${id}"]`);
  const list = await page.getByTestId('layers-list').boundingBox();
  await expect.poll(async () => {
    const r = await row.boundingBox();
    return !!r && !!list && r.y >= list.y - 1 && r.y + r.height <= list.y + list.height + 1;
  }).toBe(true);
}

/** Id do elemento que o motor selecionou no canvas (o clique pode escolher o texto dentro do título). */
const selectedInCanvas = async (page: Page) => (await canvas(page).locator('.gjs-selected').first().evaluate((el) => ({ id: el.id, text: el.textContent ?? '' })));

const appScroll = (page: Page) => page.evaluate(() => [window.scrollY, document.scrollingElement?.scrollTop ?? 0]);
/** Abre «Páginas e camadas» (o botão alterna: só se clica se estiver fechado). */
async function openLayers(page: Page) {
  const b = page.getByTestId('tool-layers');
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'layers');
}

const canvasScroll = (page: Page) => canvas(page).locator('body').evaluate(() => Math.round(window.scrollY));

test('canvas ↔ camadas: revelar, destacar, sem mexer no canvas, na página nem no documento', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route(/use\.fontawesome|cdnjs|fonts\.(googleapis|gstatic)|google\.com|jsdelivr/, (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(ZIP);
  await page.getByTestId('import-accept-partial').check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\//, { timeout: 60_000 });
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await openLayers(page);
  const list = page.getByTestId('layers-list');
  const rev = await page.getByTestId('diag-revision').textContent();

  // 1. Caso do print: título «Welcome to your next website!», mais abaixo na página.
  const welcome = canvas(page).locator('.callout h2').first();
  await welcome.scrollIntoViewIfNeeded();
  const scrollBefore = await canvasScroll(page);
  await welcome.click();
  const welcomeId = await welcome.evaluate((el) => el.id);
  await expectRevealed(page, welcomeId);
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0); // a lista desceu até à linha
  expect(await canvasScroll(page)).toBe(scrollBefore); // o canvas não se mexeu
  expect(await appScroll(page)).toEqual([0, 0]); // nem a página da aplicação
  // O caminho até ao título está aberto; o cartão do portfólio (outro ramo) continua como estava.
  await expect(page.locator(`[data-layer-id="${welcomeId}"]`)).toBeVisible();

  // 2. Linha já visível: a lista não se desloca.
  const listTop = await list.evaluate((el) => el.scrollTop);
  await page.locator(`[data-testid="layer-row"][data-layer-id="${welcomeId}"]`).click();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(listTop);

  // 3. Títulos com o mesmo nome: a linha é a do componente real (o 2.º «Título» dos serviços).
  const second = canvas(page).locator('#services .col-lg-3 h4').nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.click();
  const sel2 = await selectedInCanvas(page);
  expect(sel2.text).toBe('Redesigned');
  await expectRevealed(page, sel2.id);
  const firstId = await canvas(page).locator('#services .col-lg-3 h4').first().evaluate((el) => el.querySelector('strong')?.id ?? el.id);
  expect(sel2.id).not.toBe(firstId);

  // 4. Elemento profundamente aninhado (ícone dentro do círculo do serviço).
  const icon = canvas(page).locator('#services .service-icon').nth(2);
  await icon.scrollIntoViewIfNeeded();
  await icon.click({ position: { x: 6, y: 30 } });
  await expectRevealed(page, (await selectedInCanvas(page)).id);

  // 5. Pela árvore: escolher uma imagem do portfólio seleciona-a no canvas e no inspetor.
  const imgId = await canvas(page).locator('#portfolio img').nth(3).evaluate((el) => el.id);
  await canvas(page).locator('#portfolio .caption').nth(3).click();
  await page.locator(`[data-testid="layer-row"][data-layer-id="${imgId}"]`).click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await expectRevealed(page, imgId);

  // Só selecionar: nada mudou no documento, no histórico nem na gravação.
  expect(await page.getByTestId('diag-revision').textContent()).toBe(rev);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // 6. Selecionar o pai, duplicar, eliminar, desfazer e refazer: nunca fica uma linha antiga marcada.
  await welcome.scrollIntoViewIfNeeded();
  await welcome.click();
  await page.getByTestId('ct-parent').click();
  const parentId = await welcome.evaluate((el) => el.parentElement?.id ?? '');
  await expectRevealed(page, parentId);
  await page.getByTestId('ct-duplicate').click();
  await expect.poll(async () => (await sync(page)).rows.length).toBe(1);
  const afterDup = await sync(page);
  expect(afterDup.rows).toEqual(afterDup.inCanvas);
  await page.getByTestId('ct-delete').click();
  await expect.poll(async () => {
    const s = await sync(page);
    return s.rows.length <= 1 && JSON.stringify(s.rows) === JSON.stringify(s.inCanvas);
  }).toBe(true);
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  await page.getByTestId('redo').click();
  await expect.poll(async () => {
    const s = await sync(page);
    return s.rows.length <= 1 && JSON.stringify(s.rows) === JSON.stringify(s.inCanvas);
  }).toBe(true);

  // 7. Noutro painel a ferramenta não muda; ao voltar, a seleção atual é revelada.
  await page.getByTestId('tool-images').click();
  await welcome.scrollIntoViewIfNeeded();
  await welcome.click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'images');
  await openLayers(page);
  await expectRevealed(page, welcomeId);

  // 8. Mudar de página: sem linhas da página anterior; ao voltar, a seleção desta página.
  await page.getByTestId('page-add').click();
  await expect.poll(async () => (await sync(page)).rows).toEqual([]);
  await page.getByTestId('page-row').first().click();
  await welcome.scrollIntoViewIfNeeded();
  await welcome.click();
  await expectRevealed(page, welcomeId);
});
