import studioText from '../../amostra/projeto-teste-2026-09-16-091529.grapesjs?raw';
import elementorText from '../../amostra/[Modelo] [Elementor] Carla Santos.json?raw';
import { describe, expect, it } from 'vitest';
import { renderProjectHtml } from '../../src/engine/createBoltEditor';
import { findComponentsWithoutId, type GrapesProjectData } from '../../src/contract/boltDocument';
import { analyzeImport, completeImport, detectFormat, type Dependencies } from '../../src/importers/pipeline';
import type { AssetStore } from '../../src/assets/assetStore';

/**
 * Importação com as duas amostras fornecidas (lidas, nunca alteradas) e com documentos
 * sintéticos. As verificações são estruturais: contagens por tipo face ao ficheiro de origem,
 * nunca textos ou ids específicos das amostras.
 */
const STUDIO = 'projeto-teste-2026-09-16-091529.grapesjs';
const ELEMENTOR = '[Modelo] [Elementor] Carla Santos.json';
const SAMPLES: Record<string, string> = { [STUDIO]: studioText, [ELEMENTOR]: elementorText };
const readSample = (name: string): string => must(SAMPLES[name], name);
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Em falta: ${what}`);
  return value;
}

const fileOf = (path: string) => {
  const text = readSample(path);
  return { name: path, type: 'application/json', size: text.length, text: async () => text };
};
const memFile = (name: string, content: unknown) => {
  const text = JSON.stringify(content);
  return { name, type: 'application/json', size: text.length, text: async () => text };
};

/** Sem rede: nada é copiável; o que «carrega» é decidido por `visible`. */
const offline = (visible: (url: string) => boolean = () => false): Dependencies => ({
  fetch: async () => {
    throw new TypeError('Failed to fetch');
  },
  probeImage: async (url) => visible(url),
});

type Node = { type?: string; tagName?: string; attributes?: Record<string, unknown>; components?: Node[] };
const countTypes = (root: Node, out: Record<string, number> = {}): Record<string, number> => {
  const t = root.type ?? 'default';
  out[t] = (out[t] ?? 0) + 1;
  (Array.isArray(root.components) ? root.components : []).forEach((c) => countTypes(c, out));
  return out;
};
const nodes = (root: Node, pred: (n: Node) => boolean, out: Node[] = []): Node[] => {
  if (pred(root)) out.push(root);
  (Array.isArray(root.components) ? root.components : []).forEach((c) => nodes(c, pred, out));
  return out;
};
const rootOf = (d: GrapesProjectData): Node => d.pages[0]?.frames[0]?.component as Node;
const source = (path: string): { pages: Array<{ frames: Array<{ component: Node }> }>; styles: unknown[]; dataSources?: unknown[] } => JSON.parse(readSample(path));

describe('Deteção do formato pelo conteúdo', () => {
  it('reconhece as duas amostras e recusa formatos não implementados sem os anunciar', () => {
    expect(detectFormat(readSample(STUDIO)).format).toBe('grapesjs');
    expect(detectFormat(readSample(ELEMENTOR)).format).toBe('elementor');
    expect(detectFormat('<html><body></body></html>').format).toBe('html');
    expect(detectFormat('PK\u0003\u0004…').format).toBe('zip');
    expect(detectFormat('{"a":1}').format).toBe('unknown');
  });

  it('HTML avulso é importado como página (a importação de sites estáticos tem testes próprios)', async () => {
    const a = await analyzeImport({ name: 'x.html', type: 'text/html', size: 10, text: async () => '<p>olá</p>' }, offline());
    expect(a.report.format).toBe('html');
    expect(a.projectData.pages).toHaveLength(1);
  });

  it('conteúdo não reconhecido dá erro claro com os formatos disponíveis', async () => {
    await expect(analyzeImport({ name: 'x.json', type: 'application/json', size: 7, text: async () => '{"a":1}' }, offline())).rejects.toThrow(/Formato não reconhecido.*ZIP de site estático/);
  });
});

describe('GrapesJS Studio', () => {
  it('converte os tipos do Studio preservando hierarquia, classes, níveis de título e ligações', async () => {
    const src = source(STUDIO);
    const before = countTypes(must(src.pages[0]?.frames[0], 'frame').component);
    const a = await analyzeImport(fileOf(STUDIO), offline());
    const root = rootOf(a.projectData);
    const after = countTypes(root);

    for (const studioOnly of ['heading', 'section', 'container', 'flex-row', 'flex-column', 'linkBox', 'icon', 'navbar', 'swiper', 'swiper-slide', 'input']) {
      expect(after[studioOnly] ?? 0).toBe(0);
    }
    expect(after['bolt-section']).toBe(before.section);
    expect(after['bolt-link-box']).toBe(before.linkBox);
    expect(after['bolt-row']).toBe(before['flex-row']);
    expect(after['bolt-col']).toBe(before['flex-column']);
    expect(after['bolt-carousel']).toBe(before.swiper);
    expect(after['bolt-slide']).toBe(before['swiper-slide']);
    expect(after['bolt-menu']).toBe(before.navbar);
    expect(after['bolt-input']).toBe(before.input);
    expect(findComponentsWithoutId(a.projectData)).toEqual([]);

    // Títulos: os que têm nível mantêm-no; os que não têm ficam h1 e são reportados como ambíguos.
    const headings = nodes(must(src.pages[0]?.frames[0], 'frame').component, (n) => n.type === 'heading');
    const html = renderProjectHtml(a.projectData).html;
    for (const tag of ['h2', 'h4', 'h5', 'h6']) {
      const expected = headings.filter((h) => h.tagName === tag).length;
      expect((html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length).toBe(expected);
    }
    const untagged = headings.filter((h) => !h.tagName).length;
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(untagged);
    expect(a.report.notes.join(' ')).toMatch(new RegExp(`${untagged} título\\(s\\) sem nível`));

    // Semântica: secções e blocos de ligação com os elementos certos; nenhum <div href>.
    expect((html.match(/<section[\s>]/g) ?? []).length).toBe(before.section);
    expect(html).not.toMatch(/<div[^>]*\shref=/);
    expect((html.match(/<a\s/g) ?? []).length).toBe((before.link ?? 0) + (before.linkBox ?? 0));
  });

  it('carrosséis funcionais com a configuração do Studio e menu móvel no breakpoint original', async () => {
    const a = await analyzeImport(fileOf(STUDIO), offline());
    const root = rootOf(a.projectData);
    const carousels = nodes(root, (n) => n.type === 'bolt-carousel');
    for (const c of carousels) {
      const cfg = JSON.parse(String(c.attributes?.['data-bolt-carousel']));
      expect(cfg.breakpoints[0]).toMatchObject({ min: 0 });
      expect(nodes(c, (n) => n.type === 'bolt-carousel-track')).toHaveLength(1);
    }
    const withBreakpoints = carousels.map((c) => JSON.parse(String(c.attributes?.['data-bolt-carousel'])).breakpoints.map((b: { min: number; perView: number }) => `${b.min}:${b.perView}`).join(','));
    expect(withBreakpoints).toContain('0:1,460:2,991:3');
    const menu = nodes(root, (n) => n.type === 'bolt-menu')[0];
    const m = must(menu, 'menu');
    expect(nodes(m, (n) => n.type === 'bolt-menu-toggle')).toHaveLength(1);
    const items = must(nodes(m, (n) => n.type === 'bolt-menu-items')[0], 'itens do menu');
    const rule = (a.projectData.styles as Array<{ selectorsAdd?: string; mediaText?: string }>).find((s) => s.selectorsAdd?.includes('[data-bolt-menu-open]'));
    expect(rule?.selectorsAdd).toBe(`#${String(m.attributes?.id)}[data-bolt-menu-open] #${String(items.attributes?.id)}`);
    expect(rule?.mediaText).toBe('(max-width: 768px)');
  });

  it('fontes carregadas por @font-face, variáveis de tema e estilos preservados', async () => {
    const src = source(STUDIO);
    const a = await analyzeImport(fileOf(STUDIO), offline());
    const faces = (a.projectData.styles as Array<{ atRuleType?: string; style?: Record<string, string> }>).filter((s) => s.atRuleType === 'font-face');
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => /^url\(https:\/\/fonts\.gstatic\.com\//.test(f.style?.src ?? ''))).toBe(true);
    expect(new Set(faces.map((f) => f.style?.['font-family']))).toEqual(new Set(['"Poppins"', '"Barlow"']));
    expect(a.report.fonts.every((f) => f.status === 'carregada')).toBe(true);
    expect(a.projectData.dataSources).toHaveLength(src.dataSources?.length ?? 0);
    expect((a.projectData.styles ?? []).length).toBeGreaterThanOrEqual(src.styles.length);
    const css = renderProjectHtml(a.projectData).css;
    expect(css).toMatch(/--gjs-t-color-primary:#[0-9A-Fa-f]{6}/);
  });

  it('imagens: sem rede nada é copiado nem substituído; cada uma aparece no relatório', async () => {
    const a = await analyzeImport(fileOf(STUDIO), offline((u) => u.includes('cdn.grapesjs.com')));
    expect(a.report.assets.length).toBeGreaterThan(0);
    expect(a.report.assets.every((x) => x.status === 'externa')).toBe(true);
    const done = await completeImport(a, { mode: 'local', upload: async () => { throw new Error('não chamado'); }, resolve: async () => new Map() }, { copyImages: true });
    expect(JSON.stringify(done.projectData)).toContain('https://cdn.grapesjs.com/');
  });
});

