import { expect, test, type Page } from '@playwright/test';

/**
 * Páginas e camadas no browser real (modo local, cópias de teste): compatibilidade com projetos
 * de uma página, criar/alternar/duplicar/eliminar, página inicial, ligações entre páginas,
 * gravação, template e importações.
 */
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const rows = (page: Page) => page.getByTestId('page-row');
const row = (page: Page, name: string) => rows(page).filter({ has: page.locator('.page-name', { hasText: new RegExp(`^${name}$`) }) });
const SAVED = 'Alterações guardadas neste browser';

async function createNimbus(page: Page, name = 'Páginas') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

async function save(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

test('projeto de uma página: abre como página inicial; nada muda só por abrir', async ({ page }) => {
  await createNimbus(page);
  const revision = await page.getByTestId('diag-revision').textContent();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Página inicial');
  await expect(rows(page).first()).toContainText('Inicial');
  await expect(rows(page).first()).toContainText('/inicio');
  await expect(page.getByTestId('page-delete')).toBeDisabled(); // nunca a última
  await expect(page.getByTestId('page-home')).toBeDisabled();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(await page.getByTestId('diag-revision').textContent()).toBe(revision);
});

test('criar, alternar sem perder alterações, mudar o nome, duplicar com ids novos, guardar e F5', async ({ page }) => {
  await createNimbus(page);
  const homeTitle = await frame(page).locator('h1').first().textContent();

  // Nova página: vazia, selecionada; acrescentar conteúdo.
  await page.getByTestId('page-add').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'Nova página')).toHaveAttribute('aria-current', 'page');
  await expect(frame(page).locator('h1')).toHaveCount(0);
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('block-heading').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
  await page.getByTestId('tool-layers').click();

  // Alternar: o conteúdo de cada página mantém-se.
  await row(page, 'Página inicial').click();
  await expect(frame(page).locator('h1').first()).toHaveText(homeTitle ?? '');
  await expect(frame(page).getByText('Novo título')).toHaveCount(0);
  await row(page, 'Nova página').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);

  // Mudar o nome: o caminho (slug) não muda.
  await page.getByTestId('page-rename').click();
  await page.getByTestId('page-rename-input').fill('Contactos');
  await page.getByTestId('page-rename-input').press('Enter');
  await expect(row(page, 'Contactos')).toContainText('/nova-pagina');

  // Duplicar a página inicial: mesmo conteúdo, ids novos e únicos no projeto.
  await row(page, 'Página inicial').click();
  const homeIds = await frame(page).locator('[data-gjs-type][id]').evaluateAll((els) => els.map((e) => e.id));
  await page.getByTestId('page-duplicate').click();
  await expect(row(page, 'Página inicial \\(cópia\\)')).toHaveAttribute('aria-current', 'page');
  await expect(frame(page).locator('h1').first()).toHaveText(homeTitle ?? '');
  const copyIds = await frame(page).locator('[data-gjs-type][id]').evaluateAll((els) => els.map((e) => e.id));
  expect(copyIds.filter((id) => homeIds.includes(id))).toEqual([]);
  // Os estilos próprios vieram com a cópia (o título tem o mesmo aspeto).
  const size = (p: Page) => frame(p).locator('h1').first().evaluate((el) => getComputedStyle(el).fontSize);
  const copySize = await size(page);
  await row(page, 'Página inicial').click();
  expect(await size(page)).toBe(copySize);

  await save(page);
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Página inicial');
  await expect(rows(page).nth(1)).toContainText('Página inicial (cópia)');
  await expect(rows(page).nth(2)).toContainText('Contactos');
  await row(page, 'Contactos').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
});

test('mudar de página não cria alterações nem passos de desfazer', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await save(page);
  await page.reload();
  const revision = await page.getByTestId('diag-revision').textContent();
  for (let i = 0; i < 3; i++) {
    await rows(page).nth(1).click();
    await rows(page).nth(0).click();
  }
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  expect(await page.getByTestId('diag-revision').textContent()).toBe(revision);
});

