import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Edição direta no canvas: barra de ferramentas contextual, inserção pelo «+» e arrasto pelo
 * mecanismo do motor. Cada teste corre num browser limpo (dados de teste, modo local).
 */
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const toolbar = (page: Page) => page.getByTestId('canvas-toolbar');
const layer = (page: Page, text: string) => page.getByTestId('layer-row').filter({ hasText: text }).first();
/** Linha da árvore cujo nome é exatamente `name` (ex.: «Coluna» e não «Colunas»). */
const layerNamed = (page: Page, name: string) => page.getByTestId('layer-row').filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) }).first();

async function createNimbus(page: Page, name = 'Direta') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('sem caixa');
  return b;
}

/** A barra fica junto ao elemento: por cima (ou no topo por dentro) e sobreposta na horizontal. */
async function expectToolbarAt(page: Page, target: Locator) {
  await expect.poll(async () => {
    const t = await box(toolbar(page));
    const e = await box(target);
    const wrap = await box(page.locator('.canvas-wrap'));
    const vertical = Math.abs(t.y + t.height + 6 - e.y) <= 3 || Math.abs(t.y - (e.y + 6)) <= 3 || Math.abs(t.y - (wrap.y + 6)) <= 3;
    const horizontal = t.x < e.x + e.width + 2 && t.x + t.width > e.x - 2;
    const inside = t.x >= wrap.x - 1 && t.x + t.width <= wrap.x + wrap.width + 1 && t.y >= wrap.y - 1 && t.y + t.height <= wrap.y + wrap.height + 1;
    return vertical && horizontal && inside;
  }).toBe(true);
}

async function drag(page: Page, from: Locator, to: Locator, where: 'top' | 'bottom', opts: { cancel?: boolean } = {}) {
  const s = await box(from);
  const d = await box(to);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  const y = where === 'top' ? d.y + Math.min(6, d.height / 4) : d.y + d.height - Math.min(6, d.height / 4);
  await page.mouse.move(d.x + d.width / 2, y, { steps: 12 });
  await page.mouse.move(d.x + d.width / 2 + 2, y, { steps: 2 });
  if (opts.cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}


test('seleção pelo canvas e pela árvore; a barra acompanha scroll, zoom e dispositivo', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await expect(page.getByTestId('canvas-toolbar-name')).toHaveText('Título');
  await expectToolbarAt(page, h1);
  // Uma só seleção: árvore, barra fixa e barra contextual mostram o mesmo elemento.
  await expect(layer(page, 'Decisões de marketing')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('selected-name')).toHaveText('Título');

  // Pela árvore.
  await layer(page, 'Tudo o que a equipa precisa').click();
  const h2 = frame(page).getByText('Tudo o que a equipa precisa', { exact: false }).first();
  await expect(page.getByTestId('canvas-toolbar-name')).toHaveText('Título');
  await expectToolbarAt(page, h2);

  // Scroll dentro do canvas.
  await frame(page).locator('body').evaluate(() => window.scrollBy(0, 300));
  await expectToolbarAt(page, h2);

  // Dispositivo (muda largura e zoom). O layout muda, por isso traz-se o elemento à vista.
  for (const device of ['Telemóvel', 'Tablet', 'Computador']) {
    await page.getByRole('button', { name: device, exact: true }).click();
    await h2.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expectToolbarAt(page, h2);
  }

  // Elemento fora da vista: a barra continua acessível dentro da área do canvas.
  await h1.evaluate((el) => el.ownerDocument.defaultView?.scrollTo(0, 0));
  await layer(page, 'Tudo o que a equipa precisa').click();
  await frame(page).locator('body').evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const t = await box(toolbar(page));
  const wrap = await box(page.locator('.canvas-wrap'));
  expect(t.y).toBeGreaterThanOrEqual(wrap.y);
  expect(t.y + t.height).toBeLessThanOrEqual(wrap.y + wrap.height);
});

