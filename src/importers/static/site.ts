import postcss, { type AtRule } from 'postcss';
import { remapCssIds, remapSelectorIds } from '../../engine/cssText';
import { slugify } from '../../engine/pages';
import { isUnsafeUrl } from '../sanitize';
import { ReportBuilder, type AdapterResult, type AssetEntry, type FontEntry, type MissingFile, type RawProjectData } from '../types';
import { analyzeScript, applyBehaviour, bootstrapUses, convertBootstrapCollapse, type Behaviour, type ListenerFinding } from './behaviours';
import { fontAwesomeCssFor, hostOf, isAllowedMapEmbed, knownLicense, knownScript, secureMapSrc } from './externals';
import { baseName, extOf, getFile, isExternalRef, isHtmlPath, isNonFileRef, isTextPath, mimeOf, readText, resolveRef, splitRef, toBase64, type SiteFile, type SiteFiles } from './files';

/**
 * Importação de sites estáticos (ZIP ou HTML/CSS soltos).
 *
 * Decisões (ver docs/20):
 *  - O HTML do corpo passa a componentes editáveis do motor (o motor analisa o HTML já limpo).
 *  - O CSS do site fica LITERAL, numa folha por página (componente `bolt-stylesheet`), pela
 *    ordem original: a cascata, as media queries, as variáveis, os pseudo-elementos, os estados,
 *    `@supports` e `@font-face` mantêm-se exatamente. Cada página só tem a sua folha, por isso
 *    os estilos de uma página não alteram outra. As edições feitas no Bolt vão para regras
 *    próprias de cada elemento (`#id`), que têm prioridade sobre as classes da folha.
 *  - Scripts nunca são executados nem copiados. Os comportamentos reconhecidos passam para o
 *    runtime do Bolt; o resto fica no relatório.
 *  - Recursos locais: imagens → armazenamento do projeto na confirmação (antes disso, URLs
 *    temporários para a pré-visualização); fontes e SVG locais → embutidos no CSS (data:).
 */

export interface StaticDeps {
  fetch: typeof fetch;
  /** URL temporário de pré-visualização para um ficheiro local (revogado ao cancelar). */
  objectUrl: (blob: Blob) => string;
}

export interface PageCandidate {
  path: string;
  title: string;
  /** Motivo para NÃO ser página por omissão (exemplo, fragmento, auxiliar…), ou null. */
  auxiliary: string | null;
}

export interface StaticOptions {
  /** Caminhos das páginas a importar (omissão: as que não são auxiliares). */
  pages?: string[];
  /** Página inicial (omissão: index.html da raiz). */
  home?: string;
}

export interface LocalAsset {
  /** Endereço no documento enquanto a importação não é confirmada. */
  url: string;
  path: string;
  blob: Blob;
  usedBy: Set<string>;
}

export interface StaticResult extends AdapterResult {
  candidates: PageCandidate[];
  pages: string[];
  home: string;
  localAssets: LocalAsset[];
  /** Imagens remotas referidas no CSS (para a verificação de imagens do pipeline). */
  remoteImages: Map<string, Set<string>>;
  /** Registo do original (texto): manifesto com os ficheiros de texto e a lista dos binários. */
  manifest: string;
}

export const MAX_PAGES = 30;
const MAX_EMBED_FONT = 2 * 1024 * 1024;
const MAX_EMBED_FONTS_TOTAL = 8 * 1024 * 1024;
const MAX_EMBED_SMALL = 512 * 1024;
const MANIFEST_BUDGET = 4_500_000;

const AUX_FOLDERS = new Set(['node_modules', 'bower_components', 'vendor', 'vendors', 'examples', 'example', 'test', 'tests', '__tests__', 'partials', 'includes', 'snippets', '.github']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const FONT_EXT = new Set(['woff', 'woff2', 'ttf', 'otf', 'eot']);
const BLOCK_CHILDREN = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'picture', 'figure', 'ul', 'ol', 'section', 'article', 'header', 'footer', 'table', 'blockquote']);
const BLOCKED = new Set(['script', 'noscript', 'template', 'object', 'embed', 'applet', 'base', 'link', 'meta', 'frame', 'frameset', 'title', 'head']);

const decoder = (label: string) => {
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('utf-8');
  }
};

/** HTML com a codificação declarada (`<meta charset>`), UTF-8 por omissão. */
async function readHtml(file: SiteFile): Promise<string> {
  const bytes = await file.bytes();
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return decoder(m?.[1] ?? 'utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function auxiliaryReason(path: string, html: string): string | null {
  const parts = path.toLowerCase().split('/');
  const folder = parts.slice(0, -1).find((p) => AUX_FOLDERS.has(p));
  if (folder) return `pasta «${folder}» (exemplos, testes ou dependências)`;
  if (!/<body[\s>]/i.test(html) && !/<html[\s>]/i.test(html)) return 'fragmento de HTML (sem <html> nem <body>)';
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)) return 'redirecionamento automático';
  if (/^google[0-9a-f]+\.html$/i.test(parts[parts.length - 1] ?? '')) return 'ficheiro de verificação do Google';
  if (/^404\.html?$/i.test(parts[parts.length - 1] ?? '')) return 'página de erro 404';
  return null;
}

const titleOf = (html: string, path: string) => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return t ? decodeEntities(t) : baseName(path);
};

function decodeEntities(s: string): string {
  const d = new DOMParser().parseFromString(`<!doctype html><title>${s}</title>`, 'text/html');
  return d.title || s;
}

interface CssStats {
  rules: number;
  media: number;
  variables: number;
  pseudo: number;
  fontFaces: number;
  supports: number;
  keyframes: number;
}

