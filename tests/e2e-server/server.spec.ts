import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Percurso do Bolt IA contra o SUPABASE REAL (`npm run test:e2e:server`, docs/07).
 * Usa as contas de teste BOLT_TEST_USER_A/B_* de `.env.local`. Cada teste começa num
 * contexto de browser novo (sem sessão). Os projetos criados ficam arquivados no fim.
 */
const env = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta ${name} em .env.local (ver docs/07-configurar-supabase.md).`);
  return v;
};
const account = (who: 'A' | 'B') => ({ email: env(`BOLT_TEST_USER_${who}_EMAIL`), password: env(`BOLT_TEST_USER_${who}_PASSWORD`) });

const SAVED = 'Alterações guardadas no servidor';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const layer = (page: Page, text: string) => page.getByTestId('layer-row').filter({ hasText: text }).first();
const unique = () => `[teste automático] ${new Date().toISOString().slice(11, 19)} ${Math.random().toString(36).slice(2, 6)}`;

async function login(page: Page, who: 'A' | 'B') {
  const { email, password } = account(who);
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Palavra-passe').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Guardado no servidor')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();
}

async function newLoggedPage(browser: Browser, who: 'A' | 'B') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, who);
  return { context, page };
}

async function createProject(page: Page, name: string) {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  return page.url();
}

async function editTitle(page: Page, text: string) {
  await layer(page, 'Título').click();
  await page.getByTestId('prop-text').fill(text);
  await page.getByTestId('prop-text').press('Tab');
}

async function archive(page: Page, name: string) {
  await page.goto('/');
  const options = page.getByRole('button', { name: `Opções de ${name}` });
  if ((await options.count()) === 0) return;
  await options.first().click();
  await page.getByRole('menuitem', { name: 'Remover' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByRole('button', { name: `Opções de ${name}` })).toHaveCount(0);
}

test('entrar, sair e voltar a entrar', async ({ page }) => {
  await login(page, 'A');
  await page.getByRole('button', { name: 'Terminar sessão' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await login(page, 'A');
});

test('criar, editar, carregar imagem, guardar e reabrir, também noutro browser autenticado', async ({ page, browser }) => {
  const name = unique();
  await login(page, 'A');
  const url = await createProject(page, name);
  await editTitle(page, 'Título gravado no servidor');
  await frame(page).locator('img.nb-hero-img').first().click();
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(frame(page).locator('img.nb-hero-img').first()).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/project-assets\//);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // Voltar à lista e reabrir.
  await page.getByTestId('back-to-projects').click();
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(page).toHaveURL(url);
  await expect(frame(page).locator('h1')).toHaveText('Título gravado no servidor');

  // Segundo browser (contexto novo, sem nada em cache), mesma conta.
  const second = await newLoggedPage(browser, 'A');
  await expect(second.page.getByRole('link', { name: `Abrir ${name}` })).toBeVisible();
  await second.page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(second.page).toHaveURL(url);
  await expect(frame(second.page).locator('h1')).toHaveText('Título gravado no servidor');
  const img = frame(second.page).locator('img.nb-hero-img').first();
  await expect(img).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/project-assets\//);
  await expect.poll(() => img.evaluate((el) => (el instanceof HTMLImageElement ? el.naturalWidth : 0))).toBeGreaterThan(0);
  await second.context.close();

  await archive(page, name);
});

test('outra conta não vê nem abre o projeto e não obtém a imagem', async ({ page, browser }) => {
  const name = unique();
  await login(page, 'A');
  const url = await createProject(page, name);
  await frame(page).locator('img.nb-hero-img').first().click();
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: 'privada.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  const signedA = (await frame(page).locator('img.nb-hero-img').first().getAttribute('src')) ?? '';
  const publicUrl = signedA.replace('/object/sign/', '/object/public/').split('?')[0] ?? '';

  const other = await newLoggedPage(browser, 'B');
  await expect(other.page.getByRole('link', { name: `Abrir ${name}` })).toHaveCount(0);
  await other.page.goto(url);
  await expect(other.page.getByRole('heading', { name: 'Projeto não encontrado' })).toBeVisible();
  // Sem o token assinado, o ficheiro não é servido (bucket privado).
  const res = await other.page.request.get(publicUrl);
  expect(res.status()).not.toBe(200);
  await other.context.close();

  await archive(page, name);
});

test('falha de rede ao guardar mostra erro, nunca «guardado», e a repetição grava', async ({ page, context }) => {
  const name = unique();
  await login(page, 'A');
  await createProject(page, name);
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

  await archive(page, name);
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
  await expect(page.getByRole('link', { name: `Abrir ${name}` })).toHaveCount(1);

  // Repetir não duplica (idempotência pela chave = id local), e o original local continua lá.
  await page.reload();
  await expect(page.getByTestId('local-projects-panel')).toContainText('já foram copiados');
  await expect(page.getByRole('link', { name: `Abrir ${name}` })).toHaveCount(1);
  const stillLocal = await page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('bolt-ia', 1);
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
  await archive(page, name);
});

test('duas abas: a segunda recebe conflito e não sobrescreve', async ({ page, context }) => {
  const name = unique();
  await login(page, 'A');
  const url = await createProject(page, name);
  const tabB = await context.newPage();
  await tabB.goto(url);
  await expect(tabB.getByTestId('save-status')).toHaveText(SAVED);

  await editTitle(page, 'Versão da aba A');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  await editTitle(tabB, 'Versão da aba B');
  await tabB.getByTestId('save').click();
  await expect(tabB.getByTestId('save-status')).toHaveText('Conflito: versão mais recente noutro sítio');

  const check = await context.newPage();
  await check.goto(url);
  await expect(frame(check).locator('h1')).toHaveText('Versão da aba A');

  await archive(page, name);
});
