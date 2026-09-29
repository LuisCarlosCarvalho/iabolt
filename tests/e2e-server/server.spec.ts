import { expect, test, type Browser, type Page } from '@playwright/test';
import { SupabaseTemplateLibrary } from '../../src/library/supabaseTemplateLibrary';
import { account, cleanupProjects, projectIdFromUrl, signedIn, type Who } from '../server/testAccounts';

/**
 * Percurso do Bolt IA contra o SUPABASE REAL (`npm run test:e2e:server`, docs/07).
 * Só usa as contas de teste A e B de `.env.local`. Cada teste começa num contexto de
 * browser novo (sem sessão). No fim, os projetos criados pelos testes (e só esses)
 * perdem as imagens e ficam arquivados.
 */
const SAVED = 'Alterações guardadas no servidor';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const SIGNED = /\/storage\/v1\/object\/sign\/project-assets\//;
const RED = 'rgb(220, 38, 38)';
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const layer = (page: Page, text: string) => page.getByTestId('layer-row').filter({ hasText: text }).first();
const unique = () => `[teste automático] ${new Date().toISOString().slice(11, 19)} ${Math.random().toString(36).slice(2, 6)}`;

/** Projetos criados por esta execução, por conta. Só estes são limpos. */
const created: Record<Who, string[]> = { A: [], B: [] };

test.afterAll(async () => {
  const problems = [...(await cleanupProjects('A', created.A)), ...(await cleanupProjects('B', created.B))];
  if (problems.length > 0) console.warn(`Limpeza incompleta:\n${problems.join('\n')}`);
});

async function login(page: Page, who: Who) {
  const { email, password } = account(who);
  await page.goto('/');
  await page.getByLabel('E-mail profissional').fill(email);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar no estúdio' }).click();
  await expect(page.getByText('Guardado no servidor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();
}

async function newLoggedPage(browser: Browser, who: Who) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, who);
  return { context, page };
}

async function createProject(page: Page, name: string, who: Who = 'A') {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  created[who].push(projectIdFromUrl(page.url()));
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  return page.url();
}

async function editTitle(page: Page, text: string) {
  await layer(page, 'Título').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Título');
  await page.getByTestId('prop-text').fill(text);
  await page.getByTestId('prop-text').press('Tab');
}

async function uploadHeroImage(page: Page, fileName: string) {
  await frame(page).locator('img.nb-hero-img').first().click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: fileName, mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(frame(page).locator('img.nb-hero-img').first()).toHaveAttribute('src', SIGNED);
}

