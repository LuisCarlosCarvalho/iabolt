import { replaceAll } from '../assets/assetRefs';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, type AssetStore } from '../assets/assetStore';
import { projectDataSchema, type GrapesProjectData } from '../contract/boltDocument';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { sweepAllPages } from '../engine/identity';
import { parseCss, type StyleJson } from './css';
import { convertElementor, isElementorDocument, type ElementorFontRequest } from './elementor/elementor';
import { convertGrapesJs, isGrapesJsProject } from './grapesjs/studio';
import type { AdapterResult, AssetEntry, FontEntry, ImportFormatId, ImportReport, RawProjectData } from './types';

/**
 * Pipeline único de importação: receber → identificar pelo conteúdo → validar → converter →
 * verificar imagens e fontes → relatório e prévia → (confirmação) → copiar imagens → documento.
 * O resultado é sempre JSON de projeto do motor, pronto para um BoltDocument.
 */

export interface FormatInfo {
  id: ImportFormatId;
  label: string;
  available: boolean;
  note: string;
}

/** Só os formatos com adaptador implementado e testado aparecem como disponíveis. */
export const FORMATS: readonly FormatInfo[] = [
  { id: 'grapesjs', label: 'GrapesJS / GrapesJS Studio (.json, .grapesjs)', available: true, note: 'JSON de projeto' },
  { id: 'elementor', label: 'Elementor (modelo .json)', available: true, note: 'containers flexbox e widgets comuns' },
  { id: 'html', label: 'HTML/CSS', available: false, note: 'fase seguinte' },
  { id: 'zip', label: 'ZIP de site estático', available: false, note: 'fase seguinte' },
];

export interface Detection {
  format: ImportFormatId;
  reason: string;
  json?: unknown;
}

/** Identifica o formato pelo conteúdo (nunca pela extensão). */
export function detectFormat(text: string): Detection {
  const head = text.slice(0, 4);
  if (head.startsWith('PK')) return { format: 'zip', reason: 'arquivo ZIP (assinatura «PK»)' };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) return { format: 'html', reason: 'documento começa por uma etiqueta HTML' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { format: 'unknown', reason: 'não é JSON válido nem HTML' };
  }
  if (json && typeof json === 'object' && 'boltSchemaVersion' in json) return { format: 'bolt', reason: 'envelope BoltDocument', json };
  if (isElementorDocument(json)) return { format: 'elementor', reason: 'JSON com «content» de elementos Elementor (elType/widgetType)', json };
  if (isGrapesJsProject(json)) return { format: 'grapesjs', reason: 'JSON com pages › frames › component', json };
  return { format: 'unknown', reason: 'JSON sem uma estrutura conhecida', json };
}

export interface Dependencies {
  /** Obtém recursos remotos (imagens, CSS de fontes). */
  fetch: typeof fetch;
  /** Verifica se uma imagem carrega num <img> (funciona sem CORS). */
  probeImage: (url: string) => Promise<boolean>;
}

export function browserDependencies(): Dependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    probeImage: (url) =>
      new Promise((resolve) => {
        const img = new Image();
        const timer = window.setTimeout(() => resolve(false), 15000);
        img.onload = () => {
          window.clearTimeout(timer);
          resolve(img.naturalWidth > 0);
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          resolve(false);
        };
        img.src = url;
      }),
  };
}

export interface ImportAnalysis {
  projectData: GrapesProjectData;
  report: ImportReport;
  suggestedName: string;
  original: { name: string; type: string; text: string };
  /** Imagens que podem ser copiadas, já lidas (evita segundo pedido na confirmação). */
  blobs: Map<string, Blob>;
}

const isRemote = (s: string) => /^https?:\/\//i.test(s);

