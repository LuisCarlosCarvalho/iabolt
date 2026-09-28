import type { GrapesProjectData } from '../contract/boltDocument';
import { AssetUrlMap, collectAssetRefs } from './assetRefs';
import type { AssetStore } from './assetStore';

/** Troca as referências de imagens privadas por URLs de visualização (e devolve a correspondência). */
export async function resolveForDisplay(assets: AssetStore, data: GrapesProjectData): Promise<{ data: GrapesProjectData; urls: AssetUrlMap }> {
  const urls = new AssetUrlMap();
  const refs = collectAssetRefs(data);
  if (refs.length > 0) {
    for (const [ref, url] of await assets.resolve(refs)) urls.register(ref, url);
  }
  return { data: urls.forDisplay(data), urls };
}
