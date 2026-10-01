import sampleZip from '../../amostra/startbootstrap-stylish-portfolio-gh-pages.zip?inline';
import type { Component } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import type { AssetStore } from '../../src/assets/assetStore';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { createBoltEditor, renderProjectHtml } from '../../src/engine/createBoltEditor';
import { duplicatePage } from '../../src/engine/pages';
import { analyzeImport, completeImport, reanalyzeSite, type Dependencies, type ImportFile } from '../../src/importers/pipeline';
import { analyzeScript } from '../../src/importers/static/behaviours';
import { resolveRef } from '../../src/importers/static/files';
import { readZip, ZipError } from '../../src/importers/static/zip';

/**
 * Importação de sites estáticos: a amostra real (ZIP do Start Bootstrap «Stylish Portfolio»,
 * lido e nunca alterado) e arquivos sintéticos para os casos-limite.
 */

// ---------------------------------------------------------------- utilitários de teste

const fromBase64 = (dataUrl: string): Uint8Array => {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const toBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
};

const binFile = (name: string, bytes: Uint8Array, type = 'application/octet-stream'): ImportFile => ({
  name,
  type,
  size: bytes.length,
  text: async () => new TextDecoder().decode(bytes),
  arrayBuffer: async () => toBuffer(bytes),
});
const textFile = (name: string, text: string, type = 'text/plain') => binFile(name, new TextEncoder().encode(text), type);

/** Escritor ZIP mínimo (método «store» ou «deflate»), só para os testes. */
const CRC = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(toBuffer(b)));
      controller.close();
    },
  });
  const stream = input.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