/** Imagens externas usadas no documento (src de componentes, lista de recursos, url() no CSS). */
export function collectImageUrls(data: GrapesProjectData): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (url: string, by: string) => {
    if (!isRemote(url)) return;
    const set = out.get(url) ?? new Set<string>();
    set.add(by);
    out.set(url, set);
  };
  const walk = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    const node = c as { type?: unknown; src?: unknown; attributes?: { src?: unknown }; components?: unknown };
    const by = typeof node.type === 'string' ? node.type : 'componente';
    if (typeof node.src === 'string') add(node.src, by);
    if (typeof node.attributes?.src === 'string') add(node.attributes.src, by);
    if (Array.isArray(node.components)) node.components.forEach(walk);
  };
  for (const p of data.pages) for (const f of p.frames) walk(f.component);
  for (const a of data.assets ?? []) {
    const src = typeof a === 'string' ? a : a && typeof a === 'object' && 'src' in a && typeof a.src === 'string' ? a.src : '';
    add(src, 'lista de imagens');
  }
  for (const rule of data.styles ?? []) {
    if (!rule || typeof rule !== 'object' || ('atRuleType' in rule && rule.atRuleType === 'font-face')) continue;
    const style = 'style' in rule && rule.style && typeof rule.style === 'object' ? Object.values(rule.style) : [];
    for (const v of style) if (typeof v === 'string') for (const m of v.matchAll(/url\(\s*["']?(https?:[^"')]+)["']?\s*\)/gi)) if (m[1]) add(m[1], 'CSS (fundo)');
  }
  return out;
}

