/**
 * Função `ai-admin` (Supabase Edge Function, Deno): painel «Configurações de IA».
 * PARA REVISÃO: não foi publicada.
 *
 * - Todas as ações: sessão → administrador da plataforma (is_platform_admin, pelo papel de serviço).
 * - A chave chega por HTTPS só em «setKey», vai para o Supabase Vault (ai_admin_stage_key) e nunca é
 *   devolvida nem registada. O corpo dos pedidos nunca é escrito nos logs.
 * - O papel de serviço existe só aqui (variável fornecida pelo Supabase); nunca chega ao browser.
 */
import { createClient } from '@supabase/supabase-js';
import { handleAdmin } from '../_shared/ai/admin.ts';
import { anthropicCheck } from '../_shared/ai/provider.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const required = (name: string): string => {
  const v = env(name);
  if (!v) throw new Error(`Configuração em falta: ${name}`);
  return v;
};

const service = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** Chama uma função da base de dados; em erro, lança só o código (a mensagem é mapeada no handler). */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request.headers.get('origin'), env('AI_ALLOWED_ORIGINS'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers });
  const result = await handleAdmin(request.headers.get('authorization'), await request.text(), {
    async getUser(header) {
      const token = header?.replace(/^Bearer\s+/i, '') ?? '';
      if (!token) return null;
      const { data, error } = await service.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async isAdmin(userId) {
      const { data, error } = await service.rpc('is_platform_admin', { p_user_id: userId });
      return !error && data === true;
    },
    get: (actor) => rpc('ai_admin_get', { p_actor: actor }),
    update: (actor, version, patch) => rpc('ai_admin_update', { p_actor: actor, p_expected_version: version, p_patch: patch }),
    async stageKey(actor, key, last4, fingerprint) {
      const id = await rpc('ai_admin_stage_key', { p_actor: actor, p_key: key, p_last4: last4, p_fingerprint: fingerprint });
      if (typeof id !== 'string') throw new Error('stage failed');
      return id;
    },
    activateKey: (actor, secretId) => rpc('ai_admin_activate_key', { p_actor: actor, p_secret_id: secretId }),
    async discardKey(actor, secretId, reason) {
      await rpc('ai_admin_discard_key', { p_actor: actor, p_secret_id: secretId, p_reason: reason });
    },
    removeKey: (actor, version) => rpc('ai_admin_remove_key', { p_actor: actor, p_expected_version: version }),
    recordTest: (actor, ok, detail) => rpc('ai_admin_record_test', { p_actor: actor, p_ok: ok, p_detail: detail }),
    async providerKey() {
      const { data, error } = await service.rpc('ai_provider_key');
      return error || typeof data !== 'string' || !data ? null : data;
    },
    checkKey: (_provider, model, key) => anthropicCheck({ apiKey: key, model, fetch }),
    usage: (actor) => rpc('ai_admin_usage', { p_actor: actor }),
    audit: (actor) => rpc('ai_admin_audit', { p_actor: actor, p_limit: 50 }),
  });
  return json(result.status, result.body, headers);
});