test('«+» insere antes, depois ou dentro; só destinos compatíveis; seleciona e desfaz', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await page.getByTestId('ct-insert').click();
  const pop = page.getByTestId('insert-popover');
  await expect(pop.getByTestId('insert-pos-inside')).toBeDisabled(); // um título não recebe filhos
  await expect(pop.getByTestId('insert-pos-after')).toHaveAttribute('aria-checked', 'true');
  await expect(pop.getByTestId('insert-section')).toBeDisabled(); // secção não entra numa coluna
  await pop.getByTestId('insert-pos-before').click();
  await expect(page.getByTestId('insert-where')).toHaveText('Antes de «Título»');
  await pop.getByTestId('insert-heading').click();
  await expect(pop).toBeHidden();
  // Criado imediatamente antes e selecionado.
  const created = h1.locator('xpath=preceding-sibling::*[1]');
  await expect(created).toHaveText('Novo título');
  await expect(page.getByTestId('canvas-toolbar-name')).toHaveText('Título');
  await expect(frame(page).locator('.gjs-selected')).toHaveText('Novo título');

  // Depois.
  await h1.click();
  await page.getByTestId('ct-insert').click();
  await pop.getByTestId('insert-text').click();
  await expect(h1.locator('xpath=following-sibling::*[1]')).toContainText('Novo parágrafo');

  // Dentro de uma coluna (contentor): fica como último filho.
  await layerNamed(page, 'Coluna').click();
  // Fixar a coluna pelo id: depois de inserir, a seleção passa para o elemento criado.
  const columnId = await frame(page).locator('.gjs-selected').getAttribute('id');
  const column = frame(page).locator(`#${columnId ?? ''}`);
  await page.getByTestId('ct-insert').click();
  await expect(pop.getByTestId('insert-pos-inside')).toHaveAttribute('aria-checked', 'true');
  const buttonsBefore = await column.locator('> [data-bolt-type="button"]').count();
  await pop.getByTestId('insert-button').click();
  await expect(column.locator('> *').last()).toHaveAttribute('data-bolt-type', 'button');
  await expect(column.locator('> [data-bolt-type="button"]')).toHaveCount(buttonsBefore + 1);

  // Desfazer remove as inserções, uma de cada vez, pela ordem inversa.
  await page.getByTestId('undo').click();
  await expect(column.locator('> [data-bolt-type="button"]')).toHaveCount(buttonsBefore);
  await expect(frame(page).getByText('Novo parágrafo', { exact: false })).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(frame(page).getByText('Novo parágrafo', { exact: false })).toHaveCount(0);
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(0);
  // Refazer repõe a primeira inserção no mesmo lugar.
  await page.getByTestId('redo').click();
  await expect(h1.locator('xpath=preceding-sibling::*[1]')).toHaveText('Novo título');
});

test('arrastar no canvas: move com o motor, recusa destino inválido, Esc cancela, desfazer/refazer', async ({ page }) => {
  await createNimbus(page);
  const col = frame(page).locator('h1').first().locator('xpath=..');
  const h1 = frame(page).locator('h1').first();
  const p = h1.locator('xpath=following-sibling::p[1]');
  const initial = await col.locator('> *').evaluateAll((els) => els.map((e) => e.id));
  const h1Id = await h1.getAttribute('id');

  // Esc durante o arrasto: nada muda.
  await h1.click();
  await drag(page, page.getByTestId('ct-move'), p, 'bottom', { cancel: true });
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((e) => e.id))).toEqual(initial);

  // Move válido: o título passa para depois do parágrafo e mantém o id.
  await h1.click();
  await drag(page, page.getByTestId('ct-move'), p, 'bottom');
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((e) => e.id))).not.toEqual(initial);
  const moved = await col.locator('> *').evaluateAll((els) => els.map((e) => e.id));
  expect(moved.indexOf(h1Id ?? '')).toBe(initial.indexOf(h1Id ?? '') + 1);
  await expect(frame(page).locator(`#${h1Id}`)).toHaveCount(1);

  // Desfazer volta à ordem original; refazer repete.
  await page.getByTestId('undo').click();
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((e) => e.id))).toEqual(initial);
  await page.getByTestId('redo').click();
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((e) => e.id))).toEqual(moved);

  // Inválido: uma secção nunca entra dentro de si própria (nem de um título dela).
  await layerNamed(page, 'Secção').click();
  const section = frame(page).locator('.gjs-selected');
  const sectionId = await section.getAttribute('id');
  const place = () => frame(page).locator(`#${sectionId}`).evaluate((el) => ({ parent: el.parentElement?.id, index: [...(el.parentElement?.children ?? [])].indexOf(el), hasH1: !!el.querySelector('h1') }));
  const beforeInvalid = await place();
  await drag(page, page.getByTestId('ct-move'), frame(page).locator('h1').first(), 'bottom');
  // Largar sobre um descendente: recusado, nada muda.
  await expect.poll(place).toEqual(beforeInvalid);
  await expect(page.getByTestId('undo')).toBeEnabled();

  // Alternativas preservadas: setas da barra fixa e árvore continuam a mover.
  await h1.click();
  await page.getByTestId('move-up').click();
  await expect.poll(() => col.locator('> *').evaluateAll((els) => els.map((e) => e.id))).toEqual(initial);
});