interface ZipItem {
  path: string;
  data: string | Uint8Array;
  deflate?: boolean;
  /** Tamanho declarado diferente do real (para testar arquivos mentirosos). */
  declaredSize?: number;
  flags?: number;
}
async function makeZip(items: ZipItem[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const it of items) {
    const raw = typeof it.data === 'string' ? enc.encode(it.data) : it.data;
    const body = it.deflate ? await deflate(raw) : raw;
    const name = enc.encode(it.path);
    const size = it.declaredSize ?? raw.length;
    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, (it.flags ?? 0) | 0x800, true);
    lv.setUint16(8, it.deflate ? 8 : 0, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, (it.flags ?? 0) | 0x800, true);
    cv.setUint16(10, it.deflate ? 8 : 0, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, items.length, true);
  ev.setUint16(10, items.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

/** PNG de 1×1 válido (só para os testes). */
const PNG = fromBase64('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

/**
 * Folhas externas simuladas (FIXTURES DE TESTE, não são os ficheiros reais dos fornecedores):
 * só o suficiente para verificar a inclusão no lugar certo e a conversão do Font Awesome.
 */
const REMOTE_CSS_FIXTURES: Record<string, string> = {
  'https://use.fontawesome.com/releases/v6.3.0/css/all.css': '/* fixture: font awesome */ .fa-bars:before{content:"\\f0c9"} @font-face{font-family:"Font Awesome 6 Free";src:url(../webfonts/fa-solid-900.woff2)}',
  'https://cdnjs.cloudflare.com/ajax/libs/simple-line-icons/2.5.5/css/simple-line-icons.min.css': '/* fixture: simple line icons */ @font-face{font-family:simple-line-icons;src:url(../fonts/Simple-Line-Icons.woff2)} .icon-pencil:before{content:"\\e05f"}',
  'https://fonts.googleapis.com/css?family=Source+Sans+Pro:300,400,700,300italic,400italic,700italic': '/* fixture: google fonts */ @font-face{font-family:"Source Sans Pro";src:url(https://fonts.gstatic.com/s/sourcesanspro/v1/x.woff2)}',
};

function depsWith(remote: Record<string, string> = REMOTE_CSS_FIXTURES) {
  const created: string[] = [];
  const revoked: string[] = [];
  const fetched: string[] = [];
  const deps: Dependencies = {
    fetch: async (input) => {
      const url = String(input);
      fetched.push(url);
      const css = remote[url];
      if (css === undefined) throw new TypeError('Failed to fetch');
      return new Response(css, { status: 200, headers: { 'content-type': 'text/css' } });
    },
    probeImage: async () => false,
    objectUrl: () => {
      const url = `blob:teste/${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
  };
  return { deps, created, revoked, fetched };
}

type Node = { type?: string; tagName?: string; content?: string; classes?: unknown[]; attributes?: Record<string, unknown>; components?: Node[] };
const all = (root: Node, out: Node[] = []): Node[] => {
  out.push(root);
  (root.components ?? []).forEach((c) => all(c, out));
  return out;
};
const pageRoot = (d: GrapesProjectData, i = 0): Node => d.pages[i]?.frames[0]?.component as Node;
const classesOf = (n: Node) => (n.classes ?? []).map((c) => (typeof c === 'string' ? c : (c as { name: string }).name));
const byClass = (root: Node, cls: string) => all(root).find((n) => classesOf(n).includes(cls));
const sheetOf = (root: Node) => all(root).find((n) => n.type === 'bolt-stylesheet');

const sample = () => binFile('startbootstrap-stylish-portfolio-gh-pages.zip', fromBase64(sampleZip), 'application/zip');

// ---------------------------------------------------------------- amostra real

describe('ZIP real: Start Bootstrap «Stylish Portfolio»', () => {
  it('lê o arquivo, retira a pasta exterior e encontra uma página', async () => {
    const { deps } = depsWith();
    const a = await analyzeImport(sample(), deps);
    expect(a.report.format).toBe('zip');
    expect(a.site?.candidates.map((c) => c.path)).toEqual(['index.html']);
    expect(a.site?.home).toBe('index.html');
    expect(a.report.notes.join(' ')).toMatch(/Pasta exterior «startbootstrap-stylish-portfolio-gh-pages\/»/);
    expect(a.projectData.pages).toHaveLength(1);
    expect(a.suggestedName).toBe('Stylish Portfolio - Start Bootstrap Template');
  });

  it('as seis imagens locais (2 fundos no CSS, 4 do portfólio) ficam disponíveis com o caminho do arquivo', async () => {
    const { deps } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const local = a.report.assets.filter((x) => x.local);
    expect(local.map((x) => x.local).sort()).toEqual(['assets/img/bg-callout.jpg', 'assets/img/bg-masthead.jpg', 'assets/img/portfolio-1.jpg', 'assets/img/portfolio-2.jpg', 'assets/img/portfolio-3.jpg', 'assets/img/portfolio-4.jpg']);
    expect(local.every((x) => x.status === 'disponivel')).toBe(true);
    const root = pageRoot(a.projectData);
    const sheet = sheetOf(root)?.content ?? '';
    // Fundos: resolvidos a partir de css/ («../assets/img/…»), já com o URL temporário.
    const masthead = local.find((x) => x.local === 'assets/img/bg-masthead.jpg')?.url ?? '?';
    const callout = local.find((x) => x.local === 'assets/img/bg-callout.jpg')?.url ?? '?';
    expect(sheet).toContain(`url("${masthead}")`);
    expect(sheet).toContain(`url("${callout}")`);
    expect(sheet).not.toContain('../assets/img/');
    const imgs = all(root).filter((n) => n.type === 'image');
    expect(imgs).toHaveLength(4);
    for (const img of imgs) expect(String(img.attributes?.src)).toMatch(/^blob:teste\//);
  });

  it('o CSS fica literal, pela ordem do documento, sem outro Bootstrap e com os avisos de licença', async () => {
    const { deps, fetched } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const sheet = sheetOf(pageRoot(a.projectData))?.content ?? '';
    const order = [
      'origem: https://use.fontawesome.com/releases/v6.3.0/css/all.css',
      'origem: https://cdnjs.cloudflare.com/ajax/libs/simple-line-icons/2.5.5/css/simple-line-icons.min.css',
      'origem: https://fonts.googleapis.com/css?family=Source+Sans+Pro',
      'origem: css/styles.css',
    ].map((m) => sheet.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // Bootstrap: o que vem no arquivo (5.2.3, dentro de styles.css), uma única vez.
    expect(sheet.match(/Bootstrap {2}v5\.2\.3/g)?.length).toBe(1);
    expect(fetched.some((u) => /bootstrap/i.test(u))).toBe(false);
    // Variáveis, media queries mobile-first e estados intactos.
    expect(sheet).toContain('--bs-primary');
    expect(sheet).toMatch(/@media \(min-width: 768px\)/);
    expect(sheet).toContain('.menu-toggle:hover');
    expect(sheet).toContain('#sidebar-wrapper.active');
    // URLs relativos do CSS remoto passam a absolutos.
    expect(sheet).toContain('url("https://use.fontawesome.com/releases/v6.3.0/webfonts/fa-solid-900.woff2")');
    expect(sheet).toContain('url("https://cdnjs.cloudflare.com/ajax/libs/simple-line-icons/2.5.5/fonts/Simple-Line-Icons.woff2")');
    // Avisos de autoria e licença (CSS e do script removido) no início da folha.
    expect(sheet.startsWith('/*! Avisos de autoria e licença')).toBe(true);
    expect(sheet).toContain('Start Bootstrap - Stylish Portfolio v6.0.6');
    expect(sheet).toMatch(/Licensed under MIT/);
  });

  it('menu lateral e «voltar ao topo» passam para o runtime do Bolt; nenhum script fica no documento', async () => {
    const { deps } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const root = pageRoot(a.projectData);
    expect(root.attributes?.id).toBe('page-top');
    const toggle = byClass(root, 'menu-toggle');
    expect(toggle?.attributes).toMatchObject({
      'data-bolt-toggle': '#sidebar-wrapper',
      'data-bolt-toggle-class': 'active',
      'data-bolt-toggle-self': 'active',
      'data-bolt-toggle-swap': 'fa-bars fa-xmark',
    });
    expect(byClass(root, 'scroll-to-top')?.attributes).toMatchObject({ 'data-bolt-show-after': '100', 'data-bolt-show-effect': 'fade', href: '#page-top' });
    for (const id of ['sidebar-wrapper', 'about', 'services', 'portfolio', 'contact']) expect(all(root).some((n) => n.attributes?.id === id)).toBe(true);
    const { html } = renderProjectHtml(a.projectData);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<style data-bolt-type="stylesheet"');
    const items = a.report.items.map((i) => `${i.status}|${i.source}|${i.target}`).join('\n');
    expect(items).toMatch(/convertido\|Clique em \.menu-toggle \(js\/scripts\.js\)\|Abrir\/fechar pelo runtime do Bolt/);
    expect(items).toMatch(/convertido\|Ao rolar: \.scroll-to-top \(js\/scripts\.js\)\|Mostrar depois de rolar/);
    // O ouvinte de «.js-scroll-trigger» não tem elementos na página: dito explicitamente.
    expect(items).toMatch(/convertido\|Evento «click» em #sidebar-wrapper \.js-scroll-trigger\|Removido \(sem efeito nesta página\)/);
    expect(items).toMatch(/convertido\|Font Awesome v6\.3\.0 \(JavaScript\)\|Folha CSS oficial/);
    expect(items).toMatch(/convertido\|Script externo: Bootstrap \(JavaScript\)\|Removido/);
    expect(a.report.notes.join(' ')).toMatch(/não usa componentes ativados por data-bs-\*/);
    expect(a.report.removed.join(' ')).toMatch(/script js\/scripts\.js \(não executado\)/);
  });

  it('o mapa do Google é mantido como mapa incorporado (https) e o favicon é indicado como não suportado', async () => {
    const { deps } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const root = pageRoot(a.projectData);
    const map = all(root).find((n) => n.type === 'map');
    expect(String(map?.attributes?.src)).toMatch(/^https:\/\/maps\.google\.com\/maps\?.*output=embed/);
    expect(map?.attributes?.loading).toBe('lazy');
    const items = a.report.items.map((i) => `${i.status}|${i.source}`);
    expect(items).toContain('convertido|iframe do Google Maps');
    expect(items).toContain('nao-suportado|Ícone do separador (favicon)');
  });

  it('confirmar copia as imagens locais (mesmo sem a autorização das remotas) e não deixa URLs temporários', async () => {
    const { deps, created, revoked } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const uploads: string[] = [];
    const store: AssetStore = {
      mode: 'server',
      upload: async (f) => {
        uploads.push(f.name);
        return { stored: `bolt-asset:ws/library/${f.name}`, display: `https://exemplo.invalid/${f.name}`, name: f.name };
      },
      resolve: async () => new Map(),
    };
    const done = await completeImport(a, store, { copyImages: false });
    expect(uploads.sort()).toEqual(['bg-callout.jpg', 'bg-masthead.jpg', 'portfolio-1.jpg', 'portfolio-2.jpg', 'portfolio-3.jpg', 'portfolio-4.jpg']);
    const json = JSON.stringify(done.projectData);
    expect(json).not.toContain('blob:teste');
    expect(json).toContain('url(\\"bolt-asset:ws/library/bg-masthead.jpg\\")');
    expect(done.report.assets.filter((x) => x.local).every((x) => x.status === 'copiada')).toBe(true);
    a.release();
    expect(revoked.sort()).toEqual([...created].sort());
  });

  it('sem rede: as folhas externas ficam como @import e o Font Awesome é indicado como não convertido', async () => {
    const { deps } = depsWith({});
    const a = await analyzeImport(sample(), deps);
    const sheet = sheetOf(pageRoot(a.projectData))?.content ?? '';
    expect(sheet).toContain('@import url("https://cdnjs.cloudflare.com/ajax/libs/simple-line-icons/2.5.5/css/simple-line-icons.min.css");');
    const items = a.report.items.map((i) => `${i.status}|${i.source}|${i.target}`);
    expect(items.some((i) => i.startsWith('parcial|Folha externa cdnjs.cloudflare.com|Mantida como @import'))).toBe(true);
    expect(items.some((i) => i.startsWith('nao-suportado|Font Awesome v6.3.0 (JavaScript)'))).toBe(true);
  });
});

