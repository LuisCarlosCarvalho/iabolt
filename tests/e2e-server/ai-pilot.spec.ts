import { expect, test, type Locator, type Page } from '@playwright/test';
import { account, cleanupProjects, projectIdFromUrl, signedIn } from '../server/testAccounts';

/**
 * PERCURSO REAL DO PILOTO pela interface, com o FORNECEDOR REAL através da função `ai-propose`.
 * Tem CUSTO: 1 pedido (≈ 0,01 USD). Só corre com BOLT_AI_PILOT=1, depois de a migração, as funções e
 * a chave estarem configuradas e de o assistente estar ATIVO em «Configurações de IA» (docs/15):
 *   $env:BOLT_AI_PILOT = "1"
 *   npx playwright test --config playwright.server.config.ts ai-pilot.spec.ts
 *   Remove-Item Env:BOLT_AI_PILOT
 *
 * Em modo servidor, o assistente só aparece se a configuração central o tiver ativo (ai_status):
 * o teste confirma-o ANTES de começar e falha com uma mensagem clara se não estiver.
 *
 * Percurso: Nimbus (pelo nome) → selecionar o título (cor HERDADA de «h1, h2, h3, h4» ligada à variável
 * «Títulos») → pedir a cor principal do tema → pré-visualizar → aplicar → confirmar no documento
 * gravado `color: var(--bolt-primary)` → mudar a cor principal nos Estilos globais e ver o título
 * acompanhar → desfazer/refazer → guardar → F5 → reabrir pela Dashboard.
 */
const enabled = process.env.BOLT_AI_PILOT === '1';
const SAVED = 'Alterações guardadas no servidor';
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const created: string[] = [];

declare global {
  interface Window {
    __boltAiLastRequest?: { context: { capabilities: unknown; styles: Record<string, unknown> } };
  }
}

test.skip(!enabled, 'Só com BOLT_AI_PILOT=1 (chamada paga ao fornecedor real).');

test.afterAll(async () => {
  if (created.length) await cleanupProjects('A', created);
});

/** Regra própria do elemento no documento gravado (sem media query), lida do servidor. */
async function storedOwnColor(projectId: string, elementId: string): Promise<unknown> {
  const client = await signedIn('A');
  try {
    const { data } = await client.from('projects').select('project_data').eq('id', projectId).single();
    const styles: unknown = data?.project_data && typeof data.project_data === 'object' ? Reflect.get(data.project_data, 'styles') : null;
    const rules = Array.isArray(styles) ? styles : [];
    const own = rules.find((r: unknown) => {
      if (!r || typeof r !== 'object') return false;
      const sel = JSON.stringify(Reflect.get(r, 'selectors') ?? Reflect.get(r, 'selectorsAdd') ?? '');
      return sel.includes(`#${elementId}`) && !Reflect.get(r, 'mediaText');
    });
    const style: unknown = own && typeof own === 'object' ? Reflect.get(own, 'style') : null;
    return style && typeof style === 'object' ? Reflect.get(style, 'color') : undefined;
  } finally {
    await client.auth.signOut();
  }
}

