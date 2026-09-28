import { projectDataSchema, type GrapesProjectData } from '../contract/boltDocument';

/**
 * Imagens privadas no servidor: o documento guarda uma referência estável
 * (`bolt-asset:<caminho no Storage>`), nunca um URL temporário. Para mostrar, a referência
 * é trocada por um URL assinado; ao gravar, o URL volta a ser a referência.
 */
export const ASSET_REF_PREFIX = 'bolt-asset:';

export const isAssetRef = (v: string): boolean => v.startsWith(ASSET_REF_PREFIX);
export const assetRef = (path: string): string => ASSET_REF_PREFIX + path;
export const assetPath = (ref: string): string => ref.slice(ASSET_REF_PREFIX.length);

/** Cópia profunda de dados JSON, trocando strings exatas segundo `swap`. */
function mapStrings(value: unknown, swap: (s: string) => string | undefined): unknown {
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

export function collectAssetRefs(data: unknown): string[] {
  const refs = new Set<string>();
  mapStrings(data, (s) => {
    if (isAssetRef(s)) refs.add(s);
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
    return this.toUrl.size ? projectDataSchema.parse(mapStrings(data, (s) => this.toUrl.get(s))) : data;
  }

  /** Documento para gravar: URLs temporários voltam a ser referências estáveis. */
  forStorage(data: GrapesProjectData): GrapesProjectData {
    return this.toRef.size ? projectDataSchema.parse(mapStrings(data, (s) => this.toRef.get(s))) : data;
  }
}