function cssStats(css: string): CssStats {
  const s: CssStats = { rules: 0, media: 0, variables: 0, pseudo: 0, fontFaces: 0, supports: 0, keyframes: 0 };
  try {
    const root = postcss.parse(css);
    root.walkRules((r) => {
      s.rules += 1;
      if (/::?[a-z-]+/i.test(r.selector)) s.pseudo += 1;
    });
    root.walkDecls((d) => {
      if (d.prop.startsWith('--')) s.variables += 1;
    });
    root.walkAtRules((a) => {
      const n = a.name.toLowerCase();
      if (n === 'media') s.media += 1;
      else if (n === 'font-face') s.fontFaces += 1;
      else if (n === 'supports') s.supports += 1;
      else if (n.endsWith('keyframes')) s.keyframes += 1;
    });
  } catch {
    // CSS inválido: as estatísticas ficam a zero; o texto é mantido.
  }
  return s;
}

/** Estado partilhado de uma análise (recursos, cache de CSS, relatório). */
class Ctx {
  readonly report = new ReportBuilder();
  readonly assets = new Map<string, LocalAsset>(); // por caminho
  readonly missing = new Map<string, MissingFile>();
  readonly remoteImages = new Map<string, Set<string>>();
  readonly fonts = new Map<string, FontEntry>();
  readonly notices = new Set<string>();
  readonly localCss = new Map<string, Promise<string>>();
  readonly remoteCss = new Map<string, Promise<{ css: string } | { error: string }>>();
  readonly unfetchedCss = new Set<string>();
  readonly embedded = new Map<string, string>();
  embeddedFontBytes = 0;

  constructor(
    readonly site: SiteFiles,
    readonly deps: StaticDeps,
  ) {}

  miss(path: string | null, ref: string, from: string, kind: MissingFile['kind'], reason?: string): void {
    const key = `${path ?? ref}`;
    const row = this.missing.get(key);
    if (row) {
      if (!row.from.includes(from)) row.from.push(from);
      return;
    }
    this.missing.set(key, { path: path ?? ref, ref, from: [from], kind, ...(reason ? { reason } : {}) });
  }

  /** Endereço para um ficheiro local referido (imagem, fonte, SVG…). `null` = em falta. */
  async local(path: string | null, ref: string, from: string, usedBy: string): Promise<string | null> {
    const file = path ? getFile(this.site, path) : undefined;
    if (!path || !file) {
      this.miss(path, ref, from, IMAGE_EXT.has(extOf(ref)) ? 'imagem' : FONT_EXT.has(extOf(ref)) ? 'fonte' : 'recurso');
      return null;
    }
    const ext = extOf(file.path);
    if (IMAGE_EXT.has(ext)) {
      const known = this.assets.get(file.path);
      if (known) {
        known.usedBy.add(usedBy);
        return known.url;
      }
      const blob = new Blob([await copyBytes(file)], { type: mimeOf(file.path) });
      const asset: LocalAsset = { url: this.deps.objectUrl(blob), path: file.path, blob, usedBy: new Set([usedBy]) };
      this.assets.set(file.path, asset);
      return asset.url;
    }
    const cached = this.embedded.get(file.path);
    if (cached) return cached;
    if (FONT_EXT.has(ext)) {
      if (file.size > MAX_EMBED_FONT || this.embeddedFontBytes + file.size > MAX_EMBED_FONTS_TOTAL) {
        this.miss(file.path, ref, from, 'fonte', `fonte com ${Math.round(file.size / 1024)} KB: acima do limite para embutir no CSS (2 MB por fonte, 8 MB no total)`);
        return null;
      }
      this.embeddedFontBytes += file.size;
      this.report.add('convertido', `Fonte local (${ext})`, 'Embutida no CSS (data:)', 'Fica dentro do documento; não depende de ficheiros externos.');
    } else if (file.size > MAX_EMBED_SMALL) {
      this.miss(file.path, ref, from, 'recurso', `ficheiro «${ext}» com mais de 512 KB não é embutido`);
      return null;
    } else {
      this.report.add('convertido', `Ficheiro local .${ext}`, 'Embutido no documento (data:)', ext === 'svg' ? 'SVG usado como imagem (não executa scripts).' : '');
    }
    const url = `data:${mimeOf(file.path)};base64,${toBase64(await file.bytes())}`;
    this.embedded.set(file.path, url);
    return url;
  }
}

async function copyBytes(file: SiteFile): Promise<ArrayBuffer> {
  const bytes = await file.bytes();
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

const URL_IN_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;

/** Reescreve os `url()` de um valor CSS, resolvidos a partir do ficheiro que os contém. */
async function rewriteCssUrls(value: string, fromPath: string, ctx: Ctx, usedBy: string): Promise<string> {
  const matches = [...value.matchAll(URL_IN_CSS)];
  if (!matches.length) return value;
  let out = '';
  let last = 0;
  for (const m of matches) {
    const ref = m[1] ?? m[2] ?? m[3] ?? '';
    const at = m.index ?? 0;
    out += value.slice(last, at);
    last = at + m[0].length;
    if (isNonFileRef(ref) && !isExternalRef(ref)) {
      out += m[0];
      continue;
    }
    if (isExternalRef(ref)) {
      const abs = ref.startsWith('//') ? `https:${ref}` : ref;
      if (IMAGE_EXT.has(extOf(splitRef(abs).path)) || extOf(splitRef(abs).path) === 'svg') {
        const set = ctx.remoteImages.get(abs) ?? new Set<string>();
        set.add(usedBy);
        ctx.remoteImages.set(abs, set);
      }
      out += m[0];
      continue;
    }
    const resolved = resolveRef(fromPath, ref);
    const url = await ctx.local(resolved, ref, fromPath, usedBy);
    out += url ? `url("${url}")` : m[0];
  }
  return out + value.slice(last);
}

/** URLs relativos dentro de CSS remoto passam a absolutos (a folha deixa de estar no endereço original). */
function absolutizeRemoteCss(css: string, base: string): string {
  return css.replace(URL_IN_CSS, (whole, a: string | undefined, b: string | undefined, c: string | undefined) => {
    const ref = a ?? b ?? c ?? '';
    if (!ref || ref.startsWith('data:') || ref.startsWith('#')) return whole;
    try {
      return `url("${new URL(ref, base).href}")`;
    } catch {
      return whole;
    }
  });
}

function importTarget(rule: AtRule): { ref: string; media: string } | null {
  const m = /^\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*(.*)$/is.exec(rule.params);
  if (!m) return null;
  const ref = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
  return ref ? { ref, media: (m[6] ?? '').trim() } : null;
}

const wrapMedia = (css: string, media: string) => (media && media.toLowerCase() !== 'all' ? `@media ${media} {\n${css}\n}` : css);

/** Folha remota (CDN de ícones, Google Fonts…): obtida uma vez e incluída no lugar onde estava. */
async function remoteCss(url: string, ctx: Ctx, depth = 0): Promise<{ css: string } | { error: string }> {
  const abs = url.startsWith('//') ? `https:${url}` : url;
  let pending = ctx.remoteCss.get(abs);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await ctx.deps.fetch(abs, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) return { error: `o servidor respondeu ${res.status}` };
        let css = absolutizeRemoteCss(await res.text(), abs);
        if (depth < 3) css = await inlineImports(css, ctx, { remoteBase: abs, depth: depth + 1 });
        return { css };
      } catch (e) {
        return { error: `não foi possível obter a folha a partir do browser (${e instanceof Error ? e.message : String(e)}; normalmente falta de CORS ou de rede)` };
      }
    })();
    ctx.remoteCss.set(abs, pending);
  }
  const result = await pending;
  if ('css' in result) {
    for (const m of result.css.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*["']?([^;"'}]+)["']?/gi)) {
      const family = (m[1] ?? '').trim();
      if (family && !ctx.fonts.has(family)) {
        ctx.fonts.set(family, {
          family,
          source: `${hostOf(abs)} (externa)`,
          license: knownLicense(abs),
          status: 'carregada',
          detail: 'Os ficheiros da fonte continuam no servidor de origem; precisam de rede para aparecer.',
        });
      }
    }
  }
  return result;
}

