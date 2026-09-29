import type { AdminDeps, SettingsPatch } from '../../supabase/functions/_shared/ai/admin.ts';
import type { KeyCheck } from '../../supabase/functions/_shared/ai/provider.ts';

/**
 * SIMULAÇÃO LOCAL das Configurações de IA (modo local, sem servidor): implementa as mesmas
 * dependências que a função `ai-admin` usa no Supabase, em memória, com as mesmas regras da base
 * de dados (versão, ativação só com chave válida, chave pendente até ao teste, auditoria sem
 * segredos). Serve para desenvolvimento e testes da interface; nada é gravado nem enviado, e a
 * chave simulada vive só na memória desta página. O teste de ligação é simulado:
 *   chave com «invalida» → recusada pelo «fornecedor»; com «sem-rede» → sem resposta.
 */
const ACTOR = 'local-admin';
const ACTOR_EMAIL = 'administrador local (simulação)';

const MODELS = [
  { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { provider: 'anthropic' as const, model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { provider: 'anthropic' as const, model: 'claude-opus-5-5', label: 'Claude Opus 5.5', prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
];

type KeyStatus = 'none' | 'valid' | 'invalid';

interface State {
  enabled: boolean;
  provider: 'anthropic';
  model: string;
  requests_per_user_day: number;
  requests_per_workspace_day: number;
  max_concurrent_per_user: number;
  max_concurrent_per_workspace: number;
  max_output_tokens: number;
  max_retries: number;
  max_operations: number;
  overhead_tokens: number;
  timeout_ms: number;
  reservation_ttl_seconds: number;
  monthly_budget_usd: number;
  keyId: string | null;
  keyLast4: string | null;
  keyFingerprint: string | null;
  keyStatus: KeyStatus;
  keyTestedAt: string | null;
  keyUpdatedAt: string | null;
  pending: { id: string; last4: string; fingerprint: string } | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

const now = () => new Date().toISOString();

export function createLocalAiAdmin(checkKey?: (key: string) => Promise<KeyCheck>): AdminDeps {
  const state: State = {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    requests_per_user_day: 50,
    requests_per_workspace_day: 300,
    max_concurrent_per_user: 1,
    max_concurrent_per_workspace: 4,
    max_output_tokens: 1500,
    max_retries: 1,
    max_operations: 10,
    overhead_tokens: 1000,
    timeout_ms: 30000,
    reservation_ttl_seconds: 300,
    monthly_budget_usd: 25,
    keyId: null,
    keyLast4: null,
    keyFingerprint: null,
    keyStatus: 'none',
    keyTestedAt: null,
    keyUpdatedAt: null,
    pending: null,
    version: 1,
    updatedAt: now(),
    updatedBy: null,
  };
  /** «Cofre» em memória (só nesta página). */
  const vault = new Map<string, string>();
  const audit: Array<{ at: string; action: string; changes: Record<string, unknown>; actor_email: string | null }> = [];
  const record = (action: string, changes: Record<string, unknown>) => audit.unshift({ at: now(), action, changes, actor_email: ACTOR_EMAIL });

  const assert = (actor: string) => {
    if (actor !== ACTOR) throw new Error('not_admin');
  };
  const checkConstraints = (s: State) => {
    if (s.enabled && !(s.keyId && s.keyStatus === 'valid')) throw new Error('ai_settings_check');
    if (s.timeout_ms * (s.max_retries + 1) + 10000 > 140000) throw new Error('ai_settings_check');
    if (!MODELS.some((m) => m.provider === s.provider && m.model === s.model)) throw new Error('violates foreign key');
  };
  const view = () => ({
    settings: {
      enabled: state.enabled,
      provider: state.provider,
      model: state.model,
      requests_per_user_day: state.requests_per_user_day,
      requests_per_workspace_day: state.requests_per_workspace_day,
      max_concurrent_per_user: state.max_concurrent_per_user,
      max_concurrent_per_workspace: state.max_concurrent_per_workspace,
      max_output_tokens: state.max_output_tokens,
      max_retries: state.max_retries,
      max_operations: state.max_operations,
      overhead_tokens: state.overhead_tokens,
      timeout_ms: state.timeout_ms,
      reservation_ttl_seconds: state.reservation_ttl_seconds,
      monthly_budget_usd: state.monthly_budget_usd,
      key: { configured: state.keyId !== null, last4: state.keyLast4, fingerprint: state.keyFingerprint, status: state.keyStatus, tested_at: state.keyTestedAt, updated_at: state.keyUpdatedAt },
      version: state.version,
      updated_at: state.updatedAt,
      updated_by_email: state.updatedBy,
    },
    models: MODELS,
  });
  const bump = () => {
    state.version += 1;
    state.updatedAt = now();
    state.updatedBy = ACTOR_EMAIL;
  };

  return {
    getUser: async () => ({ id: ACTOR }),
    isAdmin: async (id) => id === ACTOR,
    async get(actor) {
      assert(actor);
      return view();
    },
    async update(actor, expectedVersion, patch: SettingsPatch) {
      assert(actor);
      if (expectedVersion !== state.version) throw new Error('version_conflict');
      const next: State = { ...state, ...patch };
      checkConstraints(next);
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (Reflect.get(state, k) !== v) changes[k] = { de: Reflect.get(state, k), para: v };
      if (Object.keys(changes).length === 0) return view();
      Object.assign(state, patch);
      bump();
      record('update', changes);
      return view();
    },
    async stageKey(actor, key, last4, fingerprint) {
      assert(actor);
      if (state.pending) vault.delete(state.pending.id);
      const id = crypto.randomUUID();
      vault.set(id, key);
      state.pending = { id, last4, fingerprint: fingerprint.slice(0, 16) };
      return id;
    },
    async activateKey(actor, secretId) {
      assert(actor);
      const p = state.pending;
      if (!p || p.id !== secretId) throw new Error('pending_mismatch');
      const old = state.keyId;
      const oldLast4 = state.keyLast4;
      Object.assign(state, { keyId: p.id, keyLast4: p.last4, keyFingerprint: p.fingerprint, keyStatus: 'valid', keyTestedAt: now(), keyUpdatedAt: now(), pending: null });
      if (old) vault.delete(old);
      bump();
      record(old ? 'key_replaced' : 'key_set', { chave: { de: oldLast4 ? `…${oldLast4}` : null, para: `…${p.last4}` } });
      return view();
    },
    async discardKey(actor, secretId, reason) {
      assert(actor);
      const p = state.pending;
      if (!p || p.id !== secretId) return;
      vault.delete(secretId);
      state.pending = null;
      record('key_rejected', { chave: `…${p.last4}`, motivo: reason.slice(0, 200) });
    },
    async removeKey(actor, expectedVersion) {
      assert(actor);
      if (expectedVersion !== state.version) throw new Error('version_conflict');
      const last4 = state.keyLast4;
      if (state.keyId) vault.delete(state.keyId);
      Object.assign(state, { enabled: false, keyId: null, keyLast4: null, keyFingerprint: null, keyStatus: 'none', keyTestedAt: null, keyUpdatedAt: now() });
      bump();
      record('key_removed', { chave: last4 ? `…${last4}` : null, assistente: 'desativado' });
      return view();
    },
    async recordTest(actor, ok, detail) {
      assert(actor);
      if (!state.keyId) throw new Error('no_key');
      const wasEnabled = state.enabled;
      state.keyStatus = ok ? 'valid' : 'invalid';
      if (!ok) state.enabled = false;
      state.keyTestedAt = now();
      state.version += 1;
      record('key_tested', { chave: `…${state.keyLast4 ?? ''}`, resultado: ok ? 'aceite' : 'recusada', detalhe: detail.slice(0, 200), ...(wasEnabled && !ok ? { assistente: 'desativado' } : {}) });
      return view();
    },
    async providerKey() {
      return state.keyId ? (vault.get(state.keyId) ?? null) : null;
    },
    async checkKey(_provider, _model, key) {
      if (checkKey) return checkKey(key);
      await new Promise((r) => setTimeout(r, 150));
      if (key.includes('invalida')) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
      if (key.includes('sem-rede')) return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
      return { ok: true };
    },
    async usage(actor) {
      assert(actor);
      return { month: now().slice(0, 7), requests: 0, confirmed_usd: 0, unknown_usd: 0, reserved_usd: 0, in_flight: 0, unknown_attempts: 0, budget_usd: state.monthly_budget_usd };
    },
    async audit(actor) {
      assert(actor);
      return audit.slice(0, 50);
    },
  };
}

/** Utilizador local simulado (sempre administrador na simulação). */
export const LOCAL_ADMIN_AUTH = 'Bearer simulacao-local';