test('piloto real: título com cor herdada da variável → cor principal do tema, ligada à variável; guardar, F5 e Dashboard', async ({ page }) => {
  test.setTimeout(180_000);

  // 0. O assistente tem de estar ativo na configuração central (senão o percurso pararia antes da chamada).
  const probe = await signedIn('A');
  const { data: statusRows } = await probe.rpc('ai_status');
  await probe.auth.signOut();
  const status: unknown = Array.isArray(statusRows) ? statusRows[0] : statusRows;
  const active = status && typeof status === 'object' ? Reflect.get(status, 'enabled') === true : false;
  expect(active, 'Ative o assistente em «Configurações de IA» (chave válida) antes de correr o piloto.').toBe(true);
  const modelLabel = String(status && typeof status === 'object' ? Reflect.get(status, 'model_label') : '');

  const { email, password } = account('A');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('E-mail profissional').fill(email);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar no estúdio' }).click();
  await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();

  // 1. Template Nimbus pelo nome.
  const name = `[teste automático] piloto IA ${Date.now()}`;
  await page.goto('/templates');
  await page.getByTestId('template-card').filter({ hasText: 'Nimbus' }).getByRole('button', { name: 'Usar este template' }).click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  const projectId = projectIdFromUrl(page.url());
  created.push(projectId);
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // Selecionar: cor herdada de «h1, h2, h3, h4 { color: var(--bolt-heading) }».
  const h1 = frame(page).locator('h1').first();
  const h1Id = (await h1.getAttribute('id')) ?? '';
  expect(h1Id).not.toBe('');
  const inherited = await css(h1, 'color');
  await h1.click();
  await page.getByTestId('tool-ai').click();
  await expect(page.getByTestId('ai-engine')).toContainText(modelLabel);

  // Pedir (chamada real, medida).
  const started = Date.now();
  const response = page.waitForResponse((r) => r.url().includes('/functions/v1/ai-propose'));
  await page.getByTestId('ai-instruction').fill('Põe este título com a cor principal do tema do site.');
  await page.getByTestId('ai-propose').click();
  const res = await response;
  const body: unknown = await res.json();
  const usage = body && typeof body === 'object' ? Reflect.get(body, 'usage') : null;
  console.log('Piloto (interface):', JSON.stringify({ status: res.status(), ms: Date.now() - started, usage }));
  expect(res.status()).toBe(200);
  const ctx = await page.evaluate(() => window.__boltAiLastRequest?.context);
  const ctxColor = ctx?.styles.color;
  if (ctx) expect(ctxColor && typeof ctxColor === 'object' ? Reflect.get(ctxColor, 'variable') : null).toBe('--bolt-heading');

  // Pré-visualizar: muda na prévia (1280 px), não no canvas.
  await expect(page.getByTestId('ai-proposal')).toBeVisible();
  await expect(page.getByTestId('ai-preview')).toHaveAttribute('data-width', '1280');
  await expect(page.getByTestId('ai-changes')).toContainText('Cor do texto');
  expect(await css(h1, 'color')).toBe(inherited);

  // Aplicar.
  await page.getByTestId('ai-apply').click();
  await expect(page.getByTestId('ai-applied')).toBeVisible();
  const primary = await frame(page).locator('.bolt-btn').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => css(h1, 'color')).toBe(primary);

  // 2. No documento GRAVADO o estilo usa a variável, não uma cor fixa igual.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  expect(await storedOwnColor(projectId, h1Id)).toBe('var(--bolt-primary)');

  // 3. Mudar a cor principal pelos Estilos globais: o título acompanha.
  await page.getByTestId('tool-styles').click();
  const primarySlot = page.locator('[data-testid="global-slot"][data-name="--bolt-primary"]');
  await primarySlot.getByTestId('global-value').fill('#0f7a3a');
  await primarySlot.getByTestId('global-value').press('Enter');
  await expect.poll(() => css(h1, 'color')).toBe('rgb(15, 122, 58)');

  // Desfazer (a cor global) e refazer; o título continua ligado.
  await page.getByTestId('undo').click();
  await expect.poll(() => css(h1, 'color')).toBe(primary);
  await page.getByTestId('redo').click();
  await expect.poll(() => css(h1, 'color')).toBe('rgb(15, 122, 58)');

  // Guardar, F5.
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(15, 122, 58)');

  // 4. Reabrir pela Dashboard.
  await page.goto('/');
  await page.getByRole('link', { name: `Abrir ${name}` }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await expect.poll(() => css(frame(page).locator('h1').first(), 'color')).toBe('rgb(15, 122, 58)');
  expect(await storedOwnColor(projectId, h1Id)).toBe('var(--bolt-primary)');
});