/** Resolve os `@import` de uma folha: locais e remotos são incluídos no lugar (ordem preservada). */
async function inlineImports(css: string, ctx: Ctx, where: { localPath?: string; remoteBase?: string; depth: number; stack?: string[] }): Promise<string> {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  const imports: AtRule[] = [];
  root.each((node) => {
    if (node.type === 'atrule' && node.name.toLowerCase() === 'import') imports.push(node);
  });
  if (!imports.length) return css;
  const pieces: string[] = [];
  for (const [i, rule] of imports.entries()) {
    const target = importTarget(rule);
    let text: string | null = null;
    if (target) {
      if (isExternalRef(target.ref) || where.remoteBase) {
        const abs = where.remoteBase ? new URL(target.ref, where.remoteBase).href : target.ref;
        const r = await remoteCss(abs, ctx, where.depth);
        if ('css' in r) text = wrapMedia(`/* origem: ${abs} */\n${r.css}`, target.media);
        else {
          ctx.unfetchedCss.add(abs);
          ctx.report.add('parcial', `@import ${hostOf(abs)}`, 'Mantido como @import no início da folha', r.error);
        }
      } else if (where.localPath) {
        const path = resolveRef(where.localPath, target.ref);
        const stack = where.stack ?? [];
        if (path && stack.includes(path)) ctx.report.note(`@import circular ignorado: ${path}`);
        else {
          const child = path ? await localCss(path, target.ref, where.localPath, ctx, [...stack, where.localPath]) : null;
          if (child !== null) text = wrapMedia(`/* origem: ${path ?? target.ref} */\n${child}`, target.media);
        }
      }
    }
    pieces.push(text ?? rule.toString() + ';');
    rule.replaceWith(postcss.comment({ text: `__bolt_import_${i}__` }));
  }
  return root.toString().replace(/\/\*\s*__bolt_import_(\d+)__\s*\*\//g, (whole, n: string) => pieces[Number(n)] ?? whole);
}

/** Folha local: `url()` resolvidos a partir dela e `@import` incluídos (com cache por caminho). */
function localCss(path: string, ref: string, from: string, ctx: Ctx, stack: string[] = []): Promise<string | null> {
  const file = getFile(ctx.site, path);
  if (!file) {
    ctx.miss(path, ref, from, 'css');
    return Promise.resolve(null);
  }
  let pending = ctx.localCss.get(file.path);
  if (!pending) {
    pending = (async () => {
      const text = await readText(file);
      const rewritten = await rewriteDeclUrls(text, file.path, ctx);
      return inlineImports(rewritten, ctx, { localPath: file.path, depth: 0, stack });
    })();
    ctx.localCss.set(file.path, pending);
  }
  return pending;
}

/** `url()` nas declarações (incluindo `src` de @font-face), sem tocar no resto do texto. */
async function rewriteDeclUrls(css: string, fromPath: string, ctx: Ctx): Promise<string> {
  let root;
  try {
    root = postcss.parse(css);
  } catch (e) {
    ctx.report.add('parcial', `CSS ${fromPath}`, 'Mantido como está', `não foi possível analisar o CSS (${e instanceof Error ? e.message : String(e)})`);
    return rewriteCssUrls(css, fromPath, ctx, 'CSS');
  }
  const decls: Array<{ decl: { value: string } }> = [];
  root.walkDecls((decl) => {
    if (/url\(/i.test(decl.value)) decls.push({ decl });
  });
  for (const { decl } of decls) decl.value = await rewriteCssUrls(decl.value, fromPath, ctx, 'CSS (fundo/fonte)');
  return root.toString();
}

/** Atributos de URL a tratar em cada elemento. */
const SRCSET_ATTRS = ['srcset', 'data-srcset'];

async function rewriteSrcset(value: string, fromPath: string, ctx: Ctx, usedBy: string): Promise<string> {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const [ref = '', ...desc] = part.split(/\s+/);
    if (isExternalRef(ref) || isNonFileRef(ref)) {
      out.push(part);
      continue;
    }
    const url = await ctx.local(resolveRef(fromPath, ref), ref, fromPath, usedBy);
    out.push([url ?? ref, ...desc].join(' '));
  }
  return out.join(', ');
}

interface PagePlan {
  path: string;
  slug: string;
  title: string;
  doc: Document;
  /** Ids renomeados nesta página (colisão com outra página). */
  ids: Map<string, string>;
}

const ID_REF_ATTRS = ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'headers', 'list', 'form'];

