import { expect, test, type FrameLocator, type Page } from '@playwright/test';

/**
 * Importação de um site estático real: o ZIP «Stylish Portfolio» do Start Bootstrap (amostra
 * fornecida, lida e nunca alterada), no browser real e em modo local (IndexedDB), SEM rede:
 * as folhas externas (Font Awesome e Simple Line Icons) são servidas por fixtures de teste
 * mínimas; Google Fonts e Google Maps ficam sem resposta.
 *
 * Percurso: importar → relatório → pré-visualização (imagens, menu, âncoras, voltar ao topo,
 * três larguras) → confirmar → editar título, texto, botão, imagem e fundo → menu no canvas →
 * desfazer/refazer → guardar → F5 → reabrir pela Dashboard → assistente (simulador) →
 * template → cópia independente.
 */
const ZIP = 'amostra/startbootstrap-stylish-portfolio-gh-pages.zip';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const SAVED = 'Alterações guardadas neste browser';

/** FIXTURES DE TESTE (não são as folhas reais dos fornecedores). */
const FA_FIXTURE = '/* fixture de teste */ .fa-bars:before{content:"="} .fa-xmark:before{content:"x"} .fa-angle-up:before{content:"^"} .fas{font-family:monospace;font-style:normal}';
const SLI_FIXTURE = '/* fixture de teste */ [class^="icon-"]:before{content:"*"}';

const canvas = (page: Page) => page.frameLocator('.gjs-frame');
const preview = (page: Page) => page.frameLocator('[data-testid="import-preview"]');

async function offline(page: Page) {
  await page.route('https://use.fontawesome.com/**', (r) =>
    r.request().url().endsWith('.css') ? r.fulfill({ status: 200, contentType: 'text/css', body: FA_FIXTURE, headers: { 'access-control-allow-origin': '*' } }) : r.abort('internetdisconnected'),
  );
  await page.route('https://cdnjs.cloudflare.com/**', (r) =>
    r.request().url().endsWith('.css') ? r.fulfill({ status: 200, contentType: 'text/css', body: SLI_FIXTURE, headers: { 'access-control-allow-origin': '*' } }) : r.abort('internetdisconnected'),
  );
  await page.route(/fonts\.(googleapis|gstatic)\.com|maps\.google\.com|www\.google\.com|cdn\.jsdelivr\.net/, (r) => r.abort('internetdisconnected'));
}

async function editText(page: Page, locator: ReturnType<FrameLocator['locator']>, text: string) {
  await locator.click();
  await page.getByTestId('prop-text').fill(text);
  await page.getByTestId('prop-text').press('Tab');
  await expect(locator).toHaveText(text);
}

const scrollY = (f: FrameLocator) => f.locator('body').evaluate(() => Math.round(window.scrollY));

/** A imagem de fundo calculada de um elemento carrega mesmo (não só está declarada). */
const backgroundLoads = (f: FrameLocator, selector: string) =>
  f.locator(selector).first().evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const m = /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage);
        if (!m?.[1]) return resolve(false);
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = m[1];
      }),
  );

