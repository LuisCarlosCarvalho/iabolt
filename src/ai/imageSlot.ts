import type { Component } from 'grapesjs';
import { IMAGE_ASPECTS } from '../../supabase/functions/_shared/ai/images.ts';

/**
 * Formato da imagem a gerar a partir do ESPAÇO onde ela vai ficar (medido no canvas), e recorte da
 * imagem gerada para esse formato. Alguns fornecedores só geram quadrados (Cloudflare FLUX.1
 * schnell): sem isto, um espaço vertical recebia uma imagem quadrada pequena (08/10/2026).
 */
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

const RATIO: Record<ImageAspect, number> = { '1:1': 1, '16:9': 16 / 9, '4:3': 4 / 3, '3:4': 3 / 4, '9:16': 9 / 16 };

/** Proporção suportada mais próxima de largura/altura (comparada em escala logarítmica). */
export function nearestAspect(width: number, height: number): ImageAspect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = Math.log(width / height);
  let best: ImageAspect = '1:1';
  for (const a of IMAGE_ASPECTS) if (Math.abs(Math.log(RATIO[a]) - r) < Math.abs(Math.log(RATIO[best]) - r)) best = a;
  return best;
}

/**
 * Caixa do espaço da imagem. Fundo: o próprio elemento. Imagem: o elemento pai quando a imagem é o
 * único conteúdo dele e ele é maior (widget de imagem, coluna, cartão); senão a própria imagem.
 */
export function slotBox(el: Element, kind: 'image' | 'background'): { width: number; height: number } | null {
  const own = el.getBoundingClientRect();
  const box = { width: own.width, height: own.height };
  if (kind === 'image') {
    const parent = el.parentElement;
    if (parent && parent.children.length === 1) {
      const p = parent.getBoundingClientRect();
      if (p.width * p.height > box.width * box.height * 1.2 || box.width * box.height === 0) return p.width > 0 && p.height > 0 ? { width: p.width, height: p.height } : null;
    }
  }
  return box.width > 0 && box.height > 0 ? box : null;
}

/** Proporção do espaço de um componente no canvas (null se não estiver visível). */
export function slotAspect(component: Component | undefined, kind: 'image' | 'background'): ImageAspect | null {
  const el = component?.getEl();
  if (!el) return null;
  const box = slotBox(el, kind);
  return box ? nearestAspect(box.width, box.height) : null;
}

/** Corte central (em píxeis da origem) para passar de `width`×`height` à proporção pedida. */
export function centerCrop(width: number, height: number, aspect: ImageAspect): { sx: number; sy: number; sw: number; sh: number } {
  const target = RATIO[aspect];
  let sw = width;
  let sh = height;
  if (width / height > target) sw = Math.round(height * target);
  else sh = Math.round(width / target);
  return { sx: Math.round((width - sw) / 2), sy: Math.round((height - sh) / 2), sw, sh };
}

/**
 * Recorta a imagem ao centro para a proporção pedida, se o fornecedor devolveu outra (ex.: um
 * quadrado). Sem suporte do browser (ou já na proporção certa), devolve a imagem tal como veio.
 */
export async function cropToAspect(blob: Blob, aspect: ImageAspect): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return blob;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  try {
    if (Math.abs(Math.log(bmp.width / bmp.height / RATIO[aspect])) < 0.03) return blob;
    const c = centerCrop(bmp.width, bmp.height, aspect);
    const canvas = document.createElement('canvas');
    canvas.width = c.sw;
    canvas.height = c.sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, c.sx, c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
    // Mantém o formato da imagem recebida (PNG continua PNG); outro formato passa a JPEG.
    const type = ['image/png', 'image/webp', 'image/jpeg'].includes(blob.type) ? blob.type : 'image/jpeg';
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? blob), type, 0.92));
  } finally {
    bmp.close();
  }
}
