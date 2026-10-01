import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readZip } from '../../src/importers/static/zip';

/**
 * Comparação visual do ZIP «Stylish Portfolio» (sob pedido: BOLT_VISUAL=1; usa a rede real).
 *
 * Referência: o HTML/CSS ORIGINAL do arquivo, servido tal como está num endereço isolado
 * (http://original.test/), com o JavaScript DESLIGADO — nada do arquivo é executado. Não se
 * usa o resultado convertido como referência de si próprio.
 * Comparado: a pré-visualização do Bolt IA (o documento convertido + runtime), nas mesmas
 * dimensões. Guarda capturas, imagens de diferenças e medidas de posição dos elementos.
 */
test.skip(!process.env.BOLT_VISUAL, 'Só com BOLT_VISUAL=1 (usa a rede real).');

const ZIP = 'amostra/startbootstrap-stylish-portfolio-gh-pages.zip';
const ROOT = 'startbootstrap-stylish-portfolio-gh-pages/';
const SIZES = [
  ['computador', 1280, 800],
  ['tablet', 820, 1180],
  ['telemovel', 390, 844],
] as const;
const PROBES = ['h1', '.masthead', '#about', '#about h2', '#services', '#services .col-lg-3', '.callout', '#portfolio', '#portfolio .col-lg-6', '.map', 'footer', 'footer .social-link', '.menu-toggle'];

const MIME: Record<string, string> = { html: 'text/html', css: 'text/css', js: 'text/javascript', jpg: 'image/jpeg', ico: 'image/x-icon' };

async function originalFiles(): Promise<Map<string, Buffer>> {
  const zip = readZip(new Uint8Array(readFileSync(ZIP)));
  const out = new Map<string, Buffer>();
  for (const e of zip.entries) out.set(e.path.replace(ROOT, ''), Buffer.from(await zip.read(e)));
  return out;
}

/** Estado do mapa incorporado: frames do Google carregados e com conteúdo. */
async function mapState(p: Page): Promise<string> {
  await p.locator('.map iframe').scrollIntoViewIfNeeded();
  await p.waitForTimeout(4000);
  const frames = p.frames().filter((f) => /google.com/.test(f.url()));
  const sizes = await Promise.all(frames.map((f) => f.evaluate(() => document.body?.innerHTML.length ?? 0).catch(() => -1)));
  return frames.length ? frames.map((f, i) => `${new URL(f.url()).host}${new URL(f.url()).pathname} (${sizes[i]} car.)`).join('; ') : 'nenhum frame do Google';
}

async function settle(p: Page) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
}

async function geometry(p: Page) {
  return p.evaluate((sels) => {
    const out: Record<string, number[][]> = {};
    for (const s of sels) out[s] = [...document.querySelectorAll(s)].map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top + window.scrollY), Math.round(r.width), Math.round(r.height)];
    });
    return out;
  }, PROBES);
}

