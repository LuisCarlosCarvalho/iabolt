import { readZip, ZIP_LIMITS, type ZipLimits, type ZipSkipped } from './zip';

/**
 * Ficheiros de um site estático, vindos de um ZIP ou de ficheiros soltos (HTML avulso com os
 * recursos indicados pelo utilizador). Os caminhos são relativos à raiz do site, com «/».
 */
export interface SiteFile {
  path: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

export interface SiteFiles {
  /** Origem: o nome do ZIP ou dos ficheiros. */
  source: 'zip' | 'ficheiros';
  files: Map<string, SiteFile>;
  /** Pasta exterior retirada (ex.: «site-main/»), se o arquivo a tinha. */
  outerFolder: string | null;
  skipped: ZipSkipped[];
}

const lower = (s: string) => s.toLowerCase();

/** Pasta comum a todas as entradas (o habitual em ZIP descarregados do GitHub). */
function commonFolder(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const first = paths[0]?.split('/')[0] ?? '';
  if (!first || paths.some((p) => !p.includes('/') || p.split('/')[0] !== first)) return null;
  return first;
}

export function siteFromZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): SiteFiles {
  const zip = readZip(bytes, limits);
  const paths = zip.entries.map((e) => e.path);
  // Pode haver mais do que um nível de pasta exterior (ex.: «site/site/index.html»).
  let outer: string[] = [];
  for (;;) {
    const strip = outer.length ? `${outer.join('/')}/` : '';
    const folder = commonFolder(paths.map((p) => p.slice(strip.length)));
    if (!folder) break;
    outer = [...outer, folder];
  }
  const prefix = outer.length ? `${outer.join('/')}/` : '';
  const files = new Map<string, SiteFile>();
  for (const e of zip.entries) {
    const path = e.path.slice(prefix.length);
    files.set(lower(path), { path, size: e.size, bytes: () => zip.read(e) });
  }
  return { source: 'zip', files, outerFolder: outer.length ? outer.join('/') : null, skipped: zip.skipped };
}

/** Ficheiros soltos: ficam na raiz com o nome próprio (ou o caminho relativo, se a escolha foi de uma pasta). */
export async function siteFromFiles(list: ReadonlyArray<{ name: string; size: number; webkitRelativePath?: string; arrayBuffer(): Promise<ArrayBuffer> }>): Promise<SiteFiles> {
  const files = new Map<string, SiteFile>();
  const skipped: ZipSkipped[] = [];
  for (const f of list) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const parts = rel.split('/').filter((x) => x && x !== '.');
    if (parts.some((x) => x === '..') || parts.length === 0) {
      skipped.push({ path: rel, reason: 'caminho inválido' });
      continue;
    }
    if (f.size > ZIP_LIMITS.maxFileBytes) {
      skipped.push({ path: rel, reason: `ficheiro com mais de ${Math.round(ZIP_LIMITS.maxFileBytes / 1048576)} MB` });
      continue;
    }
    const path = parts.join('/');
    let cached: Promise<Uint8Array> | null = null;
    files.set(lower(path), { path, size: f.size, bytes: () => (cached ??= f.arrayBuffer().then((b) => new Uint8Array(b))) });
  }
  const folder = commonFolder([...files.values()].map((f) => f.path));
  if (folder) {
    const strip = `${folder}/`;
    const moved = new Map<string, SiteFile>();
    for (const f of files.values()) {
      const path = f.path.slice(strip.length);
      moved.set(lower(path), { ...f, path });
    }
    return { source: 'ficheiros', files: moved, outerFolder: folder, skipped };
  }
  return { source: 'ficheiros', files, outerFolder: null, skipped };
}

/** Junta ficheiros acrescentados depois (recursos em falta indicados pelo utilizador). */
export function mergeSites(base: SiteFiles, extra: SiteFiles): SiteFiles {
  const files = new Map(base.files);
  for (const [k, f] of extra.files) if (!files.has(k)) files.set(k, f);
  return { ...base, files, skipped: [...base.skipped, ...extra.skipped] };
}

/**
 * Ficheiro por caminho. Com ficheiros soltos (HTML avulso), os recursos escolhidos à parte não
 * trazem as pastas: «css/estilo.css» é encontrado como «estilo.css» se esse nome for único.
 */
export function getFile(site: SiteFiles, path: string): SiteFile | undefined {
  const exact = site.files.get(lower(path));
  if (exact || site.source !== 'ficheiros') return exact;
  const name = lower(baseName(path));
  const same = [...site.files.values()].filter((f) => lower(baseName(f.path)) === name);
  return same.length === 1 ? same[0] : undefined;
}

/** Endereço externo (http, https, «//»)? */
export const isExternalRef = (ref: string): boolean => /^(https?:)?\/\//i.test(ref.trim());

/** Referência que não é um ficheiro (âncora, data:, mailto:, tel:, javascript:…). */
export const isNonFileRef = (ref: string): boolean => {
  const r = ref.trim();
  return r === '' || r.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(r);
};

/** Separa o caminho do sufixo «?…#…». */
export function splitRef(ref: string): { path: string; query: string; hash: string } {
  const r = ref.trim();
  const hashAt = r.indexOf('#');
  const beforeHash = hashAt >= 0 ? r.slice(0, hashAt) : r;
  const hash = hashAt >= 0 ? r.slice(hashAt) : '';
  const queryAt = beforeHash.indexOf('?');
  return { path: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash, query: queryAt >= 0 ? beforeHash.slice(queryAt) : '', hash };
}

/**
 * Resolve uma referência relativa a partir do ficheiro que a contém (HTML, CSS ou @import).
 * «/x» é relativo à raiz do site. Devolve `null` se sair da raiz.
 */
export function resolveRef(fromFile: string, ref: string): string | null {
  const { path } = splitRef(ref);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Percentagens inválidas: usa-se o texto tal como está.
  }
  const base = decoded.startsWith('/') ? [] : fromFile.split('/').slice(0, -1);
  const parts = [...base];
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
};

export const extOf = (path: string): string => lower(path.split('/').pop()?.split('.').pop() ?? '');
export const mimeOf = (path: string): string => MIME[extOf(path)] ?? 'application/octet-stream';
export const baseName = (path: string): string => path.split('/').pop() ?? path;

export const isHtmlPath = (p: string) => /\.html?$/i.test(p);
export const isTextPath = (p: string) => /\.(html?|css|js|mjs|json|txt|md|svg|xml)$/i.test(p) || /(^|\/)(license|licence|readme|copying|notice)(\.[a-z]+)?$/i.test(p);

const utf8 = new TextDecoder('utf-8');
export async function readText(file: SiteFile): Promise<string> {
  return utf8.decode(await file.bytes()).replace(/^\uFEFF/, '');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
