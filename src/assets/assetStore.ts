import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistenceMode } from '../persistence/repository';
import { assetPath, assetRef, isAssetRef } from './assetRefs';

export interface UploadedAsset {
  /** O que fica gravado no documento. */
  stored: string;
  /** O que o browser usa para mostrar agora (igual a `stored` no modo local). */
  display: string;
  name: string;
}

/** Destino das imagens carregadas pelo utilizador. Mesmo modo que o repositório de projetos. */
export interface AssetStore {
  readonly mode: PersistenceMode;
  upload(file: File, ctx?: { projectId?: string; workspaceId?: string }): Promise<UploadedAsset>;
  /** URLs para mostrar referências guardadas. As que não é possível resolver ficam de fora. */
  resolve(refs: readonly string[]): Promise<Map<string, string>>;
}

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Lado maior depois de reduzir. Evita imagens de câmara com dezenas de MB no projeto. */
const MAX_SIDE = 1600;

export function validateImage(file: Blob): void {
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

/** Reduz imagens grandes (exceto GIF, que pode ser animado). Sem canvas (ex.: Node), mantém o original. */
async function downscale(file: Blob): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
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

  async upload(file: File): Promise<UploadedAsset> {
    validateImage(file);
    const dataUrl = await readAsDataUrl(await downscale(file));
    return { stored: dataUrl, display: dataUrl, name: file.name };
  }

  async resolve(): Promise<Map<string, string>> {
    return new Map();
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Validade dos URLs assinados: cobre uma sessão de edição longa. */
export const SIGNED_URL_SECONDS = 12 * 60 * 60;
export const ASSET_BUCKET = 'project-assets';

/**
 * Modo servidor: Supabase Storage, bucket PRIVADO `project-assets`, pasta do workspace (RLS).
 * O documento guarda `bolt-asset:<caminho>`; para mostrar, pede URLs assinados (só quem é
 * membro do workspace os consegue obter).
 *
 * Propriedade e duração: cada ficheiro pertence ao WORKSPACE (`<workspace>/library/<uuid>`),
 * não a um projeto. Arquivar ou remover um projeto não apaga imagens, por isso templates e
 * projetos derivados que as referenciam continuam a mostrá-las. (Ficheiros antigos em
 * `<workspace>/<projeto>/…` continuam válidos.)
 */
export class SupabaseAssetStore implements AssetStore {
  readonly mode = 'server' as const;

  constructor(private readonly client: SupabaseClient) {}

  private workspace: Promise<string> | null = null;

  /** Workspace pessoal do utilizador (o primeiro onde é owner/editor). */
  private defaultWorkspace(): Promise<string> {
    this.workspace ??= (async () => {
      const { data, error } = await this.client.from('workspace_members').select('workspace_id, role, created_at').in('role', ['owner', 'editor']).order('created_at').limit(1);
      const row: unknown = Array.isArray(data) ? data[0] : undefined;
      const id = row && typeof row === 'object' && 'workspace_id' in row && typeof row.workspace_id === 'string' ? row.workspace_id : undefined;
      if (error || !id) {
        this.workspace = null;
        throw new Error(`Não foi possível identificar o workspace para guardar a imagem${error ? `: ${error.message}` : '.'}`);
      }
      return id;
    })();
    return this.workspace;
  }

  async upload(file: File, ctx: { projectId?: string; workspaceId?: string } = {}): Promise<UploadedAsset> {
    validateImage(file);
    const workspaceId = ctx.workspaceId ?? (await this.defaultWorkspace());
    const blob = await downscale(file);
    const type = blob.type || file.type;
    const path = `${workspaceId}/library/${crypto.randomUUID()}.${EXT[type] ?? 'bin'}`;
    const { error } = await this.client.storage.from(ASSET_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw new Error(`Falha ao carregar a imagem: ${error.message}`);
    const ref = assetRef(path);
    const display = (await this.resolve([ref])).get(ref);
    if (!display) throw new Error('A imagem foi carregada, mas o servidor não devolveu um endereço para a mostrar.');
    return { stored: ref, display, name: file.name };
  }

  async resolve(refs: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const own = refs.filter(isAssetRef);
    if (own.length === 0) return out;
    const { data, error } = await this.client.storage.from(ASSET_BUCKET).createSignedUrls(own.map(assetPath), SIGNED_URL_SECONDS);
    if (error) throw new Error(`Não foi possível obter as imagens do projeto: ${error.message}`);
    for (const item of data) {
      if (!item.error && item.signedUrl && item.path) out.set(assetRef(item.path), item.signedUrl);
    }
    return out;
  }
}
