import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Painel esquerdo por ferramentas: barra vertical (Adicionar, Estrutura, Imagens), painel ao
 * lado, recolher, e as ferramentas existentes reaproveitadas (browser real, modo local).
 */
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const layer = (page: Page, name: string) => page.getByTestId('layer-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) }).first();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function createNimbus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('sem caixa');
  return b;
}

test('alternar e recolher os três painéis; o conteúdo do projeto não muda', async ({ page }) => {
  await createNimbus(page);
  const revision = await page.getByTestId('diag-revision').textContent();
  // Estrutura aberta por omissão.
  await expect(page.getByTestId('tool-layers')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'layers');

  for (const tool of ['blocks', 'images', 'layers'] as const) {
    await page.getByTestId(`tool-${tool}`).click();
    await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', tool);
    await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-pressed', 'true');
  }

  // Recolher: o painel sai, a barra fica, o canvas ganha o espaço e a moldura mantém 1280 px.
  const wrapBefore = await box(page.locator('.canvas-wrap'));
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await expect(page.getByTestId('tool-layers')).toBeVisible();
  await expect(page.getByTestId('tool-layers')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await box(page.locator('.canvas-wrap'))).width).toBeGreaterThan(wrapBefore.width + 200);
  expect(await frame(page).locator('body').evaluate(() => window.innerWidth)).toBe(1280);
  // Sem scroll horizontal da aplicação.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Barra contextual acompanha o novo espaço.
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  const t = await box(page.getByTestId('canvas-toolbar'));
  const e = await box(h1);
  expect(t.x < e.x + e.width && t.x + t.width > e.x).toBe(true);
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('left-panel')).toBeVisible();
  await expect.poll(async () => {
    const tb = await box(page.getByTestId('canvas-toolbar'));
    const el = await box(h1);
    return tb.x < el.x + el.width && tb.x + tb.width > el.x;
  }).toBe(true);

  // Só mudar de painel não altera o documento.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  expect(await page.getByTestId('diag-revision').textContent()).toBe(revision);
});

test('teclado: setas percorrem a barra, Enter abre e recolhe, foco visível e nomes acessíveis', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('tool-blocks').focus();
  await expect(page.getByTestId('tool-blocks')).toHaveAccessibleName('Adicionar componentes');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tool-layers')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tool-images')).toBeFocused();
  await expect(page.getByTestId('tool-images')).toHaveAccessibleName('Imagens do projeto');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'images');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  const ring = await page.getByTestId('tool-images').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');
});

test('seleção pela árvore e pelo canvas; adicionar pelo painel e pelo «+» com o destino preservado', async ({ page }) => {
  await createNimbus(page);
  // Árvore → canvas.
  await layer(page, 'Título').click();
  await expect(frame(page).locator('.gjs-selected')).toHaveText(/Decisões de marketing/);
  // Canvas → árvore.
  await frame(page).getByText('Tudo o que a equipa precisa', { exact: false }).first().click();
  await expect(page.getByTestId('layer-row').filter({ hasText: 'Tudo o que a equipa' }).first()).toHaveAttribute('aria-selected', 'true');

  // Painel Adicionar (sem destino): insere junto à seleção.
  await page.getByTestId('tool-blocks').click();
  await expect(page.getByTestId('blocks-target')).toHaveCount(0);
  const before = await frame(page).getByText('Novo parágrafo', { exact: false }).count();
  await page.getByTestId('block-text').click();
  await expect(frame(page).getByText('Novo parágrafo', { exact: false })).toHaveCount(before + 1);

  // «+» contextual → painel Adicionar com o destino «Antes de» preservado.
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await page.getByTestId('ct-insert').click();
  await page.getByTestId('insert-pos-before').click();
  await page.getByTestId('insert-open-panel').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'blocks');
  await expect(page.getByTestId('blocks-target')).toContainText('Antes de «Título»');
  await expect(page.getByTestId('block-section')).toBeDisabled(); // incompatível numa coluna
  await page.getByTestId('block-heading').click();
  await expect(h1.locator('xpath=preceding-sibling::*[1]')).toHaveText('Novo título');
  await expect(page.getByTestId('blocks-target')).toHaveCount(0); // destino usado uma vez

  // Desfazer e refazer continuam.
  await page.getByTestId('undo').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(0);
  await page.getByTestId('redo').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
});

