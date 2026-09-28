import { expect, test, type Browser, type Page } from '@playwright/test';
import { account, cleanupProjects, projectIdFromUrl, type Who } from '../server/testAccounts';

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