async function save(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

/** O que o teste principal grava; verificado depois de reabrir, recarregar e noutro browser. */
async function expectPersisted(page: Page) {
  const f = frame(page);
  await expect(f.locator('h1')).toHaveText('Título gravado no servidor');
  await expect(f.locator('h1')).toHaveCSS('color', RED);
  const navButton = f.locator('nav a[data-bolt-type="button"]');
  await expect(navButton).toHaveText('Falar connosco');
  await expect(navButton).toHaveAttribute('href', 'mailto:ola@exemplo.pt');
  await expect(navButton).toHaveAttribute('target', '_blank');
  const img = f.locator('img.nb-hero-img').first();
  await expect(img).toHaveAttribute('src', SIGNED);
  // O GrapesJS cria os elementos com o `document` da janela principal e só depois os põe na
  // moldura: `instanceof HTMLImageElement` é falso dentro do iframe. Medir sem depender do construtor.
  await expect
    .poll(() =>
      img.evaluate((el) => ({
        loaded: el.tagName === 'IMG' && 'complete' in el && el.complete === true && 'naturalWidth' in el && typeof el.naturalWidth === 'number' && el.naturalWidth > 0,
        src: 'currentSrc' in el && typeof el.currentSrc === 'string' ? el.currentSrc : '',
      })),
    )
    .toEqual({ loaded: true, src: expect.stringMatching(SIGNED) });
}

test('entrar, sair e voltar a entrar', async ({ page }) => {
  await login(page, 'A');
  await page.getByRole('button', { name: 'Terminar sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await login(page, 'A');
});

test('template → editar texto, estilo, ligação e imagem → guardar → F5 → Dashboard → outro browser', async ({ page, browser }) => {
  const name = unique();
  await login(page, 'A');
  const url = await createProject(page, name);

  // Texto e estilo (cor do título, no computador).
  await editTitle(page, 'Título gravado no servidor');
  await page.getByRole('textbox', { name: 'Cor do texto', exact: true }).fill('#dc2626');
  await page.getByRole('textbox', { name: 'Cor do texto', exact: true }).press('Enter');
  await expect(frame(page).locator('h1')).toHaveCSS('color', RED);

  // Ligação: texto, destino e novo separador do botão da navegação.
  await frame(page).getByText('Pedir demonstração').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Botão');
  await page.getByTestId('prop-text').fill('Falar connosco');
  await page.getByTestId('prop-text').press('Enter');
  await page.getByTestId('prop-href').fill('mailto:ola@exemplo.pt');
  await page.getByTestId('prop-href').press('Enter');
  await page.getByLabel('Abrir num novo separador').check();

  // Imagem privada.
  await uploadHeroImage(page, 'foto.png');
  await save(page);

  // Recarregar a página.
  await page.reload();
  await expectPersisted(page);

  // Voltar à Dashboard e reabrir.
  await page.getByTestId('back-to-projects').click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(page).toHaveURL(url);
  await expectPersisted(page);

  // Segundo browser (contexto novo, sem nada em cache), mesma conta.
  const second = await newLoggedPage(browser, 'A');
  await second.page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(second.page).toHaveURL(url);
  await expectPersisted(second.page);
  await second.context.close();
});

test('isolamento: a conta B não vê nem abre o projeto de A e não obtém a imagem', async ({ page, browser }) => {
  const name = unique();
  await login(page, 'A');
  const url = await createProject(page, name);
  await uploadHeroImage(page, 'privada.png');
  await save(page);
  const signedA = (await frame(page).locator('img.nb-hero-img').first().getAttribute('src')) ?? '';
  const publicUrl = signedA.replace('/object/sign/', '/object/public/').split('?')[0] ?? '';
  const authenticatedUrl = signedA.replace('/object/sign/', '/object/authenticated/').split('?')[0] ?? '';

  const other = await newLoggedPage(browser, 'B');
  await expect(other.page.getByRole('link', { name: `Abrir ${name}` })).toHaveCount(0);
  await other.page.goto(url);
  await expect(other.page.getByRole('heading', { name: 'Projeto não encontrado' })).toBeVisible();
  // Sem o token assinado de A, o ficheiro não é servido: nem público, nem com a sessão de B.
  expect((await other.page.request.get(publicUrl)).status()).not.toBe(200);
  const tokenB = await other.page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (parsed && typeof parsed === 'object' && 'access_token' in parsed && typeof parsed.access_token === 'string') return parsed.access_token;
      }
    }
    return '';
  });
  expect(tokenB).not.toBe('');
  const withB = await other.page.request.get(authenticatedUrl, { headers: { Authorization: `Bearer ${tokenB}` } });
  expect(withB.status()).not.toBe(200);
  await other.context.close();
});

test('falha de rede ao guardar mostra erro, nunca «guardado», e a repetição grava', async ({ page, context }) => {
  await login(page, 'A');
  await createProject(page, unique());
  await context.setOffline(true);
  await editTitle(page, 'Alteração sem rede');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Não foi possível guardar');
  await expect(page.getByText(SAVED)).toHaveCount(0);
  await expect(frame(page).locator('h1')).toHaveText('Alteração sem rede');

  await context.setOffline(false);
  await page.getByRole('alert').getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(frame(page).locator('h1')).toHaveText('Alteração sem rede');
});

