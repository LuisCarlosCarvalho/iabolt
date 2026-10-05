import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  AdminAuditEntry,
  AdminDiagnosis,
  AdminGeneration,
  AdminUsage,
  AdminView,
  adminEnvelope,
  handleAdmin,
  type AdminBody,
  type AdminRequest,
  type AdminResult,
} from '../../supabase/functions/_shared/ai/admin.ts';
import { createLocalAiAdmin, LOCAL_ADMIN_AUTH } from './localAiAdmin';

/**
 * Cliente do painel «Configurações de IA». Em modo servidor fala com a função `ai-admin` (que
 * verifica o administrador em cada ação) e com `ai_whoami`/`ai_status` (sem segredos). Em modo local
 * usa a simulação em memória, com a mesma lógica da função.
 */
/**
 * Estado público do assistente (sem segredos). `pricing` permite mostrar o custo máximo estimado
 * ANTES de enviar (o servidor volta a calcular e a reservar). `image`: geração de imagens.
 */
export interface AiStatus {
  enabled: boolean;
  modelLabel: string | null;
  provider?: string | null;
  /** `priceUsd` só chega a administradores (NULL para os outros, também no servidor). */
  image?: { enabled: boolean; label: string | null; priceUsd: number | null; provider?: string | null; model?: string | null };
  pricing?: { prices: { input: number; output: number; cacheRead: number; cacheWrite: number }; maxOutputTokens: number; overheadTokens: number; maxRetries: number; maxParts: number };
}

const StatusRow = z.object({
  enabled: z.boolean(),
  provider: z.string().nullable().optional(),
  model_label: z.string().nullable().optional(),
  image_enabled: z.boolean().nullable().optional(),
  image_label: z.string().nullable().optional(),
  image_provider: z.string().nullable().optional(),
  image_model: z.string().nullable().optional(),
  image_price_usd: z.coerce.number().nullable().optional(),
  prices: z.object({ input: z.coerce.number(), output: z.coerce.number(), cacheRead: z.coerce.number(), cacheWrite: z.coerce.number() }).nullable().optional(),
  max_output_tokens: z.coerce.number().nullable().optional(),
  overhead_tokens: z.coerce.number().nullable().optional(),
  max_retries: z.coerce.number().nullable().optional(),
  max_parts: z.coerce.number().nullable().optional(),
});

/** Linha de `ai_status` → estado; campos ausentes (servidor antigo) ficam sem estimativa. */
export function parseStatus(raw: unknown): AiStatus {
  const r = StatusRow.safeParse(raw);
  if (!r.success) return { enabled: false, modelLabel: null };
  const s = r.data;
  const pricing =
    s.prices && s.max_output_tokens != null && s.overhead_tokens != null && s.max_retries != null
      ? { prices: s.prices, maxOutputTokens: s.max_output_tokens, overheadTokens: s.overhead_tokens, maxRetries: s.max_retries, maxParts: s.max_parts ?? 1 }
      : undefined;
  return {
    enabled: s.enabled,
    modelLabel: s.model_label ?? null,
    provider: s.provider ?? null,
    image: { enabled: s.image_enabled === true, label: s.image_label ?? null, priceUsd: s.image_price_usd ?? null, provider: s.image_provider ?? null, model: s.image_model ?? null },
    ...(pricing ? { pricing } : {}),
  };
}

export interface AiAdminClient {
  /** Simulação local (sem servidor): a interface di-lo. */
  readonly simulated: boolean;
  /** Só para mostrar ou esconder a entrada; a autorização real é feita no servidor. */
  isAdmin(): Promise<boolean>;
  send(req: AdminRequest): Promise<AdminResult>;
  status(): Promise<AiStatus>;
}

const AdminBodySchema = z.object({
  view: AdminView.optional(),
  usage: AdminUsage.optional(),
  generation: AdminGeneration.optional(),
  audit: z.array(AdminAuditEntry).optional(),
  test: z.object({ ok: z.boolean(), definitive: z.boolean(), message: z.string(), cost: z.string() }).optional(),
  diagnosis: AdminDiagnosis.optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
});

function parseBody(raw: unknown): AdminBody {
  const r = AdminBodySchema.safeParse(raw);
  return r.success ? r.data : { error: 'Resposta inesperada do servidor.', code: 'bad_response' };
}

export class ServerAiAdminClient implements AiAdminClient {
  readonly simulated = false;
  constructor(private readonly client: SupabaseClient) {}

  async isAdmin(): Promise<boolean> {
    const { data, error } = await this.client.rpc('ai_whoami');
    return !error && data === true;
  }

  async send(req: AdminRequest): Promise<AdminResult> {
    const { data, error } = await this.client.functions.invoke('ai-admin', { body: adminEnvelope(req) });
    if (!error) return { status: 200, body: parseBody(data) };
    const ctx: unknown = Reflect.get(error, 'context');
    if (ctx instanceof Response) return { status: ctx.status, body: parseBody(await ctx.json().catch(() => null)) };
    return { status: 503, body: { error: 'Não foi possível contactar o servidor. Nada foi alterado.', code: 'network' } };
  }

  async status(): Promise<AiStatus> {
    // v2 (com imagens e preços); se a migração nova ainda não existir, o estado v1.
    const v2 = await this.client.rpc('ai_status_v2');
    const { data, error } = v2.error ? await this.client.rpc('ai_status') : v2;
    const row: unknown = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row !== 'object') return { enabled: false, modelLabel: null };
    return parseStatus(row);
  }
}

/**
 * Modo local (sem servidor, sem segurança): papel e imagens SIMULADOS para testar a interface.
 * `bolt-local-papel = utilizador` → utilizador comum; `bolt-local-imagens = desligadas` → geração
 * de imagens não configurada. Não protege nada: a proteção real é a do servidor.
 */
export const LOCAL_ROLE_KEY = 'bolt-local-papel';
export const LOCAL_IMAGES_KEY = 'bolt-local-imagens';
function localSetting(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class LocalAiAdminClient implements AiAdminClient {
  readonly simulated = true;
  private readonly deps = createLocalAiAdmin();

  async isAdmin(): Promise<boolean> {
    return localSetting(LOCAL_ROLE_KEY) !== 'utilizador';
  }

  async send(req: AdminRequest): Promise<AdminResult> {
    const r = await handleAdmin(LOCAL_ADMIN_AUTH, JSON.stringify(adminEnvelope(req)), this.deps);
    return { status: r.status, body: parseBody(r.body) };
  }

  /** O assistente local usa sempre o simulador (não depende destas configurações), também para imagens. */
  async status(): Promise<AiStatus> {
    const admin = await this.isAdmin();
    if (localSetting(LOCAL_IMAGES_KEY) === 'desligadas') return { enabled: true, modelLabel: null, image: { enabled: false, label: null, priceUsd: null, provider: null, model: null } };
    return { enabled: true, modelLabel: null, image: { enabled: true, label: 'Simulador de imagens', priceUsd: admin ? 0 : null, provider: 'simulador', model: 'simulador' } };
  }
}