test('página inicial: definir outra, eliminar a inicial com aviso explícito, desfazer repõe', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-home').click();
  await expect(rows(page).first()).toContainText('Nova página');
  await expect(rows(page).first()).toContainText('Inicial');
  await expect(page.getByTestId('page-home')).toBeDisabled();

  await page.getByTestId('page-delete').click();
  await expect(page.getByTestId('page-delete-info')).toContainText('a página inicial passa a ser «Página inicial»');
  await page.getByTestId('page-delete-confirm').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Inicial');
  await expect(page.getByTestId('page-delete')).toBeDisabled();
  await page.getByTestId('undo').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Nova página');
});

test('ligações entre páginas: /slug escolhido na lista; eliminar a página de destino avisa quantas ligações ficam sem destino', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-rename').click();
  await page.getByTestId('page-rename-input').fill('Contactos');
  await page.getByTestId('page-rename-input').press('Enter');
  await row(page, 'Página inicial').click();
  const link = frame(page).locator('nav a').first();
  await link.click();
  await page.getByTestId('prop-page-link').selectOption({ label: 'Contactos (/nova-pagina)' });
  await expect(link).toHaveAttribute('href', '/nova-pagina');
  await expect(page.getByTestId('prop-page-link')).toHaveValue(await row(page, 'Contactos').getAttribute('data-page-id') ?? '');

  await row(page, 'Contactos').click();
  await page.getByTestId('page-delete').click();
  await expect(page.getByTestId('page-delete-info')).toContainText('Há 1 ligação para esta página (/nova-pagina)');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await save(page);
  await page.reload();
  await expect(frame(page).locator('nav a').first()).toHaveAttribute('href', '/nova-pagina');
});

test('guardar como template leva todas as páginas; o projeto criado a partir dele também', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill('Duas páginas');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  await page.goto('/templates');
  await page.getByTestId('team-template-card').filter({ hasText: 'Duas páginas' }).getByTestId('use-team-template').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Nova página');
});

test('importações GrapesJS e Elementor: uma página, nome de origem preservado; duplicar mantém menu e carrossel', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('https://cdn.grapesjs.com/**', (r) => r.abort());
  await page.route(/daniel-machado\.site|joanapinho\.pt|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [file, name, pageName] of [
    ['amostra/projeto-teste-2026-09-16-091529.grapesjs', 'Studio páginas', 'Home'],
    ['amostra/[Modelo] [Elementor] Carla Santos.json', 'Elementor páginas', 'Página inicial'],
  ] as const) {
    await page.goto('/importar');
    await page.getByTestId('import-file').setInputFiles(file);
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('import-name').fill(name);
    const partial = page.getByTestId('import-accept-partial');
    if (await partial.count()) await partial.check();
    await page.getByTestId('import-confirm').click();
    await expect(page.getByTestId('save-status')).toHaveText(SAVED, { timeout: 60_000 });
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(pageName);

    await page.getByTestId('page-duplicate').click();
    await expect(rows(page)).toHaveCount(2);
    // A cópia tem o runtime a funcionar (carrosséis dimensionados).
    await expect.poll(() => frame(page).locator('[data-bolt-type="carousel"]').first().evaluate((c) => !!(c as HTMLElement & { __boltCarousel?: unknown }).__boltCarousel)).toBe(true);
    const menu = frame(page).locator('[data-bolt-type="menu"]').first();
    if (await menu.count()) {
      await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
      await menu.locator('[data-bolt-type="menu-toggle"]').click();
      await expect(menu.locator('[data-bolt-type="menu-items"]')).toBeVisible();
      await page.getByRole('button', { name: 'Computador', exact: true }).click();
    }
    await save(page);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
  }
});

test('camadas, barra contextual e inspetor continuam a funcionar numa página nova', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('block-section').click();
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('layer-row').filter({ hasText: 'Secção' })).not.toHaveCount(0);
  const heading = frame(page).locator('h2').first();
  await heading.click();
  await expect(page.getByTestId('canvas-toolbar-name')).toHaveText('Título');
  await page.getByTestId('ct-duplicate').click();
  await expect(frame(page).locator('h2')).toHaveCount(2);
  const head = page.getByTestId('group-spacing');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.getByTestId('style-padding-top').fill('12');
  await page.getByTestId('style-padding-top').press('Enter');
  // Depois de duplicar, a seleção é a cópia: é ela que o inspetor edita.
  const selected = frame(page).locator('.gjs-selected');
  await expect.poll(() => selected.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('12px');
  await page.getByTestId('undo').click();
  await expect.poll(() => frame(page).locator('h2').nth(1).evaluate((el) => getComputedStyle(el).paddingTop)).not.toBe('12px');
});

