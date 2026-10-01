/**
 * Função `ai-image` (Supabase Edge Function, Deno): gera UMA imagem com o fornecedor/modelo de
 * imagens da configuração central. NÃO publicada; precisa da migração 20261001120000.
 *
 * A imagem volta em base64 para o editor, que só a guarda no armazenamento do workspace (referência
 * permanente) se o utilizador aprovar a proposta. O custo fica registado em ai_usage (tipo
 * «image») mesmo que a imagem seja descartada. Nunca há repetições automáticas pagas.
 */
import { createClient } from '@supabase/supabase-js';
import type { LimitReason } from '../_shared/ai/handler.ts';
import { handleImage } from '../_shared/ai/imageHandler.ts';
import { RuntimeSettings } from '../_shared/ai/limits.ts';
import { makeImageGenerator } from '../_shared/ai/registry.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const required = (name: string): string => {
  const v = env(name);
  if (!v) throw new Error(`Configuração em falta: ${name}`);
  return v;
};

const SUPABASE_URL = required('SUPABASE_URL');
const ANON_KEY = required('SUPABASE_ANON_KEY');
const service = createClient(SUPABASE_URL, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const FORCE_DISABLED = env('AI_FORCE_DISABLED') === 'true';
const REASONS: readonly LimitReason[] = ['disabled', 'config_changed', 'forbidden', 'duplicate', 'user_day', 'workspace_day', 'user_concurrency', 'workspace_concurrency', 'budget'];

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request.headers.get('origin'), env('AI_ALLOWED_ORIGINS'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers });
  const result = await handleImage(request.headers.get('authorization'), await request.text(), {
    forceDisabled: FORCE_DISABLED,
    now: () => Date.now(),
    // Administrador da plataforma: o mesmo critério da função ai-admin (is_platform_admin).
    async isAdmin(userId) {
      const { data, error } = await service.rpc('is_platform_admin', { p_user_id: userId });
      return !error && data === true;
    },
    async getUser(header) {
      const token = header?.replace(/^Bearer\s+/i, '') ?? '';
      if (!token) return null;
      const { data, error } = await service.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async projectWorkspace(header, projectId) {
      const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
      const { data, error } = await asUser.from('projects').select('workspace_id').eq('id', projectId).maybeSingle();
      return error || !data ? null : String(data.workspace_id);
    },
    async loadRuntime() {
      const { data, error } = await service.rpc('ai_runtime_settings');
      if (error || !data) return null;
      const parsed = RuntimeSettings.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    async providerKey(provider) {
      const { data, error } = await service.rpc('ai_provider_key_for', { p_provider: provider });
      return error || typeof data !== 'string' || !data ? null : data;
    },
    makeGenerator: (provider, model, key) => makeImageGenerator(provider, { apiKey: key, model, fetch }),
    async reserve(r) {
      const { data, error } = await service.rpc('ai_reserve', {
        p_request_id: r.requestId,
        p_user_id: r.userId,
        p_workspace_id: r.workspaceId,
        p_project_id: r.projectId,
        p_reserve_usd: r.reserveUsd,
        p_provider: r.provider,
        p_model: r.model,
        p_prices: r.prices,
        p_kind: r.kind,
      });
      if (error) throw new Error('Reserva falhou.');
      const row = Array.isArray(data) ? data[0] : data;
      const reason = row && typeof row === 'object' ? Reflect.get(row, 'reason') : null;
      const id = row && typeof row === 'object' ? Reflect.get(row, 'reservation_id') : null;
      if (typeof id === 'string') return { ok: true, id };
      return { ok: false, reason: REASONS.find((x) => x === reason) ?? 'budget' };
    },
    async settle(id, s) {
      const { error } = await service.rpc('ai_settle', {
        p_id: id,
        p_status: s.status,
        p_input_tokens: s.usage.inputTokens,
        p_output_tokens: s.usage.outputTokens,
        p_cache_read_tokens: s.usage.cacheReadTokens,
        p_cache_write_tokens: s.usage.cacheWriteTokens,
        p_confirmed_cost_usd: s.confirmedCostUsd,
        p_unknown_cost_usd: s.unknownCostUsd,
        p_attempts: s.attempts,
        p_unknown_attempts: s.unknownAttempts,
        p_latency_ms: s.latencyMs,
        p_error: s.error ?? null,
      });
      if (error) console.error('ai_settle falhou');
    },
    async release(id) {
      const { error } = await service.rpc('ai_release', { p_id: id });
      if (error) console.error('ai_release falhou');
    },
  });
  return json(result.status, result.body, headers);
});