describe('Elementor', () => {
  it('converte containers e widgets para componentes Bolt, com contagens iguais às da origem', async () => {
    const raw = JSON.parse(readSample(ELEMENTOR));
    const widgets: Record<string, number> = {};
    const walk = (el: { elType?: string; widgetType?: string; elements?: unknown[] }) => {
      if (el.elType === 'widget') widgets[el.widgetType ?? '?'] = (widgets[el.widgetType ?? '?'] ?? 0) + 1;
      (el.elements ?? []).forEach((c) => walk(c as typeof el));
    };
    raw.content.forEach(walk);
    const a = await analyzeImport(fileOf(ELEMENTOR), offline());
    const root = rootOf(a.projectData);
    const t = countTypes(root);
    expect(t['bolt-carousel']).toBe(widgets['image-carousel']);
    expect(t['bolt-list']).toBe(widgets['icon-list']);
    expect(t['bolt-accordion']).toBe(widgets['nested-accordion']);
    expect(t['bolt-button']).toBe(widgets.button);
    expect(findComponentsWithoutId(a.projectData)).toEqual([]);
    const html = renderProjectHtml(a.projectData).html;
    const headingTags = (html.match(/class="[^"]*elementor-heading-title/g) ?? []).length;
    expect(headingTags).toBe(widgets.heading);
    expect((html.match(/<details[\s>]/g) ?? []).length).toBeGreaterThan(0);
    expect(a.report.items.find((i) => i.source === 'html')?.status).toBe('parcial');
  });

  it('CSS personalizado: «selector» passa ao id do elemento e @keyframes são preservados', async () => {
    const a = await analyzeImport(fileOf(ELEMENTOR), offline());
    const styles = a.projectData.styles as Array<{ selectorsAdd?: string; atRuleType?: string; mediaText?: string }>;
    expect(styles.some((s) => s.atRuleType === 'keyframes')).toBe(true);
    expect(styles.some((s) => /#el-[0-9a-z]+ \.swiper-wrapper/.test(s.selectorsAdd ?? ''))).toBe(true);
    expect(styles.every((s) => !(s.selectorsAdd ?? '').includes('selector'))).toBe(true);
    // Carrossel contínuo (autoplay sem pausa, transição linear) reconhecido pelas definições.
    const carousels = nodes(rootOf(a.projectData), (n) => n.type === 'bolt-carousel').map((c) => JSON.parse(String(c.attributes?.['data-bolt-carousel'])));
    expect(carousels.some((c) => c.autoplay?.delay === 0 && c.easing === 'linear')).toBe(true);
  });

  it('imagens de domínio inexistente ficam «em falta» e fontes sem rede ficam «não carregada»', async () => {
    const a = await analyzeImport(fileOf(ELEMENTOR), offline());
    expect(a.report.assets.length).toBeGreaterThan(0);
    expect(a.report.assets.every((x) => x.status === 'em-falta')).toBe(true);
    expect(a.report.fonts.map((f) => [f.family, f.status])).toEqual([['Bricolage Grotesque', 'nao-carregada']]);
  });
});

describe('Segurança e cópia de imagens', () => {
  it('scripts, manipuladores on* e URLs javascript: nunca entram no documento', async () => {
    const hostile = {
      pages: [{ frames: [{ component: { type: 'wrapper', components: [
        { type: 'text', attributes: { onclick: 'alert(1)' }, content: 'x', script: 'alert(2)' },
        { tagName: 'script', content: 'alert(3)' },
        { type: 'link', attributes: { href: 'javascript:alert(4)' }, components: [{ type: 'textnode', content: 'y' }] },
      ] } }] }],
    };
    const a = await analyzeImport(memFile('hostil.json', hostile), offline());
    const text = JSON.stringify(a.projectData);
    expect(text).not.toMatch(/alert\(/);
    expect(a.report.removed.length).toBeGreaterThanOrEqual(3);

    const elementor = { version: '0.4', type: 'page', content: [{ id: 'a1', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p onmouseover="x()">Olá</p><script>y()</script><img src="javascript:z()">' }, elements: [] }] };
    const b = await analyzeImport(memFile('el.json', elementor), offline());
    expect(JSON.stringify(b.projectData)).not.toMatch(/onmouseover|<script|javascript:/);
  });

  it('imagens copiáveis são guardadas pelo destino e o documento passa a usar a referência durável', async () => {
    const doc = { pages: [{ frames: [{ component: { type: 'wrapper', components: [{ type: 'image', attributes: { src: 'https://exemplo.pt/a.png' } }] } }] }] };
    const deps: Dependencies = {
      fetch: async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }),
      probeImage: async () => true,
    };
    const a = await analyzeImport(memFile('p.json', doc), deps);
    expect(a.report.assets).toEqual([expect.objectContaining({ url: 'https://exemplo.pt/a.png', status: 'disponivel' })]);
    const store: AssetStore = { mode: 'server', upload: async () => ({ stored: 'bolt-asset:ws/library/1.png', display: 'https://signed', name: 'a.png' }), resolve: async () => new Map() };
    const kept = await completeImport(a, store, { copyImages: false });
    expect(kept.report.assets[0]).toMatchObject({ status: 'externa', reason: expect.stringMatching(/autorização/) });
    expect(JSON.stringify(kept.projectData)).toContain('https://exemplo.pt/a.png');
    const done = await completeImport(a, store, { copyImages: true });
    expect(done.report.assets[0]?.status).toBe('copiada');
    expect(JSON.stringify(done.projectData)).toContain('bolt-asset:ws/library/1.png');
    expect(JSON.stringify(done.projectData)).not.toContain('https://exemplo.pt/a.png');
  });
});