test('pré-visualização: ligações entre páginas navegam, «Voltar» regressa, destino inexistente é indicado; no canvas os cliques continuam a editar', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-rename').click();
  await page.getByTestId('page-rename-input').fill('Contactos');
  await page.getByTestId('page-rename-input').press('Enter');
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('block-heading').click();
  await page.getByTestId('tool-layers').click();
  await row(page, 'Página inicial').click();
  // Primeira ligação do menu → página «Contactos»; segunda → destino inexistente; terceira → âncora.
  const links = frame(page).locator('nav a');
  await links.nth(0).click();
  await page.getByTestId('prop-page-link').selectOption({ label: 'Contactos (/nova-pagina)' });
  await links.nth(1).click();
  await page.getByTestId('prop-href').fill('/nao-existe');
  await page.getByTestId('prop-href').press('Enter');
  await links.nth(2).click();
  await page.getByTestId('prop-href').fill('#contacto');
  await page.getByTestId('prop-href').press('Enter');
  // No canvas, clicar na ligação seleciona-a (não navega).
  await links.nth(0).click();
  await expect(page.getByTestId('selected-name')).toHaveText('Ligação');
  await expect(rows(page).first()).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('open-preview').click();
  const pv = page.frameLocator('[data-testid="preview-frame"]');
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-page', 'inicio');
  await expect(page.getByTestId('preview-back')).toBeDisabled();
  await pv.locator('nav a').nth(0).click();
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-page', 'nova-pagina');
  await expect(pv.getByText('Novo título')).toBeVisible();
  await page.getByTestId('preview-back').click();
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-page', 'inicio');
  // Âncora: não é tratada como página (sem aviso nem mudança de página).
  await pv.locator('nav a').nth(2).click();
  await expect(page.getByTestId('preview-missing')).toHaveCount(0);
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-page', 'inicio');
  // Destino inexistente: aviso claro, continua na mesma página; o aviso pode ser fechado.
  await pv.locator('nav a').nth(1).click();
  await expect(page.getByTestId('preview-missing')).toContainText('«/nao-existe»');
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-page', 'inicio');
  await page.getByTestId('preview-missing-close').click();
  await expect(page.getByTestId('preview-missing')).toHaveCount(0);
  // A aplicação não navegou para rotas do Bolt IA.
  expect(page.url()).toMatch(/\/projetos\/[0-9a-f-]{36}$/);
  await page.keyboard.press('Escape');
  // A pré-visualização não alterou o documento.
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
});

test('desfazer que altera outra página: aviso com o nome e «Ver página» sem criar passos', async ({ page }) => {
  await createNimbus(page);
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-rename').click();
  await page.getByTestId('page-rename-input').fill('Serviços');
  await page.getByTestId('page-rename-input').press('Enter');
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('block-heading').click(); // alteração na página «Serviços»
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
  await page.getByTestId('tool-layers').click();
  await row(page, 'Página inicial').click();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('history-notice')).toContainText('Desfazer alterou a página «Serviços»');
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId('history-notice-view').click();
  await expect(row(page, 'Serviços')).toHaveAttribute('aria-current', 'page');
  await expect(frame(page).getByText('Novo título')).toHaveCount(0);
  // Ver a página não criou passos: refazer continua disponível e repõe o título.
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId('redo').click();
  await expect(frame(page).getByText('Novo título')).toHaveCount(1);
  await expect(page.getByTestId('history-notice')).toHaveCount(0); // refazer na página à vista: sem aviso
  // Atalho de teclado usa o mesmo caminho.
  await row(page, 'Página inicial').click();
  await frame(page).locator('body').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('history-notice')).toContainText('«Serviços»');
});