function categorize(el: Element): { label: string; status: 'preservado' | 'parcial' } | null {
  const tag = el.tagName.toLowerCase();
  const cls = el.getAttribute('class') ?? '';
  if (/^h[1-6]$/.test(tag)) return { label: 'Título (texto editável)', status: 'preservado' };
  if (tag === 'p' || tag === 'blockquote') return { label: 'Parágrafo (texto editável)', status: 'preservado' };
  if (tag === 'a') return /\bbtn\b|button/i.test(cls) ? { label: 'Botão (ligação editável)', status: 'preservado' } : { label: 'Ligação', status: 'preservado' };
  if (tag === 'img') return { label: 'Imagem (substituível)', status: 'preservado' };
  if (tag === 'picture' || tag === 'source') return { label: 'Imagem responsiva (picture/srcset)', status: 'preservado' };
  if (['section', 'header', 'footer', 'nav', 'main', 'aside', 'article'].includes(tag)) return { label: `Estrutura <${tag}>`, status: 'preservado' };
  if ((tag === 'i' || tag === 'span') && /\b(fa[srlbd]?|fa-[\w-]+|icon-[\w-]+|bi-[\w-]+|bi)\b/.test(cls)) return { label: 'Ícone (fonte de ícones)', status: 'preservado' };
  if (['form', 'input', 'textarea', 'select'].includes(tag)) return { label: `Formulário <${tag}>`, status: 'parcial' };
  if (tag === 'video' || tag === 'audio') return { label: `Multimédia <${tag}>`, status: 'parcial' };
  if (tag === 'svg') return { label: 'SVG embutido', status: 'preservado' };
  if (tag === 'ul' || tag === 'ol' || tag === 'li') return { label: 'Lista', status: 'preservado' };
  return null;
}