test('projetos do modo local continuam no browser e podem ser copiados para a conta sem duplicar', async ({ page }) => {
  const name = unique();
  const localId = crypto.randomUUID();
  // Um projeto criado antes, em modo local, neste mesmo browser (mesma estrutura do IndexedDbRepository).
  await page.goto('/');
  await page.evaluate(
    async ({ id, projectName }) => {
      const now = new Date().toISOString();
      const document = {
        boltSchemaVersion: 1,
        engine: { name: 'grapesjs', version: '0.23.6' },
        projectId: id,
        revision: 3,
        projectData: {
          pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', tagName: 'h1', attributes: { id: 't' }, content: 'Feito em modo local' }] } }] }],
        },
      };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('bolt-ia', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('projects', { keyPath: 'id' });
          open.result.createObjectStore('idempotency', { keyPath: 'key' });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('projects', 'readwrite');
          tx.objectStore('projects').put({ id, name: projectName, templateId: null, revision: 3, createdAt: now, updatedAt: now, archivedAt: null, document: JSON.stringify(document) });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { id: localId, projectName: name },
  );

  await login(page, 'A');
  const panel = page.getByTestId('local-projects-panel');
  await expect(panel).toContainText('Há 1 projeto');
  await expect(panel).toContainText(name);
  await panel.getByTestId('copy-local').click();
  await expect(panel).toContainText('já foram copiados');
  const link = page.getByRole('link', { name: `Abrir ${name}` });
  await expect(link).toHaveCount(1);
  created.A.push(projectIdFromUrl((await link.getAttribute('href')) ?? ''));

  // Repetir não duplica (idempotência pela chave = id local), e o original local continua lá.
  await page.reload();
  await expect(page.getByTestId('local-projects-panel')).toContainText('já foram copiados');
  await expect(page.getByRole('link', { name: `Abrir ${name}` })).toHaveCount(1);
  const stillLocal = await page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        // Sem versão: abre a atual (a app já atualizou a base local para a v2 sem perder dados).
        const open = indexedDB.open('bolt-ia');
        open.onsuccess = () => {
          const req = open.result.transaction('projects', 'readonly').objectStore('projects').get(id);
          req.onsuccess = () => resolve(Boolean(req.result));
          req.onerror = () => resolve(false);
        };
        open.onerror = () => resolve(false);
      }),
    localId,
  );
  expect(stillLocal).toBe(true);

  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(frame(page).locator('h1')).toHaveText('Feito em modo local');
});

test('duas sessões: a segunda recebe conflito e não sobrescreve', async ({ page, browser }) => {
  await login(page, 'A');
  const url = await createProject(page, unique());
  // Segunda sessão num browser separado (outro contexto, outro login), mesma conta.
  const second = await newLoggedPage(browser, 'A');
  await second.page.goto(url);
  await expect(second.page.getByTestId('save-status')).toHaveText(SAVED);

  await editTitle(page, 'Versão da sessão A');
  await save(page);

  await editTitle(second.page, 'Versão da sessão B');
  await second.page.getByTestId('save').click();
  await expect(second.page.getByTestId('save-status')).toHaveText('Conflito: versão mais recente noutro sítio');
  await expect(second.page.getByRole('alert').filter({ hasText: 'alterado noutro separador' })).toBeVisible();
  await second.context.close();

  await page.reload();
  await expect(frame(page).locator('h1')).toHaveText('Versão da sessão A');
});

