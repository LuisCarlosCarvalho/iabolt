import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { SupabaseTemplateLibrary } from '../../src/library/supabaseTemplateLibrary';
import { account, cleanupProjects, projectIdFromUrl, signedIn } from '../server/testAccounts';

/**
 * Importação do ZIP «Stylish Portfolio» contra o SUPABASE REAL, com a conta de teste A
 * (`.env.local`; contas `admin@…` são recusadas). Sem chamadas pagas.
 *   npx playwright test --config playwright.server.config.ts import-static.spec.ts
 *
 * Percurso: importar → imagens e fundos guardados no Storage (referências `bolt-asset:` permanentes)
 * → editar e guardar → F5 → reabrir pela Dashboard → criar template → cópia independente.
 *
 * Limpeza (só o que este teste criou): templates arquivados pelo nome; projetos arquivados (a base
 * de dados não permite apagar) e as imagens que referem removidas do Storage. O registo da
 * importação (`import_records`) é imutável por desenho e fica, ligado ao projeto arquivado.
 */
const SAVED = 'Alterações guardadas no servidor';
const ZIP = 'amostra/startbootstrap-stylish-portfolio-gh-pages.zip';
const SIGNED = '/storage/v1/object/sign/project-assets/';
const REF = /bolt-asset:[0-9a-f-]{36}\/library\/[0-9a-f-]{36}\.\w+/g;
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const createdProjects: string[] = [];
const createdTemplates: string[] = [];

test.afterAll(async () => {
  const client = await signedIn('A');
  try {
    const lib = new SupabaseTemplateLibrary(client, '0.23.6');
    for (const t of await lib.list()) if (createdTemplates.includes(t.name)) await lib.archive(t.id);
  } finally {
    await client.auth.signOut();
  }
  const problems = await cleanupProjects('A', createdProjects);
  if (problems.length) console.warn(`Limpeza incompleta:\n${problems.join('\n')}`);
});

/** Fundo calculado: endereço assinado do Storage e a imagem carrega mesmo. */
const backgroundFromStorage = (f: FrameLocator, selector: string) =>
  f.locator(selector).first().evaluate(
    (el, signed) =>
      new Promise<boolean>((resolve) => {
        const m = /url\("?([^")]+)"?\)/.exec(getComputedStyle(el).backgroundImage);
        if (!m?.[1]?.includes(signed)) return resolve(false);
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = m[1];
      }),
    SIGNED,
  );

async function expectImagesFromStorage(page: Page) {
  const c = frame(page);
  await expect(c.locator('h1')).toBeVisible();
  await expect.poll(() => c.locator(`img[src*="${SIGNED}"]`).evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length), { timeout: 30_000 }).toBe(4);
  await expect(c.locator('img[src^="blob:"]')).toHaveCount(0);
  expect(await backgroundFromStorage(c, '.masthead')).toBe(true);
  expect(await backgroundFromStorage(c, '.callout')).toBe(true);
}

/** Documento gravado no servidor: só referências permanentes (nunca blob: nem URLs assinados). */
async function storedRefs(projectId: string): Promise<string[]> {
  const client = await signedIn('A');
  try {
    const { data, error } = await client.from('projects').select('project_data').eq('id', projectId).single();
    if (error) throw new Error(error.message);
    const text = JSON.stringify(data.project_data);
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('/storage/v1/object/sign/');
    // Os dois fundos ficam na folha importada com a referência permanente.
    expect(text.match(/url\(\\"bolt-asset:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    return [...new Set(text.match(REF) ?? [])].sort();
  } finally {
    await client.auth.signOut();
  }
}

test('ZIP no servidor: imagens e fundos no Storage, F5, Dashboard, template e cópia independente', async ({ page }) => {
  test.setTimeout(300_000);
  // Sem dependências de terceiros (fontes, ícones, mapa): o teste incide sobre o armazenamento.
  await page.route(/use\.fontawesome\.com|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|google\.com|cdn\.jsdelivr\.net/, (r) => r.abort('internetdisconnected'));
  const { email, password } = account('A');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('E-mail profissional').fill(email);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar no estúdio' }).click();
  await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();

  // 1. Importar.
  const name = `[teste automático] ZIP estático ${Date.now()}`;
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(ZIP);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('import-assets').locator('li', { hasText: 'Guardada ao importar' })).toHaveCount(6);
  await page.getByTestId('import-name').fill(name);
  await page.getByTestId('import-accept-partial').check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const projectId = projectIdFromUrl(page.url());
  createdProjects.push(projectId);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // 2. Imagens e fundos servidos pelo Storage; no documento, 6 referências permanentes.
  await expectImagesFromStorage(page);
  const refs = await storedRefs(projectId);
  expect(refs).toHaveLength(6);

  // Registo do original (manifesto do site, não o ZIP binário).
  const probe = await signedIn('A');
  try {
    const { data } = await probe.from('import_records').select('format, original_text').eq('project_id', projectId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.format).toBe('zip');
    expect(String(data?.[0]?.original_text ?? '')).toMatch(/^\{"kind":"bolt-static-site"/);
  } finally {
    await probe.auth.signOut();
  }

  // 3. Editar, guardar, F5, Dashboard.
  await frame(page).locator('h1').click();
  await page.getByTestId('prop-text').fill('Portfólio no servidor');
  await page.getByTestId('prop-text').press('Tab');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(frame(page).locator('h1')).toHaveText('Portfólio no servidor');
  await expectImagesFromStorage(page);
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}`, exact: true }).click();
  await expect(frame(page).locator('h1')).toHaveText('Portfólio no servidor');
  await expectImagesFromStorage(page);
  expect(await storedRefs(projectId)).toEqual(refs);

  // 4. Template e cópia independente: as mesmas referências permanentes.
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
  const copyId = projectIdFromUrl(page.url());
  createdProjects.push(copyId);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expectImagesFromStorage(page);
  expect(await storedRefs(copyId)).toEqual(refs);
  await frame(page).locator('h1').click();
  await page.getByTestId('prop-text').fill('Só na cópia');
  await page.getByTestId('prop-text').press('Tab');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(frame(page).locator('h1')).toHaveText('Só na cópia');
  await expectImagesFromStorage(page);

  // O original não mudou.
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}`, exact: true }).click();
  await expect(frame(page).locator('h1')).toHaveText('Portfólio no servidor');
});