async function processPage(plan: PagePlan, plans: Map<string, PagePlan>, ctx: Ctx, behaviourLog: Map<string, { b: Behaviour; count: number }>, listenerLog: ListenerFinding[]): Promise<{ wrapper: Record<string, unknown>; css: string }> {
  const { doc, path } = plan;
  const r = ctx.report;
  const from = path;

  // ---------------------------------------------------------------- folhas e scripts, pela ordem do documento
  const cssParts: string[] = [];
  const hoisted: string[] = [];
  const behaviours: Behaviour[] = [];
  let hasBootstrapJs = false;
  for (const el of [...doc.querySelectorAll('link, style, script')]) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'link') {
      const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
      const href = el.getAttribute('href') ?? '';
      const media = el.getAttribute('media') ?? '';
      if (rel.includes('stylesheet') && !rel.includes('alternate') && href) {
        if (isExternalRef(href)) {
          const res = await remoteCss(href, ctx);
          if ('css' in res) {
            cssParts.push(wrapMedia(`/* origem: ${href} */\n${res.css}`, media));
            r.add('preservado', `Folha externa ${hostOf(href)}`, 'Incluída na folha da página, no mesmo lugar', `${knownLicense(href)}. Os ficheiros que ela refere (fontes) ficam no servidor de origem.`);
          } else {
            hoisted.push(`@import url("${href.startsWith('//') ? `https:${href}` : href}")${media ? ` ${media}` : ''};`);
            r.add('parcial', `Folha externa ${hostOf(href)}`, 'Mantida como @import no início da folha', `${res.error}. Pode mudar a ordem da cascata.`);
          }
        } else if (!isNonFileRef(href)) {
          const p = resolveRef(from, href);
          const css = p ? await localCss(p, href, from, ctx) : null;
          if (css !== null) cssParts.push(wrapMedia(`/* origem: ${p ?? href} */\n${css}`, media));
        }
      } else if (rel.includes('icon') || rel.includes('shortcut') || rel.includes('apple-touch-icon')) {
        r.add('nao-suportado', 'Ícone do separador (favicon)', 'Não importado', `«${href}»: o Bolt IA ainda não tem ícone do site por projeto.`);
      } else if (rel.includes('preconnect') || rel.includes('dns-prefetch') || rel.includes('preload')) {
        // Otimizações de carregamento: sem efeito no conteúdo.
      } else if (href) {
        r.add('nao-suportado', `<link rel="${rel.join(' ')}">`, 'Removido', href.slice(0, 120));
      }
      continue;
    }
    if (tag === 'style') {
      const raw = el.textContent ?? '';
      const css = await inlineImports(await rewriteDeclUrls(raw, from, ctx), ctx, { localPath: from, depth: 0 });
      const media = el.getAttribute('media') ?? '';
      cssParts.push(wrapMedia(`/* origem: <style> em ${from} */\n${css}`, media));
      continue;
    }
    // script
    const src = el.getAttribute('src');
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'application/ld+json') {
      r.add('nao-suportado', 'Dados estruturados (JSON-LD)', 'Removidos', 'Informação para motores de pesquisa; não aparece na página.');
      continue;
    }
    if (src && isExternalRef(src)) {
      const fa = fontAwesomeCssFor(src);
      if (fa) {
        const res = await remoteCss(fa.css, ctx);
        if ('css' in res) {
          cssParts.push(`/* origem: ${fa.css} (equivalente CSS de ${src}) */\n${res.css}`);
          r.add('convertido', fa.label, 'Folha CSS oficial (fontes de ícones)', fa.detail);
        } else {
          r.add('nao-suportado', fa.label, 'Removido; ícones sem desenho', `${res.error}. A folha equivalente (${fa.css}) não pôde ser obtida.`);
        }
        continue;
      }
      const known = knownScript(src);
      if (known.kind === 'bootstrap') hasBootstrapJs = true;
      if (known.kind === 'fontawesome-kit') {
        r.add('nao-suportado', known.label, 'Removido; ícones sem desenho', 'Os kits do Font Awesome só funcionam com o script da conta; não há equivalente em CSS público.');
        continue;
      }
      r.add(known.kind === 'other' ? 'nao-suportado' : 'convertido', `Script externo: ${known.label}`, 'Removido (não é executado)', known.kind === 'bootstrap' ? 'Ver abaixo os componentes do Bootstrap usados pela página.' : `${hostOf(src)}`);
      ctx.report.remove(`<script src="${src}">`);
      continue;
    }
    let code: string;
    let origin = `<script> em ${from}`;
    if (src) {
      const p = resolveRef(from, src);
      const file = p ? getFile(ctx.site, p) : undefined;
      if (!file) {
        ctx.miss(p, src, from, 'script', 'script em falta: os comportamentos que ele teria não foram analisados');
        continue;
      }
      code = await readText(file);
      origin = file.path;
    } else code = el.textContent ?? '';
    ctx.report.remove(`script ${origin} (não executado)`);
    const a = analyzeScript(code, origin);
    for (const n of a.notices) ctx.notices.add(n);
    behaviours.push(...a.behaviours);
    for (const l of a.listeners) listenerLog.push({ ...l, detail: `${origin}: ${l.detail}` });
  }

  // ---------------------------------------------------------------- comportamentos → runtime do Bolt
  for (const b of behaviours) {
    const n = applyBehaviour(doc, b);
    const key = `${b.kind}|${b.origin}|${b.kind === 'toggle' ? `${b.trigger}>${b.target}` : b.target}`;
    const row = behaviourLog.get(key) ?? { b, count: 0 };
    row.count += n;
    behaviourLog.set(key, row);
  }
  if (hasBootstrapJs) {
    const collapses = convertBootstrapCollapse(doc);
    if (collapses) r.add('convertido', 'Bootstrap: colapso (data-bs-toggle="collapse")', 'Alternar classe «show» pelo runtime do Bolt', 'Abre e fecha sem a animação de altura do Bootstrap.', collapses);
    for (const u of bootstrapUses(doc).filter((x) => x.kind !== 'collapse')) {
      r.add('nao-suportado', `Bootstrap: ${u.kind}`, 'Sem comportamento (o JavaScript do Bootstrap não é executado)', 'O aspeto mantém-se; a interação não.', u.count);
    }
    if (!collapses && bootstrapUses(doc).length === 0) r.note(`${from}: o JavaScript do Bootstrap foi removido sem perda — a página não usa componentes ativados por data-bs-*.`);
  }

  // ---------------------------------------------------------------- comentários (avisos de licença preservados)
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n as Comment);
  for (const c of comments) {
    if (/licen[cs]e|copyright|\(c\)|©/i.test(c.data)) ctx.notices.add(c.data.trim());
    c.remove();
  }

  // ---------------------------------------------------------------- corpo: limpar, resolver endereços, contar
  const body = doc.body;
  for (const el of [...body.querySelectorAll('*')]) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'iframe') {
      const src = el.getAttribute('src') ?? '';
      if (isAllowedMapEmbed(src)) {
        const keep = ['width', 'height', 'title', 'class', 'style', 'id', 'allowfullscreen'];
        for (const a of [...el.attributes]) if (!keep.includes(a.name.toLowerCase())) el.removeAttribute(a.name);
        el.setAttribute('src', secureMapSrc(src));
        el.setAttribute('loading', 'lazy');
        el.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        if (!el.getAttribute('title')) el.setAttribute('title', 'Mapa');
        r.add('convertido', 'iframe do Google Maps', 'Mapa incorporado (domínio permitido)', 'Mostra o mapa do Google como no original (carrega conteúdo e cookies do Google). Editável pelo endereço; os outros iframes não são aceites.');
      } else {
        r.add('nao-suportado', `iframe ${hostOf(src)}`, 'Removido', `Só são aceites mapas do Google incorporados. Endereço: ${src.slice(0, 120)}`);
        ctx.report.remove(`<iframe src="${src.slice(0, 80)}">`);
        el.remove();
      }
      continue;
    }
    if (BLOCKED.has(tag)) {
      if (tag !== 'script') ctx.report.remove(`<${tag}> removido`);
      el.remove();
      continue;
    }
    if (tag === 'style') {
      el.remove(); // já incluído na folha da página
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        ctx.report.remove(`atributo ${name} em <${tag}>`);
        el.removeAttribute(attr.name);
      } else if (['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data'].includes(name) && isUnsafeUrl(attr.value)) {
        ctx.report.remove(`${name}="${attr.value.slice(0, 30)}…" em <${tag}>`);
        el.removeAttribute(attr.name);
      }
    }
    const cat = categorize(el);
    if (cat) r.add(cat.status, cat.label, cat.status === 'parcial' ? 'Mantido (sem envio nem reprodução garantidos)' : 'Componente editável', cat.status === 'parcial' && tag !== 'video' && tag !== 'audio' ? 'O envio de formulários depende de uma integração que não existe neste projeto.' : '');

    // Imagens com carregamento diferido (lazy-load por script): passam a carregar sem script.
    if (tag === 'img' && el.getAttribute('data-src') && !el.getAttribute('src')) {
      el.setAttribute('src', el.getAttribute('data-src') ?? '');
      r.add('convertido', 'Imagem com carregamento diferido (data-src)', 'Imagem normal (src)', 'O script de carregamento diferido não é executado.');
    }
    for (const name of ['src', 'poster']) {
      const v = el.getAttribute(name);
      if (!v || isExternalRef(v) || isNonFileRef(v)) continue;
      if (tag === 'video' || tag === 'audio' || (tag === 'source' && el.parentElement?.tagName.toLowerCase() !== 'picture' && name === 'src')) {
        r.add('parcial', `Multimédia local (${baseName(v)})`, 'Mantido o caminho original', 'Vídeo e áudio não são copiados para o armazenamento; o ficheiro não aparece.');
        ctx.miss(resolveRef(from, v), v, from, 'recurso', 'vídeo/áudio não é guardado pelo Bolt IA');
        continue;
      }
      const url = await ctx.local(resolveRef(from, v), v, from, tag === 'img' ? 'imagem' : tag);
      if (url) el.setAttribute(name, url);
    }
    for (const name of SRCSET_ATTRS) {
      const v = el.getAttribute(name);
      if (v) el.setAttribute(name === 'data-srcset' ? 'srcset' : name, await rewriteSrcset(v, from, ctx, 'imagem (srcset)'));
      if (name === 'data-srcset' && v) el.removeAttribute('data-srcset');
    }
    const style = el.getAttribute('style');
    if (style && /url\(/i.test(style)) el.setAttribute('style', await rewriteCssUrls(style, from, ctx, 'estilo no elemento'));
    for (const name of ['href', 'xlink:href']) {
      const v = el.getAttribute(name);
      if (!v) continue;
      el.setAttribute(name, rewriteHref(v, plan, plans, ctx, tag));
    }
    // Ids e referências a ids renomeados nesta página.
    if (plan.ids.size) {
      const id = el.getAttribute('id');
      if (id && plan.ids.has(id)) el.setAttribute('id', plan.ids.get(id) ?? id);
      for (const a of ID_REF_ATTRS) {
        const v = el.getAttribute(a);
        if (v) el.setAttribute(a, v.split(/\s+/).map((x) => plan.ids.get(x) ?? x).join(' '));
      }
      for (const a of ['data-bs-target', 'data-target', 'data-bolt-toggle']) {
        const v = el.getAttribute(a);
        if (v) el.setAttribute(a, remapSelectorIds(v, plan.ids));
      }
    }
  }

  // Espaços entre elementos (ex.: botões ou ícones lado a lado): o browser mostra-os como UM
  // espaço; o motor só guarda os que já são exatamente « ». Normalizar mantém o mesmo aspeto.
  const texts = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const blanks: Text[] = [];
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    const t = n as Text;
    if (!t.data.trim() && t.data !== ' ' && t.previousSibling && t.nextSibling && !t.parentElement?.closest('pre, textarea')) blanks.push(t);
  }
  for (const t of blanks) t.data = ' ';

  // Ligações que envolvem blocos (cartões, imagens com legenda): «Bloco de ligação», para que o
  // conteúdo continue editável elemento a elemento (uma ligação de texto esconderia os filhos).
  for (const a of [...body.querySelectorAll('a')]) {
    if ([...a.children].some((ch) => BLOCK_CHILDREN.has(ch.tagName.toLowerCase())) && !a.hasAttribute('data-bolt-type')) {
      a.setAttribute('data-bolt-type', 'link-box');
      r.add('convertido', 'Ligação que envolve blocos (<a> com div/img…)', 'Bloco de ligação', 'O conteúdo continua editável elemento a elemento; o destino da ligação mantém-se.');
    }
  }

  // Ids repetidos na MESMA página (HTML inválido): o motor exige ids únicos.
  const seen = new Set<string>();
  for (const el of [...body.querySelectorAll('[id]')]) {
    const id = el.getAttribute('id') ?? '';
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    let n = 2;
    while (seen.has(`${id}-${n}`)) n += 1;
    el.setAttribute('id', `${id}-${n}`);
    seen.add(`${id}-${n}`);
    r.add('parcial', `id repetido «${id}»`, `Renomeado para «${id}-${n}»`, 'O HTML original tinha o mesmo id em dois elementos; o CSS e as âncoras continuam a apontar para o primeiro.');
  }

  // ---------------------------------------------------------------- folha da página
  let css = [...hoisted, ...cssParts].join('\n\n');
  css = remapCssIds(css, plan.ids);
  const bodyStyle = body.getAttribute('style');
  if (bodyStyle) css += `\n\n/* origem: atributo style do <body> */\nbody{${await rewriteCssUrls(bodyStyle, from, ctx, 'estilo do corpo')}}`;

  // Corpo → página do motor (atributos do <body> no wrapper).
  const attributes: Record<string, string> = {};
  for (const a of [...body.attributes]) {
    const name = a.name.toLowerCase();
    if (name === 'class' || name === 'style' || name.startsWith('on')) continue;
    attributes[a.name] = name === 'id' ? (plan.ids.get(a.value) ?? a.value) : a.value;
  }
  const classes = (body.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const wrapper: Record<string, unknown> = {
    type: 'wrapper',
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...(classes.length ? { classes } : {}),
    components: [{ type: 'bolt-stylesheet', content: '', attributes: { 'data-bolt-type': 'stylesheet', 'data-bolt-source': path } }, body.innerHTML],
  };
  return { wrapper, css };
}