test('duplicar com ids únicos, eliminar, editar texto pela barra, guardar, F5 e reabrir', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  await h1.click();
  await page.getByTestId('ct-duplicate').click();
  await expect(frame(page).locator('h1')).toHaveCount(2);
  const ids = await frame(page).locator('[id]').evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);

  // Editar texto pela barra: abre a edição direta; a barra esconde-se enquanto se escreve.
  await page.getByTestId('ct-edit-text').click();
  await expect(toolbar(page)).toBeHidden();
  const editing = frame(page).locator('[contenteditable="true"]');
  await expect(editing).toHaveCount(1);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Cópia editada');
  await frame(page).locator('body').click({ position: { x: 5, y: 5 } });
  await expect(frame(page).locator('h1').nth(1)).toHaveText('Cópia editada');

  // Eliminar a cópia e repor pelo histórico.
  await frame(page).locator('h1').nth(1).click();
  await page.getByTestId('ct-delete').click();
  await expect(frame(page).locator('h1')).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(frame(page).locator('h1')).toHaveCount(2);
  await page.getByTestId('redo').click();
  await expect(frame(page).locator('h1')).toHaveCount(1);
  await page.getByTestId('undo').click();

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  const url = page.url();
  await page.reload();
  await expect(frame(page).locator('h1')).toHaveText(['Decisões de marketing com dados, não com palpites', 'Cópia editada']);
  await page.goto('/');
  await page.goto(url);
  await expect(frame(page).locator('h1')).toHaveCount(2);
});

test('projetos importados: editar pela barra mantém menu móvel e carrosséis a funcionar', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('https://cdn.grapesjs.com/**', (r) => r.abort());
  await page.route(/daniel-machado\.site|joanapinho\.pt|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [file, name] of [
    ['amostra/projeto-teste-2026-09-16-091529.grapesjs', 'Cópia Studio'],
    ['amostra/[Modelo] [Elementor] Carla Santos.json', 'Cópia Elementor'],
  ] as const) {
    await page.goto('/importar');
    await page.getByTestId('import-file').setInputFiles(file);
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('import-name').fill(name);
    const partial = page.getByTestId('import-accept-partial');
    if (await partial.count()) await partial.check();
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser', { timeout: 60_000 });

    // Detalhe SVG recolhido por omissão: ícones e SVG fechados; abrem-se quando se pede.
    const closed = page.locator('li[role="treeitem"]').filter({ has: page.locator(':scope > .tree-row .tree-label', { hasText: /^(Ícone|Ícone vetorial)$/ }) });
    if (await closed.count()) {
      const states = await closed.evaluateAll((lis) => lis.map((li) => li.getAttribute('aria-expanded')));
      expect(states.every((s) => s === 'false')).toBe(true);
      const first = closed.first();
      await first.locator(':scope > .tree-row').getByRole('button', { name: 'Abrir' }).click();
      await expect(first).toHaveAttribute('aria-expanded', 'true');
      await expect(first.locator(':scope > ul > li').first()).toBeVisible();
    }

    // Edição pela barra: duplicar o primeiro slide de um carrossel e desfazer.
    const slide = frame(page).locator('[data-bolt-type="carousel-track"] > [data-bolt-type="slide"]').first();
    await slide.click({ force: true });
    await layerNamed(page, 'Slide').click();
    await expect(page.getByTestId('canvas-toolbar-name')).toHaveText('Slide');
    await page.getByTestId('ct-duplicate').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('save').click();
    await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
    await page.reload();

    // Carrosséis: o runtime continua a dimensionar os slides no canvas.
    await expect
      .poll(() => frame(page).locator('[data-bolt-type="carousel"]').first().evaluate((c) => !!(c as HTMLElement & { __boltCarousel?: unknown }).__boltCarousel))
      .toBe(true);
    // Menu móvel (só no Studio).
    const menu = frame(page).locator('[data-bolt-type="menu"]').first();
    if (await menu.count()) {
      await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
      await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeHidden();
      await menu.locator('[data-bolt-type="menu-toggle"]').click();
      await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeVisible();
    }
  }
});

test('modo de armazenamento no editor é só um ícone; o estado de gravação diz onde se guarda', async ({ page }) => {
  await createNimbus(page);
  const badge = page.getByTestId('mode-badge');
  await expect(badge).toHaveAttribute('aria-label', 'Modo local · só neste browser');
  await expect(badge).toHaveText('');
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
});
