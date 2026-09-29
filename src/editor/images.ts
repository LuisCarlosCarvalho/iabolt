import type { Component, Editor } from 'grapesjs';
import { useState } from 'react';
import type { AssetUrlMap } from '../assets/assetRefs';
import { useServices } from '../app/services';
import { errorMessage } from '../app/ui';
import { IMAGE_PLACEHOLDER } from '../engine/blocks';

/**
 * Lógica de imagens partilhada pelo diálogo de imagem e pelo painel «Imagens»: uma só forma
 * de listar, carregar e validar imagens (mesmo serviço de assets, mesmas referências estáveis).
 */

/** Imagens já usadas na página (derivadas do modelo, sem lista paralela). */
export function pageImages(editor: Editor): string[] {
  const out = new Set<string>();
  const walk = (c: Component) => {
    if (c.is('image')) {
      const src = String(c.get('src') ?? c.getAttributes().src ?? '');
      if (src && src !== IMAGE_PLACEHOLDER) out.add(src);
    }
    c.components().models.forEach(walk);
  };
  const wrapper = editor.getWrapper();
  if (wrapper) walk(wrapper);
  return [...out];
}

/** Endereço https válido (os outros protocolos são recusados). */
export function httpsImageUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error('Endereço inválido.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Use um endereço https://');
  return parsed.toString();
}

/**
 * Carregar uma imagem pelo serviço de assets atual. Devolve o URL para mostrar; a referência
 * estável fica registada no mapa do projeto e é a que se grava.
 */
export function useImageUpload({ projectId, workspaceId, urls }: { projectId: string; workspaceId?: string; urls: AssetUrlMap }) {
  const { assets } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File | undefined): Promise<string | null> => {
    if (!file) return null;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await assets.upload(file, { projectId, ...(workspaceId ? { workspaceId } : {}) });
      // O canvas mostra o URL; a gravação volta a usar a referência estável.
      urls.register(uploaded.stored, uploaded.display);
      return uploaded.display;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { upload, busy, error, setError };
}
