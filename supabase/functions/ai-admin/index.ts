/**
 * Função `ai-admin` (Supabase Edge Function, Deno): painel «Configurações de IA».
 * Esta versão (v2, vários fornecedores) precisa da migração 20261001120000. Pedidos com `api: 2` vêm
 * do painel atual; os restantes, do painel anterior (frontend v1), e seguem pela lógica v1 congelada
 * (compatV1.ts), com as funções SQL v1 que a migração mantém. Assim a publicação não tem janela de quebra.
 *
 * - Todas as ações: sessão → administrador da plataforma (is_platform_admin, pelo papel de serviço).
 * - A chave chega por HTTPS só em «setKey», vai para o Supabase Vault e nunca é devolvida nem
 *   registada. O corpo dos pedidos nunca é escrito nos logs.
 * - O papel de serviço existe só aqui (variável fornecida pelo Supabase); nunca chega ao browser.
 */
import { createClient } from '@supabase/supabase-js';
import type { AdminDeps } from '../_shared/ai/admin.ts';
import type { AdminDeps as AdminDepsV1 } from '../_shared/ai/adminV1.ts';
import { handleAdminAny } from '../_shared/ai/compatV1.ts';
import type { ProviderId } from '../_shared/ai/ids.ts';
import { checkProviderKey } from '../_shared/ai/registry.ts';
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

async function getUser(header: string | null): Promise<{ id: string } | null> {
  const token = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return null;
  const { data, error } = await service.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await service.rpc('is_platform_admin', { p_user_id: userId });
  return !error && data === true;
}

async function providerKey(provider: ProviderId): Promise<string | null> {
  const { data, error } = await service.rpc('ai_provider_key_for', { p_provider: provider });
  return error || typeof data !== 'string' || !data ? null : data;
}

/** Painel atual (v2): funções SQL _v2, com fornecedor. */
const v2: AdminDeps = {
  getUser,
  isAdmin,
  get: (actor) => rpc('ai_admin_get_v2', { p_actor: actor }),
  update: (actor, version, patch) => rpc('ai_admin_update_v2', { p_actor: actor, p_expected_version: version, p_patch: patch }),
  async stageKey(actor, provider, key, last4, fingerprint) {
    const id = await rpc('ai_admin_stage_key_v2', { p_actor: actor, p_provider: provider, p_key: key, p_last4: last4, p_fingerprint: fingerprint });
    if (typeof id !== 'string') throw new Error('stage failed');
    return id;
  },
  activateKey: (actor, provider, secretId) => rpc('ai_admin_activate_key_v2', { p_actor: actor, p_provider: provider, p_secret_id: secretId }),
  async discardKey(actor, provider, secretId, reason) {
    await rpc('ai_admin_discard_key_v2', { p_actor: actor, p_provider: provider, p_secret_id: secretId, p_reason: reason });
  },
  removeKey: (actor, provider, version) => rpc('ai_admin_remove_key_v2', { p_actor: actor, p_provider: provider, p_expected_version: version }),
  recordTest: (actor, provider, ok, detail) => rpc('ai_admin_record_test_v2', { p_actor: actor, p_provider: provider, p_ok: ok, p_detail: detail }),
  setEnabled: (actor, provider, enabled) => rpc('ai_admin_set_provider_enabled_v2', { p_actor: actor, p_provider: provider, p_enabled: enabled }),
  providerKey,
  checkKey: (provider, model, key, kind) => checkProviderKey(provider, { apiKey: key, model, kind, fetch }),
  usage: (actor) => rpc('ai_admin_usage', { p_actor: actor }),
  generation: (actor) => rpc('ai_admin_generation', { p_actor: actor }),
  audit: (actor) => rpc('ai_admin_audit', { p_actor: actor, p_limit: 50 }),
};

/** Painel anterior (v1, durante a transição): funções SQL v1 mantidas pela migração (chave Anthropic). */
const v1: AdminDepsV1 = {
  getUser,
  isAdmin,
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
  providerKey: () => providerKey('anthropic'),
  checkKey: (_provider, model, key) => checkProviderKey('anthropic', { apiKey: key, model, kind: 'edit', fetch }),
  usage: (actor) => rpc('ai_admin_usage', { p_actor: actor }),
  audit: (actor) => rpc('ai_admin_audit', { p_actor: actor, p_limit: 50 }),
};

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request.headers.get('origin'), env('AI_ALLOWED_ORIGINS'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers });
  const result = await handleAdminAny(request.headers.get('authorization'), await request.text(), v2, v1);
  return json(result.status, result.body, headers);
});