function rewriteHref(value: string, plan: PagePlan, plans: Map<string, PagePlan>, ctx: Ctx, tag: string): string {
  const v = value.trim();
  if (v.startsWith('#')) {
    const id = v.slice(1);
    const mapped = plan.ids.get(id);
    return mapped ? `#${mapped}` : value;
  }
  if (isExternalRef(v) || isNonFileRef(v)) return value;
  const { hash } = splitRef(v);
  const path = resolveRef(plan.path, v);
  const asIndex = path && !/\.[a-z0-9]+$/i.test(path) ? `${path}/index.html` : null;
  const target = (path ? plans.get(path.toLowerCase()) : undefined) ?? (asIndex ? plans.get(asIndex.toLowerCase()) : undefined) ?? (v === '/' || v === './' ? [...plans.values()][0] : undefined);
  if (target) {
    const id = hash.slice(1);
    const mapped = id ? (target.ids.get(id) ?? id) : '';
    return `/${target.slug}${mapped ? `#${mapped}` : ''}`;
  }
  if (path && isHtmlPath(path)) {
    const exists = !!getFile(ctx.site, path);
    ctx.report.add('parcial', `Ligação para ${path}`, 'Mantido o endereço original', exists ? 'A página existe no arquivo mas não foi escolhida para importar.' : 'A página não existe no arquivo.');
    return value;
  }
  if (path && getFile(ctx.site, path) && tag === 'a') {
    ctx.report.add('parcial', `Ligação para ficheiro do arquivo (${extOf(path) || 'sem extensão'})`, 'Mantido o caminho original', `«${path}» não é guardado pelo Bolt IA; a ligação não abre o ficheiro.`);
  }
  return value;
}

