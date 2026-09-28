import { expect, test, type FrameLocator, type Page } from '@playwright/test';

/**
 * Importação e biblioteca de templates, no browser real (modo local, IndexedDB), com as duas
 * amostras fornecidas (lidas, nunca alteradas). As verificações são estruturais e de
 * comportamento; não dependem dos textos das amostras exceto para localizar o que se edita.
 *
 * Percurso: importar → relatório → confirmar → editar texto e imagem → guardar → reabrir →
 * guardar como template → criar outro projeto → editar o derivado → o template não muda.
 */
const STUDIO = 'amostra/projeto-teste-2026-09-16-091529.grapesjs';
const ELEMENTOR = 'amostra/[Modelo] [Elementor] Carla Santos.json';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const canvas = (page: Page) => page.frameLocator('.gjs-frame');
const preview = (page: Page) => page.frameLocator('[data-testid="import-preview"]');

/** Imagens do CDN do Studio servidas localmente (com CORS): testes sem depender da rede. */
async function offlineImages(page: Page) {
  await page.route('https://cdn.grapesjs.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.route(/daniel-machado\.site|joanapinho\.pt/, (route) => route.abort('namenotresolved'));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort('internetdisconnected'));
}

async function importFile(page: Page, path: string) {
  await page.goto('/');
  await page.getByTestId('open-import').click();
  await expect(page).toHaveURL(/\/importar$/);
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 60_000 });
}