/** Percentagem de píxeis diferentes (tolerância por canal) e imagem das diferenças. */
async function diff(browser: Browser, a: Buffer, b: Buffer): Promise<{ ratio: number; png: Buffer; heights: [number, number] }> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const r = await p.evaluate(
    async ([x, y]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const draw = (i: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        if (!g) throw new Error('canvas');
        g.drawImage(i, 0, 0);
        return g.getImageData(0, 0, w, h);
      };
      const da = draw(ia);
      const db = draw(ib);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const og = out.getContext('2d');
      if (!og) throw new Error('canvas');
      const od = og.createImageData(w, h);
      let bad = 0;
      for (let k = 0; k < da.data.length; k += 4) {
        const d = Math.max(Math.abs((da.data[k] ?? 0) - (db.data[k] ?? 0)), Math.abs((da.data[k + 1] ?? 0) - (db.data[k + 1] ?? 0)), Math.abs((da.data[k + 2] ?? 0) - (db.data[k + 2] ?? 0)));
        const g = Math.round(((da.data[k] ?? 0) + (da.data[k + 1] ?? 0) + (da.data[k + 2] ?? 0)) / 3);
        if (d > 40) {
          bad += 1;
          od.data.set([255, 0, 0, 255], k);
        } else od.data.set([g, g, g, 90], k);
      }
      og.putImageData(od, 0, 0);
      return { ratio: bad / (w * h), png: out.toDataURL('image/png'), heights: [ia.height, ib.height] as [number, number] };
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`] as const,
  );
  await ctx.close();
  return { ratio: r.ratio, png: Buffer.from(r.png.split(',')[1] ?? '', 'base64'), heights: r.heights };
}

test('comparação com o original isolado: computador, tablet e telemóvel', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const files = await originalFiles();

  // Pré-visualização do Bolt (com a rede real para as folhas externas).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/importar');
  await page.getByTestId('import-file').setInputFiles(ZIP);
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 60_000 });
  const bolt = (await page.getByTestId('import-preview').getAttribute('srcdoc')) ?? '';
  // Mapa DENTRO da pré-visualização isolada da importação (sandbox, origem opaca).
  await page.frameLocator('[data-testid="import-preview"]').locator('.map').scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const lens = await Promise.all(page.frames().filter((f) => /google\.com\/maps\/embed/.test(f.url())).map((f) => f.evaluate(() => document.body?.innerHTML.length ?? 0).catch(() => 0)));
      return Math.max(0, ...lens);
    }, { timeout: 30_000 })
    .toBeGreaterThan(10_000);
  await page.getByTestId('import-preview').screenshot({ path: info.outputPath('importacao-preview-mapa.png') });
  const report = await page.getByTestId('import-items').innerText();

  const summary: Record<string, unknown> = { report };
  for (const [label, width, height] of SIZES) {
    // Original: ficheiros do arquivo servidos sem alterações, JavaScript desligado.
    const octx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: false });
    const op = await octx.newPage();
    await op.route('http://original.test/**', (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1)) || 'index.html';
      const body = files.get(path);
      return body ? route.fulfill({ status: 200, body, contentType: MIME[path.split('.').pop() ?? ''] ?? 'application/octet-stream' }) : route.fulfill({ status: 404, body: '' });
    });
    await op.goto('http://original.test/index.html', { waitUntil: 'networkidle', timeout: 120_000 });
    await settle(op);
    const orig = await op.screenshot({ fullPage: true });
    const origGeo = await geometry(op);
    const origMap = await mapState(op);
    await octx.close();

    const bctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const bp = await bctx.newPage();
    await bp.setContent(bolt, { waitUntil: 'networkidle', timeout: 120_000 });
    await settle(bp);
    const mine = await bp.screenshot({ fullPage: true });
    const boltGeo = await geometry(bp);
    const boltMap = await mapState(bp);
    await bp.locator('.map').screenshot({ path: info.outputPath(`${label}-bolt-mapa.png`) });
    await bp.evaluate(() => window.scrollTo(0, 0));
    await bp.waitForTimeout(300);
    // Menu aberto (só no Bolt: no original sem JavaScript o menu não abre).
    await bp.locator('.menu-toggle').click();
    await bp.waitForTimeout(600);
    const menu = await bp.screenshot();
    await bctx.close();

    const d = await diff(browser, orig, mine);
    writeFileSync(info.outputPath(`${label}-original.png`), orig);
    writeFileSync(info.outputPath(`${label}-bolt.png`), mine);
    writeFileSync(info.outputPath(`${label}-diferencas.png`), d.png);
    writeFileSync(info.outputPath(`${label}-bolt-menu-aberto.png`), menu);
    const deltas: Record<string, number> = {};
    for (const s of PROBES) {
      const a = origGeo[s] ?? [];
      const b = boltGeo[s] ?? [];
      deltas[s] = a.length !== b.length ? -1 : Math.max(0, ...a.flatMap((r, i) => r.map((v, j) => Math.abs(v - (b[i]?.[j] ?? 0)))));
    }
    summary[label] = { pixelsDiferentes: `${(d.ratio * 100).toFixed(2)}%`, alturas: { original: d.heights[0], bolt: d.heights[1] }, maiorDesvioPx: deltas, mapa: { original: origMap, bolt: boltMap } };
    info.annotations.push({ type: label, description: JSON.stringify(summary[label]) });
  }
  writeFileSync(info.outputPath('resumo.json'), JSON.stringify(summary, null, 2));

  // Capturas da importação: relatório (com fontes abertas) e editor depois de confirmar.
  await page.getByText(/^Fontes \(/).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('importacao-relatorio.png'), fullPage: true });
  await page.getByTestId('import-accept-partial').check();
  await page.getByTestId('import-confirm').click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const c = page.frameLocator('.gjs-frame');
  await expect(c.locator('h1')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: info.outputPath('importacao-editor.png') });
  await c.locator('.map').scrollIntoViewIfNeeded();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: info.outputPath('importacao-editor-mapa.png') });
});
