import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistenceMode } from '../persistence/repository';

/** Destino das imagens carregadas pelo utilizador. Mesmo modo que o repositório de projetos. */
export interface AssetStore {
  readonly mode: PersistenceMode;
  upload(file: File, ctx: { projectId: string; workspaceId?: string }): Promise<{ src: string; name: string }>;
}

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Lado maior depois de reduzir. Evita imagens de câmara com dezenas de MB no projeto. */
const MAX_SIDE = 1600;

export function validateImage(file: File): void {
  if (!ACCEPTED_IMAGE_TYPES.some((t) => t === file.type)) {
    throw new Error('Formato não suportado. Use PNG, JPEG, WebP, GIF ou AVIF.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('A imagem tem mais de 8 MB. Reduza-a antes de a carregar.');
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Leitura da imagem falhou.')));
    reader.onerror = () => reject(reader.error ?? new Error('Leitura da imagem falhou.'));
    reader.readAsDataURL(blob);
  });
}

/** Reduz imagens grandes (exceto GIF, que pode ser animado). */
async function downscale(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/webp', 0.86));
}

/**
 * Modo local: a imagem fica embutida no documento do projeto (data URL), neste browser.
 * Não é enviada para nenhum servidor.
 */
export class LocalAssetStore implements AssetStore {
  readonly mode = 'local' as const;

  async upload(file: File): Promise<{ src: string; name: string }> {
    validateImage(file);
    return { src: await readAsDataUrl(await downscale(file)), name: file.name };
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Modo servidor: Supabase Storage, bucket `project-assets`, pasta do workspace (RLS). */
export class SupabaseAssetStore implements AssetStore {
  readonly mode = 'server' as const;

  constructor(private readonly client: SupabaseClient) {}

  async upload(file: File, ctx: { projectId: string; workspaceId?: string }): Promise<{ src: string; name: string }> {
    validateImage(file);
    if (!ctx.workspaceId) throw new Error('Workspace do projeto desconhecido: não é possível carregar a imagem.');
    const blob = await downscale(file);
    const type = blob.type || file.type;
    const path = `${ctx.workspaceId}/${ctx.projectId}/${crypto.randomUUID()}.${EXT[type] ?? 'bin'}`;
    const { error } = await this.client.storage.from('project-assets').upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(`Falha ao carregar a imagem: ${error.message}`);
    return { src: this.client.storage.from('project-assets').getPublicUrl(path).data.publicUrl, name: file.name };
  }
}