async function confirmImport(page: Page, name: string) {
  await page.getByTestId('import-name').fill(name);
  const rights = page.getByTestId('import-rights');
  if (await rights.count()) await rights.check();
  const partial = page.getByTestId('import-accept-partial');
  if (await partial.count()) {
    // Importação parcial: não se completa sem confirmação explícita.
    await expect(page.getByTestId('import-confirm')).toBeDisabled();
    await partial.check();
  }
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function save(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function editText(page: Page, locator: ReturnType<FrameLocator['locator']>, text: string) {
  await locator.click();
  await page.getByTestId('prop-text').fill(text);
  await page.getByTestId('prop-text').press('Tab');
  await expect(locator).toHaveText(text);
}

async function saveAsTemplate(page: Page, name: string) {
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill(name);
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toContainText('versão 1');
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
}

async function projectFromTeamTemplate(page: Page, template: string, name: string) {
  await page.goto('/templates');
  const card = page.getByTestId('team-template-card').filter({ hasText: template });
  await expect(card).toHaveCount(1);
  await card.getByTestId('use-team-template').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome do projeto').fill(name);
  await dialog.getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

/** Larguras dos slides de cada carrossel, medidas dentro de um documento. */
async function slideWidths(frame: FrameLocator): Promise<number[][]> {
  return frame.locator('[data-bolt-type="carousel"]').evaluateAll((roots) =>
    roots.map((r) => [...(r.querySelector('[data-bolt-type="carousel-track"]')?.children ?? [])].filter((s) => !s.hasAttribute('data-bolt-clone')).map((s) => Math.round(s.getBoundingClientRect().width))),
  );
}

test('GrapesJS Studio: importar, rever, editar, guardar, reabrir, template e projeto derivado independente', async ({ page }) => {
  test.setTimeout(180_000);
  await offlineImages(page);
  await importFile(page, STUDIO);

  // Relatório antes de confirmar: totais, ambiguidade dos títulos, formulário sem envio.
  await expect(page.getByTestId('import-totals')).toBeVisible();
  await expect(page.getByTestId('import-notes')).toContainText('sem nível');
  await expect(page.getByTestId('import-items')).toContainText('Campo de formulário');
  await expect(page.getByTestId('import-assets')).toContainText('Pode ser copiada');

  // Prévia isolada: runtime ativo (3 carrosséis com slides dimensionados), aviso de formulário.
  const pv = preview(page);
  await expect(pv.locator('[data-bolt-notice]')).toContainText('Formulário sem envio');
  await expect(pv.locator('[data-bolt-type="carousel"]')).toHaveCount(3);
  await expect.poll(async () => (await slideWidths(pv)).map((w) => w.length)).toEqual([3, 4, 3]);
  // A 1280 px: 3 por vista no primeiro (Studio: tablet 3), 4 no segundo.
  const [first = [], second = []] = await slideWidths(pv);
  const base = first[0] ?? 0;
  expect(first.every((w) => Math.abs(w - base) <= 1 && w > 0 && w < 400)).toBe(true);
  expect(second.every((w) => w < 320)).toBe(true);

  // Telemóvel: menu fechado; o botão do menu abre-o.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  const menu = pv.locator('[data-bolt-type="menu"]').first();
  const items = menu.locator('[data-bolt-type="menu-items"]');
  await expect(items).toBeHidden();
  await menu.locator('[data-bolt-type="menu-toggle"]').click();
  await expect(items).toBeVisible();
  await expect(menu.locator('[data-bolt-type="menu-toggle"]')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Computador', exact: true }).click();

  await confirmImport(page, 'NexGame importado');
  const projectUrl = page.url();

  // Editor: aviso de formulário sem integração; semântica preservada.
  await expect(page.getByTestId('editor-form-notice')).toBeVisible();
  const c = canvas(page);
  await expect(c.locator('section')).toHaveCount(10);
  await expect(c.locator('div[href]')).toHaveCount(0);
  await expect(c.locator('[data-bolt-type="carousel"]')).toHaveCount(3);

  // Editar texto (um título só com texto) e imagem.
  const title = c.locator('h4').first();
  await editText(page, title, 'Título editado no Bolt');
  await expect(page.getByTestId('prop-tag')).toHaveValue('h4');
  // Primeira imagem visível e sem animação CSS (clicável de forma estável).
  const imgId = await c.locator('img').evaluateAll((imgs) => {
    const ok = imgs.find((i) => {
      const r = i.getBoundingClientRect();
      let el: Element | null = i;
      while (el) {
        if (getComputedStyle(el).animationName !== 'none') return false;
        el = el.parentElement;
      }
      return r.width > 20 && r.height > 20;
    });
    return ok?.id ?? '';
  });
  expect(imgId).not.toBe('');
  const img = c.locator(`img#${imgId}`);
  await img.click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(c.locator(`img#${imgId}`)).toHaveAttribute('src', /^data:image\/png;base64,/);

  // Campo do formulário: editável, com o aviso.
  await c.locator('input').first().click();
  await expect(page.getByTestId('form-no-integration')).toBeVisible();
  await page.getByTestId('prop-placeholder').fill('O seu email');
  await page.getByTestId('prop-placeholder').press('Enter');
  await expect(c.locator('input').first()).toHaveAttribute('placeholder', 'O seu email');

  // Menu móvel no editor.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  const cMenu = c.locator('[data-bolt-type="menu"]').first();
  await expect(cMenu.locator('[data-bolt-type="menu-items"]')).toBeHidden();
  await cMenu.locator('[data-bolt-type="menu-toggle"]').click();
  await expect(cMenu.locator('[data-bolt-type="menu-items"]')).toBeVisible();
  await page.getByRole('button', { name: 'Computador', exact: true }).click();

  await save(page);
  await page.reload();
  await expect(canvas(page).locator('h4').first()).toHaveText('Título editado no Bolt');
  await expect(canvas(page).locator(`img#${imgId}`)).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(canvas(page).locator('input').first()).toHaveAttribute('placeholder', 'O seu email');
  // Imagens copiadas ficam no documento (modo local): nenhuma depende do CDN de origem.
  expect(await canvas(page).locator('img[src^="https://cdn.grapesjs.com"]').count()).toBe(0);

  // Guardar como template e criar um projeto independente a partir dele.
  await saveAsTemplate(page, 'NexGame base');
  await projectFromTeamTemplate(page, 'NexGame base', 'NexGame derivado');
  expect(page.url()).not.toBe(projectUrl);
  await expect(canvas(page).locator('h4').first()).toHaveText('Título editado no Bolt');
  await editText(page, canvas(page).locator('h4').first(), 'Só no derivado');
  await save(page);

  // O template não mudou: um novo projeto a partir dele tem o conteúdo da versão 1.
  await projectFromTeamTemplate(page, 'NexGame base', 'NexGame verificação');
  await expect(canvas(page).locator('h4').first()).toHaveText('Título editado no Bolt');
  // E o projeto de origem também não.
  await page.goto(projectUrl);
  await expect(canvas(page).locator('h4').first()).toHaveText('Título editado no Bolt');

  // O original importado fica registado para recuperação.
  const originals = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('bolt-ia');
        open.onsuccess = () => {
          const req = open.result.transaction('imports', 'readonly').objectStore('imports').getAll();
          req.onsuccess = () => resolve(req.result.filter((r: { originalText?: string }) => (r.originalText ?? '').length > 100000).length);
        };
      }),
  );
  expect(originals).toBe(1);
});

test('Elementor: imagens em falta assinaladas, importação parcial confirmada, acordeão, carrossel, template', async ({ page }) => {
  test.setTimeout(180_000);
  await offlineImages(page);
  await importFile(page, ELEMENTOR);

  await expect(page.getByTestId('import-assets')).toContainText('Em falta');
  const pv = preview(page);
  // Sem substituição silenciosa: imagens que não carregam ficam assinaladas na prévia.
  await expect.poll(() => pv.locator('img[data-bolt-missing]').count()).toBeGreaterThan(10);
  await expect(pv.locator('details').first()).toBeAttached();
  // Carrossel contínuo: a posição muda sozinha na prévia.
  const track = pv.locator(`[data-bolt-carousel*='"delay":0'] [data-bolt-type="carousel-track"]`).first();
  const t0 = await track.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(() => track.evaluate((el) => getComputedStyle(el).transform), { timeout: 5000 }).not.toBe(t0);

  await confirmImport(page, 'Carla importado');
  const c = canvas(page);
  await expect(c.locator('details')).not.toHaveCount(0);
  const heading = c.locator('.elementor-heading-title').first();
  await editText(page, heading, 'Olá do Bolt');
  await save(page);
  await page.reload();
  await expect(canvas(page).locator('.elementor-heading-title').first()).toHaveText('Olá do Bolt');

  await saveAsTemplate(page, 'Carla base');
  await projectFromTeamTemplate(page, 'Carla base', 'Carla derivado');
  await editText(page, canvas(page).locator('.elementor-heading-title').first(), 'Só no derivado');
  await save(page);
  await projectFromTeamTemplate(page, 'Carla base', 'Carla verificação');
  await expect(canvas(page).locator('.elementor-heading-title').first()).toHaveText('Olá do Bolt');
});

test('guardar de novo sobre um template da equipa cria uma nova versão sem alterar a anterior', async ({ page }) => {
  test.setTimeout(120_000);
  await offlineImages(page);
  await importFile(page, ELEMENTOR);
  await confirmImport(page, 'Versões');
  await saveAsTemplate(page, 'Com versões');
  await projectFromTeamTemplate(page, 'Com versões', 'Versões 2');
  await editText(page, canvas(page).locator('.elementor-heading-title').first(), 'Versão dois');
  await save(page);

  await page.getByTestId('save-as-template').click();
  await expect(page.getByTestId('template-target-version')).toBeChecked();
  await page.getByTestId('template-note').fill('título novo');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toContainText('versão 2');

  await page.goto('/templates');
  const card = page.getByTestId('team-template-card').filter({ hasText: 'Com versões' });
  await expect(card).toContainText('Versão 2');
  await card.getByRole('button', { name: 'Versões' }).click();
  const versions = page.getByTestId('template-versions');
  await expect(versions.locator('li')).toHaveCount(2);
  // Criar a partir da versão 1: conteúdo original.
  await versions.locator('li').filter({ hasText: 'Versão 1' }).getByRole('button', { name: 'Usar esta versão' }).click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill('Da versão 1');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
  await expect(canvas(page).locator('.elementor-heading-title').first()).not.toHaveText('Versão dois');
});

test('formato não suportado e ficheiro inválido dão erro claro sem criar projeto', async ({ page }) => {
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles({ name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<html><body><h1>x</h1></body></html>') });
  await expect(page.getByRole('alert')).toContainText('Ainda não é suportado');
  await page.getByTestId('import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByRole('alert')).toContainText('Formato não reconhecido');
  await page.goto('/');
  await expect(page.getByTestId('project-card')).toHaveCount(0);
});