/** Fontes sem ficheiros no documento: procura-as no Google Fonts (licenças abertas). */
async function googleFonts(requests: ElementorFontRequest[], deps: Dependencies): Promise<{ rules: StyleJson[]; entries: FontEntry[] }> {
  const rules: StyleJson[] = [];
  const entries: FontEntry[] = [];
  for (const r of requests) {
    const family = r.family.trim().replace(/\s+/g, '+');
    const urls = [`https://fonts.googleapis.com/css2?family=${family}:wght@${r.weights.join(';')}&display=swap`, `https://fonts.googleapis.com/css2?family=${family}&display=swap`];
    let css: string | undefined;
    let lastError = '';
    for (const url of urls) {
      try {
        const res = await deps.fetch(url);
        if (res.ok) {
          css = await res.text();
          break;
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    const faces = css ? parseCss(css).rules.filter((x) => x.atRuleType === 'font-face') : [];
    rules.push(...faces);
    entries.push({
      family: r.family,
      source: 'Google Fonts (fonts.gstatic.com)',
      license: 'Licença aberta do Google Fonts (SIL OFL 1.1 ou Apache 2.0)',
      status: faces.length ? 'carregada' : 'nao-carregada',
      detail: faces.length ? `pesos ${r.weights.join(', ')}` : `não foi possível obter a fonte (${lastError || 'sem resposta'}); é usada a fonte de recurso`,
    });
  }
  return { rules, entries };
}

async function checkAssets(urls: Map<string, Set<string>>, deps: Dependencies, blobs: Map<string, Blob>): Promise<AssetEntry[]> {
  const entries: AssetEntry[] = [];
  await Promise.all(
    [...urls.entries()].map(async ([url, by]) => {
      const usedBy = [...by];
      try {
        const res = await deps.fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) {
          entries.push({ url, usedBy, status: 'em-falta', reason: `o servidor de origem respondeu ${res.status}` });
          return;
        }
        const raw = await res.blob();
        // O tipo declarado pelo servidor manda; o do Blob pode vir vazio consoante o ambiente.
        const type = ((res.headers.get('content-type') ?? raw.type).split(';')[0] ?? '').trim().toLowerCase();
        const blob = raw.type === type ? raw : new Blob([raw], { type });
        if (type === 'image/svg+xml') {
          entries.push({ url, usedBy, status: 'externa', reason: 'SVG não é copiado para o armazenamento por segurança; mantido o endereço original' });
          return;
        }
        if (!ACCEPTED_IMAGE_TYPES.some((t) => t === type)) {
          entries.push({ url, usedBy, status: 'rejeitada', reason: `tipo «${type || 'desconhecido'}» não é uma imagem suportada` });
          return;
        }
        if (blob.size > MAX_IMAGE_BYTES) {
          entries.push({ url, usedBy, status: 'rejeitada', reason: 'imagem com mais de 8 MB' });
          return;
        }
        blobs.set(url, blob);
        entries.push({ url, usedBy, status: 'disponivel' });
      } catch {
        // Sem CORS ou sem rede: distinguir «visível mas não copiável» de «em falta».
        const visible = await deps.probeImage(url);
        entries.push(
          visible
            ? { url, usedBy, status: 'externa', reason: 'o site de origem não permite copiar a imagem a partir do browser (sem CORS); fica o endereço original' }
            : { url, usedBy, status: 'em-falta', reason: 'a imagem não carrega (site ou ficheiro inexistente)' },
        );
      }
    }),
  );
  return entries.sort((a, b) => a.status.localeCompare(b.status) || a.url.localeCompare(b.url));
}

/** Passa o documento pelo motor: garante ids, tipos registados e JSON canónico. */
export function normalize(data: RawProjectData): GrapesProjectData {
  const editor = createBoltEditor();
  try {
    editor.loadProjectData(data);
    sweepAllPages(editor);
    return projectDataSchema.parse(JSON.parse(JSON.stringify(getProjectData(editor))));
  } finally {
    editor.destroy();
  }
}

export async function analyzeImport(file: { name: string; type: string; size: number; text: () => Promise<string> }, deps: Dependencies): Promise<ImportAnalysis> {
  const text = await file.text();
  const detection = detectFormat(text);
  let result: AdapterResult;
  let fontRequests: ElementorFontRequest[] = [];
  if (detection.format === 'grapesjs') result = convertGrapesJs(detection.json, file.name, file.size);
  else if (detection.format === 'elementor') {
    const r = convertElementor(detection.json, file.name, file.size);
    result = r;
    fontRequests = r.fontRequests;
  } else {
    const info = FORMATS.find((f) => f.id === detection.format);
    throw new Error(
      info
        ? `Formato identificado: ${info.label} (${detection.reason}). Ainda não é suportado (${info.note}).`
        : `Formato não reconhecido: ${detection.reason}. Formatos disponíveis: ${FORMATS.filter((f) => f.available).map((f) => f.label).join('; ')}.`,
    );
  }

  const fonts = await googleFonts(fontRequests, deps);
  const withFonts: RawProjectData = { ...result.projectData, styles: [...fonts.rules, ...(result.projectData.styles ?? [])] };
  const projectData = normalize(withFonts);
  const blobs = new Map<string, Blob>();
  const known = new Map(result.report.assets.map((a) => [a.url, new Set(a.usedBy)]));
  for (const [url, by] of collectImageUrls(projectData)) known.set(url, new Set([...(known.get(url) ?? []), ...by]));
  const assets = await checkAssets(known, deps, blobs);
  return {
    projectData,
    suggestedName: result.suggestedName,
    blobs,
    original: { name: file.name, type: file.type || 'application/json', text },
    report: { ...result.report, fonts: [...result.report.fonts, ...fonts.entries], assets },
  };
}

/**
 * Na confirmação: copia as imagens disponíveis para o destino (Storage do workspace ou
 * documento local). Só com `copyImages` (o utilizador confirmou que pode usar as imagens);
 * sem isso ficam com o endereço original e o relatório diz porquê. Nunca há substituição silenciosa.
 */
export async function completeImport(
  analysis: ImportAnalysis,
  store: AssetStore,
  opts: { copyImages: boolean; onProgress?: (done: number, total: number) => void },
): Promise<{ projectData: GrapesProjectData; report: ImportReport }> {
  const { onProgress } = opts;
  const map = new Map<string, string>();
  const assets = analysis.report.assets.map((a) => ({ ...a }));
  if (!opts.copyImages) {
    for (const a of assets.filter((x) => x.status === 'disponivel')) {
      a.status = 'externa';
      a.reason = 'não copiada: a autorização de uso não foi confirmada; fica o endereço original';
    }
  }
  const todo = assets.filter((a) => a.status === 'disponivel');
  let done = 0;
  for (const a of todo) {
    const blob = analysis.blobs.get(a.url);
    try {
      if (!blob) throw new Error('imagem não lida na análise');
      const name = decodeURIComponent(a.url.split('/').pop()?.split('?')[0] ?? 'imagem');
      const uploaded = await store.upload(new File([blob], name, { type: blob.type }));
      map.set(a.url, uploaded.stored);
      a.status = 'copiada';
      a.stored = uploaded.stored;
    } catch (e) {
      a.status = 'externa';
      a.reason = `falhou a cópia (${e instanceof Error ? e.message : String(e)}); fica o endereço original`;
    }
    done += 1;
    onProgress?.(done, todo.length);
  }
  const projectData = projectDataSchema.parse(replaceAll(analysis.projectData, map));
  return { projectData, report: { ...analysis.report, assets } };
}

/** Imagens que ficam por resolver (a importação é parcial se houver alguma). */
export const unresolvedAssets = (report: ImportReport): AssetEntry[] => report.assets.filter((a) => a.status !== 'copiada' && a.status !== 'disponivel');