test('ZIP do Stylish Portfolio: importar, pré-visualizar, editar, guardar, reabrir, assistente e template', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await offline(page);
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(ZIP);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 90_000 });

  // ---------------------------------------------------------------- relatório
  await expect(page.getByTestId('import-pages')).toContainText('index.html');
  await expect(page.getByTestId('import-items')).toContainText('Abrir/fechar pelo runtime do Bolt');
  await expect(page.getByTestId('import-items')).toContainText('Mostrar depois de rolar');
  await expect(page.getByTestId('import-items')).toContainText('Mapa incorporado');
  await expect(page.getByTestId('import-items')).toContainText('Folha CSS oficial (fontes de ícones)');
  await expect(page.getByTestId('import-items')).toContainText('Ícone do separador (favicon)');
  await expect(page.getByTestId('import-items')).toContainText('Folha externa fonts.googleapis.com');
  await expect(page.getByTestId('import-assets').locator('li', { hasText: 'Guardada ao importar' })).toHaveCount(6);
  await expect(page.getByTestId('import-rights')).toHaveCount(0); // nada remoto a autorizar

  // ---------------------------------------------------------------- pré-visualização
  const pv = preview(page);
  await expect(pv.locator('h1')).toHaveText('Stylish Portfolio');
  await expect.poll(() => pv.locator('img').evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length)).toBe(4);
  await expect(pv.locator('img[data-bolt-missing]')).toHaveCount(0);
  expect(await backgroundLoads(pv, '.masthead')).toBe(true);
  expect(await backgroundLoads(pv, '.callout')).toBe(true);
  // Grelha do Bootstrap: a 1280 px, 4 serviços numa linha; o portfólio em 2 colunas.
  const serviceTops = await pv.locator('#services .col-lg-3').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(serviceTops).size).toBe(1);
  // Menu lateral: abre e fecha pelo runtime (classe «active» e troca do ícone).
  const sidebar = pv.locator('#sidebar-wrapper');
  await expect(sidebar).not.toHaveClass(/active/);
  await pv.locator('.menu-toggle').click();
  await expect(sidebar).toHaveClass(/active/);
  await expect(pv.locator('.menu-toggle i')).toHaveClass(/fa-xmark/);
  await expect.poll(() => sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().right))).toBeLessThanOrEqual(1280);
  // Âncora: «About» desloca até à secção (sem sair da pré-visualização).
  await pv.locator('#sidebar-wrapper a[href="#about"]').click();
  await expect.poll(() => pv.locator('#about').evaluate((el) => Math.abs(Math.round(el.getBoundingClientRect().top)))).toBeLessThan(5);
  await pv.locator('.menu-toggle').click();
  await expect(sidebar).not.toHaveClass(/active/);
  await expect(pv.locator('.menu-toggle i')).toHaveClass(/fa-bars/);
  // Voltar ao topo: escondido no início, aparece depois de rolar, volta ao topo.
  await expect(pv.locator('.scroll-to-top')).toBeVisible();
  await pv.locator('body').evaluate(() => window.scrollTo(0, 0));
  await expect(pv.locator('.scroll-to-top')).toBeHidden();
  await pv.locator('body').evaluate(() => window.scrollTo(0, 1500));
  await expect(pv.locator('.scroll-to-top')).toBeVisible();
  await pv.locator('.scroll-to-top').click();
  await expect.poll(() => scrollY(pv)).toBe(0);
  // Tablet e telemóvel: a mesma folha, com as media queries originais.
  for (const [device, width] of [['Tablet', 820], ['Telemóvel', 390]] as const) {
    await page.getByRole('button', { name: device, exact: true }).click();
    await expect.poll(() => pv.locator('body').evaluate(() => window.innerWidth)).toBe(width);
    const tops = await pv.locator('#services .col-lg-3').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(width === 820 ? 2 : 4);
  }
  await page.getByRole('button', { name: 'Computador', exact: true }).click();

  // ---------------------------------------------------------------- confirmar (parcial: aceitação explícita)
  await page.getByTestId('import-name').fill('Stylish importado');
  await expect(page.getByTestId('import-confirm')).toBeDisabled();
  await page.getByTestId('import-accept-partial').check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  const projectUrl = page.url();

  const c = canvas(page);
  await expect(c.locator('h1')).toHaveText('Stylish Portfolio');
  // Imagens guardadas no projeto (modo local: dentro do documento); nenhum URL temporário.
  await expect(c.locator('img[src^="blob:"]')).toHaveCount(0);
  await expect(c.locator('img[src^="data:image/"]')).toHaveCount(4);
  expect(await backgroundLoads(c, '.masthead')).toBe(true);
  // A folha importada não aparece nas camadas.
  await page.getByTestId('tool-layers').click();
  await expect(page.getByTestId('layer-row').filter({ hasText: /stylesheet|Folha/i })).toHaveCount(0);

  // ---------------------------------------------------------------- editar
  await editText(page, c.locator('h1'), 'Portfólio Bolt');
  await editText(page, c.locator('#services p.text-faded').first(), 'Funciona em qualquer ecrã.');
  const button = c.locator('header a.btn').first();
  await editText(page, button, 'Saber mais');
  await page.getByTestId('prop-href').fill('#portfolio');
  await page.getByTestId('prop-href').press('Tab');
  await expect(button).toHaveAttribute('href', '#portfolio');
  // A legenda do portfólio cobre a imagem (como no original): clica-se nela e escolhe-se a
  // imagem nas camadas, ao lado.
  const firstImg = c.locator('#portfolio img').first();
  await c.locator('#portfolio .caption').first().click();
  await page.getByTestId('tool-layers').click();
  await page.getByTestId('layer-row').filter({ has: page.locator('.tree-label', { hasText: /^Imagem$/ }) }).first().click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: 'nova.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(firstImg).toHaveAttribute('src', /^data:image\/png;base64,/);

  // Fundo do cabeçalho: imagem própria (regra do elemento, sobre a classe da folha importada).
  const masthead = c.locator('header.masthead');
  const bgBefore = await masthead.evaluate((el) => getComputedStyle(el).backgroundImage);
  await masthead.click({ position: { x: 8, y: 8 } });
  const group = page.getByTestId('group-background');
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  await page.getByTestId('pick-background').click();
  const dialog = page.getByRole('dialog', { name: 'Imagem de fundo' });
  await dialog.getByPlaceholder('https://…').fill('https://exemplo.invalid/fundo-novo.png');
  await dialog.getByRole('button', { name: 'Usar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => masthead.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('fundo-novo.png');
  // Desfazer / refazer.
  await page.getByTestId('undo').click();
  await expect.poll(() => masthead.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(bgBefore);
  await page.getByTestId('redo').click();
  await expect.poll(() => masthead.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('fundo-novo.png');

  // Menu lateral também no canvas (para editar as ligações).
  // A barra do elemento selecionado (no canto superior direito) taparia o botão: seleciona-se o título.
  await c.locator('h1').click();
  await c.locator('.menu-toggle').click();
  await expect(c.locator('#sidebar-wrapper')).toHaveClass(/active/);
  await c.locator('.menu-toggle').click();
  await expect(c.locator('#sidebar-wrapper')).not.toHaveClass(/active/);

  // ---------------------------------------------------------------- guardar, F5, Dashboard
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  const expectEdits = async () => {
    const cc = canvas(page);
    await expect(cc.locator('h1')).toHaveText('Portfólio Bolt');
    await expect(cc.locator('#services p.text-faded').first()).toHaveText('Funciona em qualquer ecrã.');
    await expect(cc.locator('header a.btn').first()).toHaveText('Saber mais');
    await expect(cc.locator('header a.btn').first()).toHaveAttribute('href', '#portfolio');
    await expect(cc.locator('#portfolio img').first()).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect.poll(() => cc.locator('header.masthead').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('fundo-novo.png');
    expect(await backgroundLoads(cc, '.callout')).toBe(true);
  };
  await page.reload();
  await expectEdits();
  await page.getByTestId('back-to-projects').click();
  await page.getByRole('link', { name: 'Abrir Stylish importado' }).click();
  await expect(page).toHaveURL(projectUrl);
  await expectEdits();

  // ---------------------------------------------------------------- assistente (simulador, sem custo)
  await canvas(page).locator('h1').click();
  await page.getByTestId('ct-ai').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'ai');
  await expect(page.getByTestId('ai-engine')).toHaveText(/Simulador · sem IA/);
  await expect(page.getByTestId('ai-scope-name')).toContainText('Título');
  await page.getByTestId('ai-instruction').fill('texto: Portfólio com IA');
  await page.getByTestId('ai-propose').click();
  await expect(page.getByTestId('ai-change')).toHaveCount(1);
  // O contexto não leva a folha de estilos importada.
  const sent = await page.evaluate(() => JSON.stringify(window.__boltAiLastRequest ?? null));
  expect(sent).not.toContain('--bs-primary');
  expect(sent.length).toBeLessThan(60_000);
  await page.getByTestId('ai-apply').click();
  await expect(canvas(page).locator('h1')).toHaveText('Portfólio com IA');
  await page.getByTestId('undo').click();
  await expect(canvas(page).locator('h1')).toHaveText('Portfólio Bolt');

  // ---------------------------------------------------------------- template e cópia independente
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill('Stylish base');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toContainText('versão 1');
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  const fromTemplate = async (name: string) => {
    await page.goto('/templates');
    const card = page.getByTestId('team-template-card').filter({ hasText: 'Stylish base' });
    await card.getByTestId('use-team-template').click();
    await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
    await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  };
  await fromTemplate('Stylish derivado');
  expect(page.url()).not.toBe(projectUrl);
  await expect(canvas(page).locator('h1')).toHaveText('Portfólio Bolt');
  expect(await backgroundLoads(canvas(page), '.callout')).toBe(true);
  await expect.poll(() => canvas(page).locator('img').evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length)).toBe(4);
  await editText(page, canvas(page).locator('h1'), 'Só no derivado');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await fromTemplate('Stylish verificação');
  await expect(canvas(page).locator('h1')).toHaveText('Portfólio Bolt');
  await page.goto(projectUrl);
  await expect(canvas(page).locator('h1')).toHaveText('Portfólio Bolt');
});

test('HTML avulso: indica os ficheiros em falta e aceita-os depois; cancelar não cria projeto', async ({ page }) => {
  await page.goto('/importar');
  const html = '<!doctype html><html><head><title>Avulsa</title><link rel="stylesheet" href="css/estilo.css"></head><body><h1 class="t">Olá</h1><img src="img/foto.png" alt="f"></body></html>';
  await page.getByTestId('import-file').setInputFiles({ name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.getByTestId('import-review')).toBeVisible();
  const missing = page.getByTestId('import-missing');
  await expect(missing).toContainText('css/estilo.css');
  await expect(missing).toContainText('img/foto.png');
  await page.getByTestId('import-missing-files').setInputFiles([
    { name: 'estilo.css', mimeType: 'text/css', buffer: Buffer.from('.t{color:rgb(0, 128, 0)}') },
    { name: 'foto.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByTestId('import-review')).toBeVisible();
  await expect(page.getByTestId('import-missing')).toHaveCount(0);
  await expect(preview(page).locator('h1')).toHaveCSS('color', 'rgb(0, 128, 0)');
  await expect.poll(() => preview(page).locator('img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Escolher outro ficheiro' }).click();
  await page.goto('/');
  await expect(page.getByTestId('project-card')).toHaveCount(0);
});
