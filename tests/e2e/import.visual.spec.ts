import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Comparação visual (sob pedido: BOLT_VISUAL=1). Usa a rede real (imagens e fontes das amostras),
 * por isso não faz parte da execução normal. Guarda capturas em test-results para inspeção:
 *  - prévia do Bolt IA (documento convertido + runtime) a 1280 px e a 390 px;
 *  - referência «crua»: o JSON original carregado no GrapesJS Core sem conversão, com o CSS do
 *    próprio ficheiro (sem os plugins do Studio, que não estão disponíveis fora do Studio).
 */
test.skip(!process.env.BOLT_VISUAL, 'Só com BOLT_VISUAL=1 (usa a rede real).');

const SAMPLES = [
  ['studio', 'amostra/projeto-teste-2026-09-16-091529.grapesjs'],
  ['elementor', 'amostra/[Modelo] [Elementor] Carla Santos.json'],
] as const;

async function previewSource(page: Page, path: string): Promise<string> {
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 90_000 });
  return (await page.getByTestId('import-preview').getAttribute('srcdoc')) ?? '';
}

for (const [key, path] of SAMPLES) {
  test(`captura visual: ${key}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const doc = await previewSource(page, path);
    for (const [label, width, height] of [
      ['desktop', 1280, 800],
      ['mobile', 390, 844],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      await p.setContent(doc, { waitUntil: 'networkidle', timeout: 90_000 });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(800);
      const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`));
      const missing = await p.locator('img[data-bolt-missing]').count();
      info.annotations.push({ type: `${key}-${label}`, description: `fontes carregadas: ${fonts.join(', ') || 'nenhuma'}; imagens em falta: ${missing}` });
      await p.screenshot({ path: info.outputPath(`${key}-${label}.png`), fullPage: true });
      if (label === 'mobile') {
        const toggle = p.locator('[data-bolt-type="menu-toggle"]').first();
        if (await toggle.count()) {
          await toggle.click();
          await p.screenshot({ path: info.outputPath(`${key}-${label}-menu.png`) });
        }
      }
      await ctx.close();
    }

    if (key === 'studio') {
      // Referência crua (mesmo CSS, sem conversão).
      const raw = readFileSync(path, 'utf8');
      const out = await page.evaluate(async (json) => {
        // Módulo servido pelo Vite no browser (não resolvido pelo TypeScript do teste).
        const url = '/node_modules/grapesjs/dist/grapes.mjs';
        const mod: { default: { init(cfg: object): { getHtml(): string; getCss(): string | undefined; destroy(): void } } } = await import(/* @vite-ignore */ url);
        const ed = mod.default.init({ headless: true, storageManager: false, projectData: JSON.parse(json) });
        const r = { html: ed.getHtml(), css: ed.getCss() ?? '' };
        ed.destroy();
        return r;
      }, raw);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Barlow:wght@400;500;600;700&display=swap">';
      await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${out.css}</style></head>${out.html}</html>`, { waitUntil: 'networkidle', timeout: 90_000 });
      await p.screenshot({ path: info.outputPath(`${key}-raw-desktop.png`), fullPage: true });
      await ctx.close();
    }
  });
}