// ---------------------------------------------------------------- reconhecimento de scripts

describe('Comportamentos lidos dos scripts (nunca executados)', () => {
  it('um script desconhecido não é declarado equivalente', () => {
    const r = analyzeScript("document.querySelector('.x').addEventListener('mouseenter', () => { fetch('/a'); });", 'a.js');
    expect(r.behaviours).toEqual([]);
    expect(r.listeners).toEqual([{ event: 'mouseenter', selector: '.x', recognized: false, detail: 'comportamento não reconhecido' }]);
  });
});

// ---------------------------------------------------------------- sites sintéticos

const page = (title: string, body: string, head = '') => `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

describe('Sites sintéticos', () => {
  it('várias páginas: escolha por omissão, ligações /slug, ids repetidos renomeados com CSS e âncoras', async () => {
    const zip = await makeZip([
      { path: 'site/index.html', data: page('Início', '<header id="topo">A</header><a href="sobre.html#equipa">Equipa</a><a href="sobre.html">Sobre</a><a href="#topo">Topo</a>', '<link rel="stylesheet" href="css/a.css">') },
      { path: 'site/sobre.html', data: page('Sobre', '<header id="topo">B</header><section id="equipa"><a href="#topo">Topo</a></section><a href="index.html">Início</a>', '<link rel="stylesheet" href="css/a.css">'), deflate: true },
      { path: 'site/examples/demo.html', data: page('Demo', '<p>demo</p>') },
      { path: 'site/parcial.html', data: '<div>fragmento</div>' },
      { path: 'site/css/a.css', data: '#topo{color:#add}\n#topo .x{margin:0}' },
    ]);
    const { deps } = depsWith();
    const a = await analyzeImport(binFile('site.zip', zip), deps);
    const aux = Object.fromEntries((a.site?.candidates ?? []).map((c) => [c.path, c.auxiliary]));
    expect(aux['index.html']).toBeNull();
    expect(aux['sobre.html']).toBeNull();
    expect(aux['examples/demo.html']).toMatch(/exemplos/);
    expect(aux['parcial.html']).toMatch(/fragmento/);
    expect(a.site?.pages).toEqual(['index.html', 'sobre.html']);
    expect(a.projectData.pages.map((p) => [p.slug, p.type ?? ''])).toEqual([['inicio', 'main'], ['sobre', '']]);
    const home = pageRoot(a.projectData, 0);
    const about = pageRoot(a.projectData, 1);
    const hrefs = (r: Node) => all(r).filter((n) => n.type === 'link').map((n) => n.attributes?.href);
    expect(hrefs(home)).toEqual(['/sobre#equipa', '/sobre', '#topo']);
    // Na segunda página, «topo» colide com a primeira: id, âncora e seletores CSS renomeados.
    expect(all(about).some((n) => n.attributes?.id === 'topo-sobre')).toBe(true);
    expect(hrefs(about)).toEqual(['#topo-sobre', '/inicio']);
    expect(sheetOf(about)?.content).toContain('#topo-sobre{color:#add}');
    expect(sheetOf(about)?.content).toContain('#topo-sobre .x');
    // A cor #add (valor, não seletor) não é tocada; a página inicial mantém os nomes originais.
    expect(sheetOf(home)?.content).toContain('#topo{color:#add}');
    // Escolher outra página inicial e incluir a página de exemplo.
    const b = await reanalyzeSite(a, deps, { site: { pages: ['index.html', 'sobre.html', 'examples/demo.html'], home: 'sobre.html' } });
    expect(b.projectData.pages.map((p) => p.slug)).toEqual(['inicio', 'examples-demo', 'index']);
    expect(b.projectData.pages[0]?.name).toBe('Sobre');
  });

  it('@import e url() resolvidos a partir do ficheiro que os refere; srcset; fontes locais embutidas', async () => {
    const zip = await makeZip([
      { path: 'index.html', data: page('X', '<img src="img/a.png" srcset="img/a.png 1x, img/b.png 2x" alt="a"><div style="background:url(img/b.png)">x</div>', '<link rel="stylesheet" href="css/main.css">') },
      { path: 'css/main.css', data: '@import "parts/base.css" screen;\n.after{color:red}' },
      { path: 'css/parts/base.css', data: '@font-face{font-family:Local;src:url(../../fonts/l.woff2) format("woff2")}\n.bg{background:url("../../img/a.png")}' },
      { path: 'fonts/l.woff2', data: new Uint8Array([1, 2, 3, 4]) },
      { path: 'img/a.png', data: PNG },
      { path: 'img/b.png', data: PNG },
    ]);
    const { deps } = depsWith();
    const a = await analyzeImport(binFile('s.zip', zip), deps);
    const sheet = sheetOf(pageRoot(a.projectData))?.content ?? '';
    const urlOf = (p: string) => a.report.assets.find((x) => x.local === p)?.url ?? '?';
    expect(sheet).toMatch(/@media screen \{\s*\/\* origem: css\/parts\/base\.css \*\//);
    expect(sheet.indexOf('origem: css/parts/base.css')).toBeLessThan(sheet.indexOf('.after{color:red}'));
    expect(sheet).toContain(`url("${urlOf('img/a.png')}")`);
    expect(sheet).toContain('url("data:font/woff2;base64,AQIDBA==") format("woff2")');
    const img = all(pageRoot(a.projectData)).find((n) => n.type === 'image');
    expect(img?.attributes?.srcset).toBe(`${urlOf('img/a.png')} 1x, ${urlOf('img/b.png')} 2x`);
    // O estilo no elemento passa pelo motor (regra própria) com o endereço já resolvido.
    expect(JSON.stringify(a.projectData.styles)).toContain(urlOf('img/b.png'));
  });

  it('HTML avulso: indica exatamente o que falta e aceita os ficheiros acrescentados depois', async () => {
    const html = textFile('pagina.html', page('Avulsa', '<img src="img/foto.png" alt="f"><p class="t">Olá</p>', '<link rel="stylesheet" href="css/estilo.css">'), 'text/html');
    const { deps } = depsWith();
    const a = await analyzeImport(html, deps);
    expect(a.report.format).toBe('html');
    expect(a.report.missingFiles?.map((m) => [m.path, m.kind, m.from])).toEqual([
      ['css/estilo.css', 'css', ['pagina.html']],
      ['img/foto.png', 'imagem', ['pagina.html']],
    ]);
    expect(a.report.assets.find((x) => x.local === 'img/foto.png')?.status).toBe('em-falta');
    // Ficheiros escolhidos depois, sem pastas: associados pelo nome.
    const b = await reanalyzeSite(a, deps, { extraFiles: [textFile('estilo.css', '.t{color:green}'), binFile('foto.png', PNG, 'image/png')] });
    expect(b.report.missingFiles).toEqual([]);
    expect(sheetOf(pageRoot(b.projectData))?.content).toContain('.t{color:green}');
    expect(b.report.assets.find((x) => x.local === 'foto.png')?.status).toBe('disponivel');
  });

  it('conteúdo ativo removido e indicado; iframes que não são mapas não entram', async () => {
    const zip = await makeZip([
      {
        path: 'index.html',
        data: page('X', '<a href="javascript:alert(1)" onclick="x()">a</a><iframe src="https://evil.example/x"></iframe><img src="x.png" onerror="y()"><script>alert(2)</script>', '<script src="https://cdn.example/lib.js"></script>'),
      },
    ]);
    const { deps } = depsWith();
    const a = await analyzeImport(binFile('s.zip', zip), deps);
    const { html } = renderProjectHtml(a.projectData);
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:|<iframe/i);
    const items = a.report.items.map((i) => `${i.status}|${i.source}`);
    expect(items).toContain('nao-suportado|iframe evil.example');
    expect(items).toContain('nao-suportado|Script externo: Script');
    expect(a.report.removed.join(' ')).toMatch(/onclick/);
    expect(a.report.missingFiles?.map((m) => m.path)).toEqual(['x.png']);
  });
});

// ---------------------------------------------------------------- limites do arquivo

describe('Limites e caminhos do ZIP', () => {
  it('caminhos inválidos são ignorados com o motivo; ficheiros cifrados também', async () => {
    const zip = await makeZip([
      { path: 'index.html', data: page('X', '<p>a</p>') },
      { path: '../fora.txt', data: 'x' },
      { path: '/abs.txt', data: 'x' },
      { path: 'C:/win.txt', data: 'x' },
      { path: 'segredo.txt', data: 'x', flags: 1 },
    ]);
    const z = readZip(zip);
    expect(z.entries.map((e) => e.path)).toEqual(['index.html']);
    expect(z.skipped.map((s) => s.reason)).toEqual(['caminho com «..» (sairia da pasta do site)', 'caminho absoluto', 'caminho absoluto', 'ficheiro cifrado (com palavra-passe)']);
  });

  it('demasiadas entradas, tamanho total e arquivos que mentem sobre o tamanho', async () => {
    const zip = await makeZip([
      { path: 'a.txt', data: 'a'.repeat(100) },
      { path: 'b.txt', data: 'b'.repeat(100) },
    ]);
    expect(() => readZip(zip, { maxArchiveBytes: 1e6, maxEntries: 1, maxFileBytes: 1e6, maxTotalBytes: 1e6 })).toThrow(/2 entradas; o máximo é 1/);
    expect(() => readZip(zip, { maxArchiveBytes: 10, maxEntries: 10, maxFileBytes: 1e6, maxTotalBytes: 1e6 })).toThrow(ZipError);
    expect(() => readZip(zip, { maxArchiveBytes: 1e6, maxEntries: 10, maxFileBytes: 1e6, maxTotalBytes: 150 })).toThrow(/passa de/);
    const liar = await makeZip([{ path: 'bomba.txt', data: 'z'.repeat(50000), deflate: true, declaredSize: 10 }]);
    const z = readZip(liar);
    const entry = z.entries[0];
    if (!entry) throw new Error('sem entrada');
    await expect(z.read(entry)).rejects.toThrow(/mais do que o tamanho declarado/);
  });

  it('não é um ZIP / ZIP sem páginas', async () => {
    expect(() => readZip(new TextEncoder().encode('PK\u0003\u0004 truncado'))).toThrow(/incompleto ou danificado/);
    const { deps } = depsWith();
    await expect(analyzeImport(binFile('v.zip', await makeZip([{ path: 'x.css', data: 'a{}' }])), deps)).rejects.toThrow(/não tem páginas HTML/);
  });

  it('resolve caminhos relativos ao ficheiro que os refere', () => {
    expect(resolveRef('css/a.css', '../img/x.png')).toBe('img/x.png');
    expect(resolveRef('blog/post.html', 'img/x.png?v=2#a')).toBe('blog/img/x.png');
    expect(resolveRef('blog/post.html', '/img/x.png')).toBe('img/x.png');
    expect(resolveRef('a.html', '../../x.png')).toBeNull();
    expect(resolveRef('a.html', 'img/f%20g.png')).toBe('img/f g.png');
  });
});

describe('Duplicar uma página importada', () => {
  it('a cópia tem ids próprios e a folha literal, o menu e o «voltar ao topo» seguem-nos', async () => {
    const { deps } = depsWith();
    const a = await analyzeImport(sample(), deps);
    const editor = createBoltEditor({ projectData: a.projectData });
    try {
      const source = editor.Pages.getAll()[0];
      if (!source) throw new Error('sem página');
      const copy = duplicatePage(editor, source.getId());
      const root = copy.getMainComponent();
      const find = (pred: (c: Component) => boolean): Component | undefined => {
        const walk = (c: Component): Component | undefined => (pred(c) ? c : c.components().models.map(walk).find(Boolean));
        return walk(root);
      };
      const sidebar = find((c) => c.getClasses().length === 0 && c.get('tagName') === 'nav');
      const sidebarId = sidebar?.getId() ?? '';
      expect(sidebarId).not.toBe('sidebar-wrapper');
      expect(root.getAttributes().id).toBe('page-top-2');
      expect(find((c) => c.getClasses().includes('menu-toggle'))?.getAttributes()['data-bolt-toggle']).toBe(`#${sidebarId}`);
      expect(find((c) => c.getClasses().includes('scroll-to-top'))?.getAttributes().href).toBe('#page-top-2');
      const sheet = String(find((c) => c.get('type') === 'bolt-stylesheet')?.get('content') ?? '');
      expect(sheet).toContain(`#${sidebarId}.active`);
      expect(sheet).not.toContain('#sidebar-wrapper.active');
      // A página original não muda.
      const original = String(source.getMainComponent().components().models.find((c) => c.get('type') === 'bolt-stylesheet')?.get('content') ?? '');
      expect(original).toContain('#sidebar-wrapper.active');
      expect(source.getMainComponent().getAttributes().id).toBe('page-top');
    } finally {
      editor.destroy();
    }
  });
});