/** Lista as páginas do site (para escolher quais importar e a inicial). */
export async function listCandidates(site: SiteFiles): Promise<PageCandidate[]> {
  const out: PageCandidate[] = [];
  for (const f of site.files.values()) {
    if (!isHtmlPath(f.path)) continue;
    const html = await readHtml(f);
    out.push({ path: f.path, title: titleOf(html, f.path), auxiliary: auxiliaryReason(f.path, html) });
  }
  return out.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
}

function chooseHome(selected: string[], wanted?: string): string {
  if (wanted && selected.includes(wanted)) return wanted;
  return selected.find((p) => p.toLowerCase() === 'index.html') ?? selected.find((p) => /(^|\/)index\.html?$/i.test(p)) ?? selected[0] ?? '';
}

async function manifestOf(site: SiteFiles, fileName: string): Promise<string> {
  let budget = MANIFEST_BUDGET;
  const files: Array<{ path: string; size: number; text?: string; omitted?: string }> = [];
  for (const f of [...site.files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (isTextPath(f.path) && f.size <= budget) {
      const text = await readText(f);
      budget -= text.length;
      files.push({ path: f.path, size: f.size, text });
    } else files.push({ path: f.path, size: f.size, omitted: isTextPath(f.path) ? 'texto acima do limite do registo' : 'binário (as imagens usadas ficam no armazenamento do projeto)' });
  }
  return JSON.stringify({ kind: 'bolt-static-site', version: 1, fileName, outerFolder: site.outerFolder, skipped: site.skipped, files });
}

export async function convertStaticSite(site: SiteFiles, fileName: string, fileSize: number, deps: StaticDeps, opts: StaticOptions = {}): Promise<StaticResult> {
  const ctx = new Ctx(site, deps);
  const r = ctx.report;
  const candidates = await listCandidates(site);
  if (candidates.length === 0) throw new Error(site.source === 'zip' ? 'O arquivo não tem páginas HTML (.html ou .htm).' : 'Não foi indicado nenhum ficheiro HTML.');

  const byPath = new Map(candidates.map((c) => [c.path, c]));
  let selected = (opts.pages ?? candidates.filter((c) => !c.auxiliary).map((c) => c.path)).filter((p) => byPath.has(p));
  if (selected.length === 0) selected = candidates.slice(0, 1).map((c) => c.path);
  if (selected.length > MAX_PAGES) {
    r.note(`O site tem ${selected.length} páginas; foram importadas as primeiras ${MAX_PAGES}. As restantes podem ser importadas noutro projeto.`);
    selected = selected.slice(0, MAX_PAGES);
  }
  const home = chooseHome(selected, opts.home);
  const ordered = [home, ...selected.filter((p) => p !== home).sort()];

  // Planos: slug e ids de cada página (os ids repetidos ENTRE páginas são renomeados).
  const plans = new Map<string, PagePlan>();
  const taken = new Set<string>();
  const globalIds = new Set<string>();
  for (const path of ordered) {
    const file = getFile(site, path);
    if (!file) continue;
    const html = await readHtml(file);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const isHome = path === home;
    const base = isHome ? 'inicio' : slugify(path.replace(/\.html?$/i, '').replace(/\/index$/i, ''));
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    const ids = new Map<string, string>();
    const own = new Set<string>();
    for (const el of [doc.body, ...doc.body.querySelectorAll('[id]')]) {
      const id = el.getAttribute('id');
      if (!id || own.has(id)) continue;
      own.add(id);
      if (globalIds.has(id)) {
        let next = `${id}-${slug}`;
        for (let n = 2; globalIds.has(next) || own.has(next); n += 1) next = `${id}-${slug}-${n}`;
        ids.set(id, next);
      }
    }
    for (const id of own) globalIds.add(ids.get(id) ?? id);
    plans.set(path.toLowerCase(), { path: file.path, slug, title: titleOf(html, path), doc, ids });
  }

  const behaviourLog = new Map<string, { b: Behaviour; count: number }>();
  const listenerLog: ListenerFinding[] = [];
  const processed: Array<{ plan: PagePlan; wrapper: Record<string, unknown>; css: string }> = [];
  for (const plan of plans.values()) processed.push({ plan, ...(await processPage(plan, plans, ctx, behaviourLog, listenerLog)) });
  // Avisos de licença de TODOS os ficheiros lidos, no início da folha de cada página.
  const notices = [...ctx.notices];
  const header = notices.length ? `/*! Avisos de autoria e licença dos ficheiros de origem (preservados pelo Bolt IA)\n\n${notices.map((n) => n.replace(/\*\//g, '* /')).join('\n\n')}\n*/\n\n` : '';
  const pages: RawProjectData['pages'] = [];
  for (const { plan, wrapper, css } of processed) {
    if (plan.ids.size) {
      r.add('convertido', 'Ids repetidos entre páginas', 'Renomeados (CSS, âncoras e atributos atualizados)', [...plan.ids].map(([a, b]) => `${a} → ${b}`).join(', '), plan.ids.size);
    }
    const stats = cssStats(css);
    if (css.trim()) {
      r.add(
        'preservado',
        `Folha de estilos de ${plan.path}`,
        'CSS da página, literal e pela ordem original',
        `${stats.rules} regras, ${stats.media} @media, ${stats.variables} variáveis, ${stats.pseudo} seletores com pseudo-classes/elementos, ${stats.fontFaces} @font-face, ${stats.keyframes} animações, ${stats.supports} @supports.`,
      );
    }
    const components = wrapper.components as Array<Record<string, unknown>>;
    const sheet = components[0];
    if (sheet) sheet.content = (header + css).replace(/<\/style/gi, '<\\/style');
    pages.push({ id: `pagina-${plan.slug}`, name: plan.title, slug: plan.slug, ...(plan.path === home ? { type: 'main' } : {}), frames: [{ component: wrapper as never }] });
  }

  // ---------------------------------------------------------------- comportamentos (relatório)
  for (const { b, count } of behaviourLog.values()) {
    if (b.kind === 'toggle') {
      if (count) r.add('convertido', `Clique em ${b.trigger} (${b.origin})`, 'Abrir/fechar pelo runtime do Bolt', `Alterna «${b.targetClass}» em ${b.target}${b.selfClass ? ` e «${b.selfClass}» no botão` : ''}${b.swap ? `; troca o ícone ${b.swap[0]} ↔ ${b.swap[1]}` : ''}.`, count);
      else r.add('convertido', `Clique em ${b.trigger} (${b.origin})`, 'Removido (sem efeito nesta página)', 'Nenhum elemento corresponde ao botão ou ao alvo.');
    } else if (count) {
      r.add('convertido', `Ao rolar: ${b.target} (${b.origin})`, 'Mostrar depois de rolar, pelo runtime do Bolt', `Aparece depois de ${b.threshold} px${b.effect === 'fade' ? ', com transição de opacidade' : ''}.`, count);
    } else r.add('convertido', `Ao rolar: ${b.target} (${b.origin})`, 'Removido (sem efeito nesta página)', 'Nenhum elemento corresponde.');
  }
  for (const l of listenerLog.filter((x) => !x.recognized)) {
    const matches = l.selector ? [...plans.values()].some((p) => safeMatch(p.doc, l.selector ?? '')) : true;
    if (!matches) r.add('convertido', `Evento «${l.event}» em ${l.selector}`, 'Removido (sem efeito nesta página)', `${l.detail}; nenhum elemento da página corresponde a ${l.selector}.`);
    else r.add('nao-suportado', `Evento «${l.event}»${l.selector ? ` em ${l.selector}` : ''}`, 'Sem equivalente (script não executado)', l.detail);
  }

  // ---------------------------------------------------------------- recursos, avisos e notas
  for (const s of site.skipped) r.add('nao-suportado', `Ficheiro ignorado: ${s.path}`, 'Não lido', s.reason);
  const sourceFiles = [...site.files.values()].filter((f) => /(^|\/)(package\.json|composer\.json|gulpfile\.js|webpack\.config\.\w+)$|\.(php|pug|jade|hbs|njk|liquid|ejs|scss|sass|less|vue|jsx|tsx)$/i.test(f.path) && !f.path.includes('node_modules/'));
  if (sourceFiles.length) {
    r.note(`O arquivo parece conter código-fonte (${sourceFiles.slice(0, 5).map((f) => f.path).join(', ')}${sourceFiles.length > 5 ? '…' : ''}). Só são importados HTML, CSS e recursos já gerados; nada é compilado nem instalado. Se o site precisar de compilação, importe a versão exportada (ex.: pasta dist/ ou build/).`);
  }
  if (site.outerFolder) r.note(`Pasta exterior «${site.outerFolder}/» tratada como raiz do site.`);
  const aux = candidates.filter((c) => !selected.includes(c.path));
  if (aux.length) r.note(`Ficheiros HTML não importados como páginas: ${aux.map((c) => `${c.path}${c.auxiliary ? ` (${c.auxiliary})` : ''}`).join('; ')}.`);
  if (ctx.notices.size) r.note(`${ctx.notices.size} aviso(s) de autoria e licença preservado(s) no início da folha de estilos de cada página.`);
  const licenseFiles = [...site.files.values()].filter((f) => /(^|\/)(license|licence|copying|notice)(\.[a-z]+)?$/i.test(f.path));
  if (licenseFiles.length) r.note(`Ficheiros de licença no arquivo: ${licenseFiles.map((f) => f.path).join(', ')} (guardados no registo da importação).`);
  r.note('A folha de estilos importada é mantida tal como está e não aparece nos «Estilos globais». As alterações feitas no inspetor criam regras próprias do elemento, que prevalecem sobre as classes da folha (exceto declarações !important).');
  if (ctx.assets.size) r.note('As imagens locais são guardadas no armazenamento do projeto ao confirmar (as maiores do que 1600 px no lado maior são reduzidas, como as outras imagens carregadas no Bolt IA).');

  const assets: AssetEntry[] = [...ctx.assets.values()].map((a) => ({ url: a.url, local: a.path, status: 'disponivel', usedBy: [...a.usedBy] }));
  const missing = [...ctx.missing.values()];
  for (const m of missing.filter((x) => x.kind === 'imagem')) {
    assets.push({ url: m.ref, local: m.path, status: 'em-falta', usedBy: [`referida em ${m.from.join(', ')}`], reason: m.reason ?? 'o ficheiro não está no arquivo nem foi indicado' });
  }
  const home0 = plans.get(home.toLowerCase());
  return {
    projectData: { pages },
    suggestedName: (home0?.title ?? fileName.replace(/\.(zip|html?)$/i, '')).slice(0, 120),
    report: {
      format: site.source === 'zip' ? 'zip' : 'html',
      formatLabel: site.source === 'zip' ? 'ZIP de site estático' : 'HTML/CSS',
      fileName,
      fileSize,
      items: r.items(),
      assets,
      fonts: [...ctx.fonts.values()],
      notes: r.notes,
      removed: r.removed,
      totals: r.totals(),
      missingFiles: missing,
      pages: [...plans.values()].map((p) => ({ path: p.path, slug: p.slug, title: p.title, home: p.path === home })),
    },
    candidates,
    pages: ordered,
    home,
    localAssets: [...ctx.assets.values()],
    remoteImages: ctx.remoteImages,
    manifest: await manifestOf(site, fileName),
  };
}

function safeMatch(doc: Document, selector: string): boolean {
  if (selector === 'document' || selector === 'window' || selector.startsWith('document.')) return true;
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    return true;
  }
}