test('inspetor: imagem de fundo carregada e ajuste só no telemóvel ficam gravados com referência durável', async ({ page }) => {
  await login(page, 'A');
  await createProject(page, unique());
  const projectId = projectIdFromUrl(page.url());

  // Imagem de fundo numa coluna, pelo diálogo de imagens existente (carregamento para o Storage).
  await page.getByTestId('layer-row').filter({ has: page.locator('.tree-label', { hasText: /^Coluna$/ }) }).first().click();
  const colId = await frame(page).locator('.gjs-selected').getAttribute('id');
  const col = frame(page).locator(`#${colId ?? ''}`);
  const head = page.getByTestId('group-background');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.getByTestId('pick-background').click();
  const dialog = page.getByRole('dialog', { name: 'Imagem de fundo' });
  await dialog.getByTestId('image-file-input').setInputFiles({ name: 'fundo.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog).toBeHidden();
  await expect.poll(() => col.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(SIGNED);

  // Ajuste só no telemóvel.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  const spacing = page.getByTestId('group-spacing');
  if ((await spacing.getAttribute('aria-expanded')) !== 'true') await spacing.click();
  await page.getByTestId('style-padding-top').fill('7');
  await page.getByTestId('style-padding-top').press('Enter');
  await save(page);

  // No servidor: referência estável dentro de url(...), nunca o URL assinado; regra móvel no breakpoint.
  const client = await signedIn('A');
  try {
    const { data, error } = await client.from('projects').select('project_data').eq('id', projectId).single();
    expect(error).toBeNull();
    const text = JSON.stringify(data?.project_data ?? null);
    const refs = text.match(/bolt-asset:[A-Za-z0-9._/-]+/g) ?? [];
    expect(refs.some((r) => r.includes('/library/'))).toBe(true);
    // Dentro de url(...) no CSS (as aspas aparecem escapadas no JSON).
    expect(text.includes('url(\\"bolt-asset:') || text.includes('url(bolt-asset:')).toBe(true);
    expect(text).not.toMatch(/\/storage\/v1\/object\/sign\//);
    expect(text).toContain('(max-width: 480px)');
    expect(text).toContain('"padding-top":"7px"');
  } finally {
    await client.auth.signOut();
  }

  // Reabrir: a imagem volta a aparecer (novo URL assinado) e o computador não tem o ajuste móvel.
  await page.reload();
  const again = frame(page).locator(`#${colId ?? ''}`);
  await expect.poll(() => again.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(SIGNED);
  expect(await again.evaluate((el) => getComputedStyle(el).paddingTop)).not.toBe('7px');
});

test('Imagens: carregada sem inserir volta a estar disponível após F5; inserir, guardar e reabrir', async ({ page }) => {
  await login(page, 'A');
  await createProject(page, unique());
  const projectId = projectIdFromUrl(page.url());
  await page.getByTestId('tool-images').click();
  await page.getByTestId('images-file-input').setInputFiles({ name: 'disponivel.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').filter({ hasText: 'Fica disponível mesmo depois de recarregar' })).toBeVisible();
  // Carregar não alterou o documento.
  await expect(page.getByTestId('undo')).toBeDisabled();
  const imgs = await frame(page).locator('img').count();

  await page.reload();
  await page.getByTestId('tool-images').click();
  const available = page.getByTestId('images-available');
  await expect(available.getByTestId('image-tile').first()).toBeVisible();
  // A mais recente (a que acabou de ser carregada) aparece primeiro.
  await available.getByTestId('image-insert').first().click();
  await expect(frame(page).locator('img')).toHaveCount(imgs + 1);
  await save(page);

  const client = await signedIn('A');
  try {
    const { data } = await client.from('projects').select('project_data').eq('id', projectId).single();
    const text = JSON.stringify(data?.project_data ?? null);
    expect(text).toMatch(/bolt-asset:[0-9a-f-]+\/library\//);
    expect(text).not.toMatch(/\/storage\/v1\/object\/sign\//);
  } finally {
    await client.auth.signOut();
  }
  await page.reload();
  await expect(frame(page).locator('img')).toHaveCount(imgs + 1);
  await expect(frame(page).locator('img[src*="/storage/v1/object/sign/"]').first()).toBeVisible();
});

/** Templates criados por esta execução (arquivados no fim; só estes). */
const createdTemplates: string[] = [];
test.afterAll(async () => {
  if (createdTemplates.length === 0) return;
  const client = await signedIn('A');
  try {
    const lib = new SupabaseTemplateLibrary(client, '0.23.6');
    for (const t of await lib.list()) if (createdTemplates.includes(t.name)) await lib.archive(t.id);
  } finally {
    await client.auth.signOut();
  }
});

/** Espera por uma gravação AUTOMÁTICA (sem clicar em «Guardar»): a revisão sobe e o estado volta a «guardado». */
async function waitAutosave(page: Page, after: number): Promise<number> {
  await expect.poll(async () => Number(await page.getByTestId('diag-revision').textContent()), { timeout: 20_000 }).toBeGreaterThan(after);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  return Number(await page.getByTestId('diag-revision').textContent());
}

test('várias páginas: gravação automática dos eventos de página, página inicial, slugs, estilos, imagens e template com todas as páginas', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'A');
  const name = unique();
  await createProject(page, name);
  const projectId = projectIdFromUrl(page.url());
  let rev = Number(await page.getByTestId('diag-revision').textContent());

  // Segunda página (criar e mudar o nome são eventos de página: têm de gravar sozinhos).
  await page.getByTestId('page-add').click();
  rev = await waitAutosave(page, rev);
  await page.getByTestId('page-rename').click();
  await page.getByTestId('page-rename-input').fill('Contactos');
  await page.getByTestId('page-rename-input').press('Enter');
  rev = await waitAutosave(page, rev);

  // Conteúdo, estilo e imagem na segunda página.
  await page.getByTestId('tool-blocks').click();
  await page.getByTestId('block-heading').click();
  await page.getByTestId('prop-text').fill('Página dois gravada');
  await page.getByTestId('prop-text').press('Tab');
  const spacing = page.getByTestId('group-spacing');
  if ((await spacing.getAttribute('aria-expanded')) !== 'true') await spacing.click();
  await page.getByTestId('style-padding-top').fill('14');
  await page.getByTestId('style-padding-top').press('Enter');
  await page.getByTestId('tool-images').click();
  await page.getByTestId('images-file-input').setInputFiles({ name: 'pagina2.png', mimeType: 'image/png', buffer: PNG });
  const available = page.getByTestId('images-available');
  await expect(available.getByTestId('image-tile').first()).toBeVisible();
  await available.getByTestId('image-insert').first().click();
  rev = await waitAutosave(page, rev);

  // Página inicial passa a ser «Contactos» (também gravado automaticamente).
  await page.getByTestId('tool-layers').click();
  await page.getByTestId('page-home').click();
  await waitAutosave(page, rev);

  // Reabrir pela Dashboard.
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  const rows = page.getByTestId('page-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Contactos');
  await expect(rows.nth(0)).toContainText('Inicial');
  await expect(rows.nth(0)).toContainText('/nova-pagina');
  await expect(rows.nth(1)).toContainText('/inicio');
  await expect(frame(page).getByText('Página dois gravada')).toBeVisible();
  await expect.poll(() => frame(page).getByText('Página dois gravada').evaluate((el) => getComputedStyle(el).paddingTop)).toBe('14px');
  await expect(frame(page).locator('img[src*="/storage/v1/object/sign/"]').first()).toBeVisible();
  await rows.nth(1).click();
  await expect(frame(page).locator('h1')).toHaveCount(1);

  // No servidor: duas páginas, inicial marcada, slugs gravados, referências estáveis.
  const client = await signedIn('A');
  try {
    const { data } = await client.from('projects').select('project_data').eq('id', projectId).single();
    const stored: unknown = data?.project_data;
    const pagesJson = JSON.stringify(stored && typeof stored === 'object' ? Reflect.get(stored, 'pages') : null);
    const text = JSON.stringify(stored);
    expect(pagesJson).toMatch(/"name":"Contactos"[^]*"slug":"nova-pagina"|"slug":"nova-pagina"[^]*"name":"Contactos"/);
    expect(pagesJson).toContain('"slug":"inicio"');
    expect(pagesJson).toContain('"type":"main"');
    expect(text).toMatch(/bolt-asset:[0-9a-f-]+\/library\//);
    expect(text).not.toMatch(/\/storage\/v1\/object\/sign\//);
  } finally {
    await client.auth.signOut();
  }

  // Guardar como template e criar uma cópia independente com todas as páginas.
  const tplName = `${name} template`;
  createdTemplates.push(tplName);
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill(tplName);
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  await page.goto('/templates');
  await page.getByTestId('team-template-card').filter({ hasText: tplName }).getByTestId('use-team-template').click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(`${name} cópia`);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  created.A.push(projectIdFromUrl(page.url()));
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect(page.getByTestId('page-row')).toHaveCount(2);
  await expect(page.getByTestId('page-row').nth(0)).toContainText('Contactos');
  await expect(frame(page).getByText('Página dois gravada')).toBeVisible();
  // Cópia independente: editar a cópia não muda o original.
  await frame(page).getByText('Página dois gravada').click();
  await page.getByTestId('prop-text').fill('Só na cópia');
  await page.getByTestId('prop-text').press('Tab');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(frame(page).getByText('Página dois gravada')).toBeVisible();
});

test('estilos globais: gravação automática, F5, reabrir pela Dashboard, template e cópia independente', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'A');
  const name = unique();
  await createProject(page, name);
  const projectId = projectIdFromUrl(page.url());
  const slot = (n: string) => page.locator(`[data-testid="global-slot"][data-name="${n}"]`);
  const heading = () => slot('--bolt-heading').getByTestId('global-value');
  let rev = Number(await page.getByTestId('diag-revision').textContent());

  // Abrir o painel não grava nada.
  await page.getByTestId('tool-styles').click();
  await expect(page.getByTestId('global-styles-panel')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  expect(Number(await page.getByTestId('diag-revision').textContent())).toBe(rev);

  // Cor e fonte partilhadas, cada uma gravada automaticamente.
  await heading().fill('#b91c1c');
  await heading().press('Enter');
  rev = await waitAutosave(page, rev);
  await slot('--bolt-font-heading').getByTestId('global-font').selectOption({ label: 'Com serifa (Georgia)' });
  await waitAutosave(page, rev);

  // F5 e reabrir pela Dashboard.
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.getByTestId('tool-styles').click();
  await expect(heading()).toHaveValue('#b91c1c');
  await expect.poll(() => frame(page).locator('h2').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');

  // No servidor: variáveis gravadas na regra global, sem conversão dos valores próprios.
  const client = await signedIn('A');
  try {
    const { data } = await client.from('projects').select('project_data').eq('id', projectId).single();
    const text = JSON.stringify(data?.project_data);
    expect(text).toContain('"--bolt-heading":"#b91c1c"');
    expect(text).toContain("Georgia, 'Times New Roman', serif");
  } finally {
    await client.auth.signOut();
  }

  // Template e cópia independente.
  const tplName = `${name} globais`;
  createdTemplates.push(tplName);
  await page.getByTestId('save-as-template').click();
  await page.getByTestId('template-name').fill(tplName);
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar a editar' }).click();
  const fromTemplate = async (copyName: string) => {
    await page.goto('/templates');
    await page.getByTestId('team-template-card').filter({ hasText: tplName }).getByTestId('use-team-template').click();
    await page.getByRole('dialog').getByLabel('Nome do projeto').fill(copyName);
    await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
    await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
    created.A.push(projectIdFromUrl(page.url()));
    await expect(page.getByTestId('save-status')).toHaveText(SAVED);
    await page.getByTestId('tool-styles').click();
  };
  await fromTemplate(`${name} cópia A`);
  await expect(heading()).toHaveValue('#b91c1c');
  await heading().fill('#00aa00');
  await heading().press('Enter');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  // O template e o projeto original não mudaram.
  await fromTemplate(`${name} cópia B`);
  await expect(heading()).toHaveValue('#b91c1c');
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await page.getByTestId('tool-styles').click();
  await expect(heading()).toHaveValue('#b91c1c');
});
