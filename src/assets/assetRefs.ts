import { projectDataSchema, type GrapesProjectData } from '../contract/boltDocument';

/**
 * Imagens privadas no servidor: o documento guarda uma referência estável
 * (`bolt-asset:<caminho no Storage>`), nunca um URL temporário. Para mostrar, a referência
 * é trocada por um URL assinado; ao gravar, o URL volta a ser a referência.
 * As referências podem aparecer como valor inteiro (src de imagem) ou dentro de CSS
 * (`url("bolt-asset:…")` em imagens de fundo).
 */
export const ASSET_REF_PREFIX = 'bolt-asset:';
const REF_PATTERN = /bolt-asset:[A-Za-z0-9._\-/]+/g;

export const isAssetRef = (v: string): boolean => v.startsWith(ASSET_REF_PREFIX);
export const assetRef = (path: string): string => ASSET_REF_PREFIX + path;
export const assetPath = (ref: string): string => ref.slice(ASSET_REF_PREFIX.length);

/** Cópia profunda de dados JSON, trocando strings segundo `swap`. */
export function mapStrings(value: unknown, swap: (s: string) => string | undefined): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) out[k] = walk(child);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Troca, dentro de cada string, as ocorrências das chaves do mapa (valor inteiro ou dentro de url()). */
export function replaceAll(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (!map.size) return value;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  return mapStrings(value, (s) => {
    const whole = map.get(s);
    if (whole !== undefined) return whole;
    let out = s;
    let changed = false;
    for (const k of keys) {
      if (out.includes(k)) {
        out = out.split(k).join(map.get(k) ?? k);
        changed = true;
      }
    }
    return changed ? out : undefined;
  });
}

export function collectAssetRefs(data: unknown): string[] {
  const refs = new Set<string>();
  mapStrings(data, (s) => {
    for (const m of s.matchAll(REF_PATTERN)) refs.add(m[0]);
    return undefined;
  });
  return [...refs];
}

/** Correspondência referência ↔ URL de visualização, válida durante uma sessão de edição. */
export class AssetUrlMap {
  private readonly toUrl = new Map<string, string>();
  private readonly toRef = new Map<string, string>();

  register(ref: string, url: string): void {
    this.toUrl.set(ref, url);
    this.toRef.set(url, ref);
  }

  /** Documento para mostrar: referências trocadas por URLs (as não resolvidas ficam como estão). */
  forDisplay(data: GrapesProjectData): GrapesProjectData {
    return this.toUrl.size ? projectDataSchema.parse(replaceAll(data, this.toUrl)) : data;
  }

  /** Documento para gravar: URLs temporários voltam a ser referências estáveis. */
  forStorage(data: GrapesProjectData): GrapesProjectData {
    return this.toRef.size ? projectDataSchema.parse(replaceAll(data, this.toRef)) : data;
  }
}