test('Imagens: abrir e carregar não altera nada; substituir e inserir são ações distintas; gravar e reabrir', async ({ page }) => {
  await createNimbus(page);
  const imgCount = await frame(page).locator('img').count();
  await page.getByTestId('tool-images').click();
  const panel = page.getByTestId('images-panel');
  // Sem imagem selecionada, «Substituir» está desativado.
  await frame(page).locator('h1').first().click();
  await page.getByTestId('images-file-input').setInputFiles({ name: 'nova.png', mimeType: 'image/png', buffer: PNG });
  const newTile = panel.getByTestId('image-tile').filter({ has: page.locator('img[src^="data:image/png"]') }).first();
  await expect(newTile).toBeVisible();
  await expect(newTile.getByTestId('image-replace')).toBeDisabled();
  // Carregar não mexeu no documento.
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(await frame(page).locator('img').count()).toBe(imgCount);

  // Substituir a imagem selecionada.
  const heroImg = frame(page).locator('img').first();
  const heroId = await heroImg.getAttribute('id');
  await heroImg.click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await newTile.getByTestId('image-replace').click();
  await expect(frame(page).locator(`#${heroId ?? ''}`)).toHaveAttribute('src', /^data:image\/png/);
  expect(await frame(page).locator('img').count()).toBe(imgCount);

  // Inserir cria uma imagem nova e não troca a selecionada.
  await newTile.getByTestId('image-insert').click();
  await expect(frame(page).locator('img')).toHaveCount(imgCount + 1);
  await expect(frame(page).locator(`#${heroId ?? ''}`)).toHaveAttribute('src', /^data:image\/png/);

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await page.reload();
  await expect(frame(page).locator('img')).toHaveCount(imgCount + 1);
  await expect(frame(page).locator(`#${heroId ?? ''}`)).toHaveAttribute('src', /^data:image\/png/);
  // Depois de recarregar abre de novo em Estrutura (o padrão; o painel não é gravado no projeto).
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'layers');
});

test('arrasto no canvas e barra contextual continuam com o painel recolhido', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('tool-layers').click();
  const h1 = frame(page).locator('h1').first();
  const col = h1.locator('xpath=..');
  const p = h1.locator('xpath=following-sibling::p[1]');
  const initial = await col.locator('> *').evaluateAll((els) => els.map((el) => el.id));
  await h1.click();
  const s = await box(page.getByTestId('ct-move'));
  const d = await box(p);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height - 4, { steps: 12 });
  await page.mouse.move(d.x + d.width / 2 + 2, d.y + d.height - 4, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((el) => el.id))).not.toEqual(initial);
  await page.getByTestId('undo').click();
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((el) => el.id))).toEqual(initial);
});

test('Adicionar: pesquisa por nome e categorias sobre os componentes existentes', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('blocks-search').fill('titulo'); // sem acento
  await expect(page.locator('.block-tile')).toHaveCount(1);
  await expect(page.getByTestId('block-heading')).toBeVisible();
  await page.getByTestId('blocks-search').fill('xyz');
  await expect(page.getByTestId('blocks-empty')).toBeVisible();
  await page.getByTestId('blocks-search').fill('');
  await page.getByTestId('blocks-cat-text').click();
  await expect(page.getByTestId('blocks-cat-text')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.block-tile')).toHaveCount(2);
  await page.getByTestId('blocks-cat-layout').click();
  await expect(page.locator('.block-tile')).toHaveCount(2);
  await expect(page.getByTestId('block-section')).toBeVisible();
  await page.getByTestId('blocks-cat-all').click();
  await expect(page.locator('.block-tile')).toHaveCount(6);
  // Pesquisar não altera o documento.
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('destino do «+» eliminado com o painel aberto: avisa, não insere noutro sítio, e cancelar repõe', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await page.getByTestId('ct-insert').click();
  await page.getByTestId('insert-pos-after').click();
  await page.getByTestId('insert-open-panel').click();
  await expect(page.getByTestId('blocks-target')).toContainText('Depois de «Título»');
  const headings = await frame(page).locator('h1, h2, h3').count();

  // Eliminar o elemento de destino (pela barra contextual).
  await h1.click();
  await page.getByTestId('ct-delete').click();
  await expect(page.getByTestId('blocks-target')).toContainText('foi eliminado');
  await expect(page.getByTestId('block-heading')).toBeDisabled();
  await page.getByTestId('block-heading').click({ force: true });
  expect(await frame(page).locator('h1, h2, h3').count()).toBe(headings - 1); // nada inserido

  // Cancelar o destino: volta ao modo normal (junto à seleção).
  await page.getByTestId('blocks-target-cancel').click();
  await expect(page.getByTestId('blocks-target')).toHaveCount(0);
  await expect(page.getByTestId('block-heading')).toBeEnabled();
  await page.getByTestId('block-heading').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
});

test('Imagens em modo local: aviso explícito; imagem carregada e não usada não fica após F5 (limitação documentada)', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('tool-images').click();
  await expect(page.getByTestId('images-local-note')).toContainText('só fica guardada quando for usada');
  await page.getByTestId('images-file-input').setInputFiles({ name: 'nao-usada.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('images-available').getByTestId('image-tile')).toHaveCount(1);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.reload();
  await page.getByTestId('tool-images').click();
  await expect(page.getByTestId('images-available')).toHaveCount(0);
  await expect(page.getByTestId('images-local-note')).toBeVisible();
  // As imagens usadas continuam na secção «Nesta página».
  await expect(page.getByTestId('images-on-page').getByTestId('image-tile')).not.toHaveCount(0);
});
