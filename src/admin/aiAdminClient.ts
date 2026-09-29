import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  AdminAuditEntry,
  AdminUsage,
  AdminView,
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
export interface AiStatus {
  enabled: boolean;
  modelLabel: string | null;
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
  audit: z.array(AdminAuditEntry).optional(),
  test: z.object({ ok: z.boolean(), definitive: z.boolean(), message: z.string(), cost: z.string() }).optional(),
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
    const { data, error } = await this.client.functions.invoke('ai-admin', { body: req });
    if (!error) return { status: 200, body: parseBody(data) };
    const ctx: unknown = Reflect.get(error, 'context');
    if (ctx instanceof Response) return { status: ctx.status, body: parseBody(await ctx.json().catch(() => null)) };
    return { status: 503, body: { error: 'Não foi possível contactar o servidor. Nada foi alterado.', code: 'network' } };
  }

  async status(): Promise<AiStatus> {
    const { data, error } = await this.client.rpc('ai_status');
    const row: unknown = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row !== 'object') return { enabled: false, modelLabel: null };
    const label = Reflect.get(row, 'model_label');
    return { enabled: Reflect.get(row, 'enabled') === true, modelLabel: typeof label === 'string' ? label : null };
  }
}

export class LocalAiAdminClient implements AiAdminClient {
  readonly simulated = true;
  private readonly deps = createLocalAiAdmin();

  async isAdmin(): Promise<boolean> {
    return true;
  }

  async send(req: AdminRequest): Promise<AdminResult> {
    const r = await handleAdmin(LOCAL_ADMIN_AUTH, JSON.stringify(req), this.deps);
    return { status: r.status, body: parseBody(r.body) };
  }

  /** O assistente local usa sempre o simulador (não depende destas configurações). */
  async status(): Promise<AiStatus> {
    return { enabled: true, modelLabel: null };
  }
}
