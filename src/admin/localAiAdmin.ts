import type { AdminDeps, AdminModel, SettingsPatch } from '../../supabase/functions/_shared/ai/admin.ts';
import type { ProviderId } from '../../supabase/functions/_shared/ai/ids.ts';
import type { KeyCheck } from '../../supabase/functions/_shared/ai/provider.ts';

/**
 * SIMULAÇÃO LOCAL das Configurações de IA (modo local, sem servidor): implementa as mesmas
 * dependências que a função `ai-admin` usa no Supabase, em memória, com as mesmas regras da base
 * de dados (versão, uma chave por fornecedor, ativação só com chave válida do fornecedor em uso,
 * chave pendente até ao teste, auditoria sem segredos). Nada é gravado nem enviado; as chaves
 * simuladas vivem só na memória desta página. O teste de ligação é simulado:
 *   chave com «invalida» → recusada pelo «fornecedor»; com «sem-rede» → sem resposta.
 */
const ACTOR = 'local-admin';
const ACTOR_EMAIL = 'administrador local (simulação)';

/** Iguais aos modelos SUPORTADOS da migração 20261001120000. */
export const LOCAL_MODELS: AdminModel[] = [
  { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', capability: 'edit', price_image: null, note: null, prices: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', preference: 10, label: 'Claude Sonnet 5.5', capability: 'edit', price_image: null, note: null, prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', capability: 'edit', price_image: null, note: null, prices: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { provider: 'google', model: 'gemini-3.5-flash-lite', preference: 25, label: 'Gemini 3.5 Flash-Lite', capability: 'edit', price_image: null, note: null, prices: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.3 } },
  { provider: 'google', model: 'gemini-3.8-flash', preference: 30, label: 'Gemini 3.8 Flash', capability: 'edit', price_image: null, note: 'Preço a partir de 01/01/2027 (até lá 0,75/3,75): a reserva usa o mais alto.', prices: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 } },
  { provider: 'google', model: 'gemini-3.1-flash-image', preference: 10, label: 'Gemini 3.1 Flash Image', capability: 'image', price_image: 0.067, note: 'Imagem 1K: 0,067 USD.', prices: { input: 0.5, output: 3, cacheRead: 0, cacheWrite: 0.5 } },
  { provider: 'google', model: 'gemini-3-pro-image', preference: 20, label: 'Gemini 3 Pro Image', capability: 'image', price_image: 0.134, note: 'Imagem 1K/2K: 0,134 USD.', prices: { input: 2, output: 12, cacheRead: 0, cacheWrite: 2 } },
  { provider: 'openai', model: 'gpt-6-luna', label: 'GPT-6 Luna', capability: 'edit', price_image: null, note: null, prices: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.1 } },
  { provider: 'openai', model: 'gpt-6.1-sol', preference: 20, label: 'GPT-6.1 Sol', capability: 'edit', price_image: null, note: 'Preços de contexto curto; pedidos do assistente ficam muito abaixo do limite de contexto longo.', prices: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2 } },
  { provider: 'openai', model: 'gpt-6-astra', label: 'GPT-6 Astra', capability: 'edit', price_image: null, note: null, prices: { input: 10, output: 50, cacheRead: 1, cacheWrite: 10 } },
  {
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-1-schnell',
    preference: 1,
    label: 'FLUX.1 schnell (Cloudflare)',
    capability: 'image',
    price_image: 0.001,
    note: 'Grátis até 10 000 neurons por dia (cerca de 170 imagens); acima disso, cerca de 0,0006 USD por imagem no plano pago. Imagens quadradas (1024 px).',
    prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

type KeyStatus = 'none' | 'valid' | 'invalid';

interface KeyState {
  id: string | null;
  last4: string | null;
  fingerprint: string | null;
  status: KeyStatus;
  testedAt: string | null;
  updatedAt: string | null;
  pending: { id: string; last4: string; fingerprint: string } | null;
  /** O administrador ativou o fornecedor. */
  enabled: boolean;
}

interface Settings {
  enabled: boolean;
  provider: ProviderId;
  model: string;
  image_enabled: boolean;
  image_provider: ProviderId | null;
  image_model: string | null;
  image_requests_per_user_day: number;
  max_parts: number;
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
}

const now = () => new Date().toISOString();
const emptyKey = (): KeyState => ({ id: null, last4: null, fingerprint: null, status: 'none', testedAt: null, updatedAt: null, pending: null, enabled: false });

export function createLocalAiAdmin(checkKey?: (key: string, provider: ProviderId) => Promise<KeyCheck>): AdminDeps {
  const settings: Settings = {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    image_enabled: false,
    image_provider: null,
    image_model: null,
    image_requests_per_user_day: 10,
    max_parts: 6,
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
  };
  const keys: Record<ProviderId, KeyState> = { anthropic: emptyKey(), openai: emptyKey(), google: emptyKey(), cloudflare: emptyKey() };
  const meta = { version: 1, updatedAt: now(), updatedBy: null as string | null };
  /** «Cofre» em memória (só nesta página). */
  const vault = new Map<string, string>();
  const audit: Array<{ at: string; action: string; changes: Record<string, unknown>; actor_email: string | null }> = [];
  const record = (action: string, changes: Record<string, unknown>) => audit.unshift({ at: now(), action, changes, actor_email: ACTOR_EMAIL });

  const assert = (actor: string) => {
    if (actor !== ACTOR) throw new Error('not_admin');
  };
  /** As mesmas regras do gatilho ai__check_settings e das restrições da tabela. */
  const checkConstraints = (s: Settings) => {
    const edit = LOCAL_MODELS.find((m) => m.provider === s.provider && m.model === s.model);
    if (!edit || edit.capability !== 'edit') throw new Error('ai_settings_check');
    if (s.image_model !== null) {
      const img = LOCAL_MODELS.find((m) => m.provider === s.image_provider && m.model === s.image_model);
      if (!img || img.capability !== 'image') throw new Error('ai_settings_check');
    }
    if (s.enabled && keys[s.provider].status !== 'valid') throw new Error('ai_settings_check');
    if (s.image_enabled && (!s.image_provider || !s.image_model || keys[s.image_provider].status !== 'valid')) throw new Error('ai_settings_check');
    if (s.timeout_ms * (s.max_retries + 1) + 10000 > 140000) throw new Error('ai_settings_check');
  };
  const keyView = (k: KeyState) => ({ configured: k.id !== null, last4: k.last4, fingerprint: k.fingerprint, status: k.status, tested_at: k.testedAt, updated_at: k.updatedAt, enabled: k.enabled });
  /** Igual a ai__route(): o melhor modelo de cada função entre os fornecedores ativos com chave válida. */
  const route = () => {
    const best = (cap: 'edit' | 'image') =>
      LOCAL_MODELS.filter((m) => m.capability === cap && typeof m.preference === 'number' && keys[m.provider].enabled && keys[m.provider].status === 'valid').sort((a, b) => (a.preference ?? 0) - (b.preference ?? 0))[0];
    const edit = best('edit');
    const image = best('image');
    settings.enabled = !!edit;
    if (edit) Object.assign(settings, { provider: edit.provider, model: edit.model });
    settings.image_enabled = !!image;
    if (image) Object.assign(settings, { image_provider: image.provider, image_model: image.model });
  };
  const view = () => ({
    settings: {
      ...settings,
      keys: { anthropic: keyView(keys.anthropic), openai: keyView(keys.openai), google: keyView(keys.google), cloudflare: keyView(keys.cloudflare) },
      version: meta.version,
      updated_at: meta.updatedAt,
      updated_by_email: meta.updatedBy,
    },
    models: LOCAL_MODELS,
  });
  const bump = () => {
    meta.version += 1;
    meta.updatedAt = now();
    meta.updatedBy = ACTOR_EMAIL;
  };
  const disableUsersOf = (provider: ProviderId) => {
    const out: Record<string, string> = {};
    if (settings.provider === provider && settings.enabled) {
      settings.enabled = false;
      out.assistente = 'desativado';
    }
    if (settings.image_provider === provider && settings.image_enabled) {
      settings.image_enabled = false;
      out.imagens = 'desativadas';
    }
    return out;
  };

  return {
    // Modo local: sem fornecedor real, não há diagnóstico (o servidor é que o faz).
    diagnose: async () => {
      throw new Error('diagnose_local');
    },
    getUser: async () => ({ id: ACTOR }),
    isAdmin: async (id) => id === ACTOR,
    async get(actor) {
      assert(actor);
      return view();
    },
    async update(actor, expectedVersion, patch: SettingsPatch) {
      assert(actor);
      if (expectedVersion !== meta.version) throw new Error('version_conflict');
      const next: Settings = { ...settings, ...patch };
      checkConstraints(next);
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (Reflect.get(settings, k) !== v) changes[k] = { de: Reflect.get(settings, k), para: v };
      if (Object.keys(changes).length === 0) return view();
      Object.assign(settings, next);
      // Como o gatilho ai__sync_enabled: ligar por este caminho marca o fornecedor como ativo.
      let marked = false;
      if (patch.enabled === true && !keys[settings.provider].enabled) marked = keys[settings.provider].enabled = true;
      if (patch.image_enabled === true && settings.image_provider && !keys[settings.image_provider].enabled) marked = keys[settings.image_provider].enabled = true;
      if (marked) route();
      bump();
      record('update', changes);
      return view();
    },
    async stageKey(actor, provider, key, last4, fingerprint) {
      assert(actor);
      const k = keys[provider];
      if (k.pending) vault.delete(k.pending.id);
      const id = crypto.randomUUID();
      vault.set(id, key);
      k.pending = { id, last4, fingerprint: fingerprint.slice(0, 16) };
      return id;
    },
    async activateKey(actor, provider, secretId) {
      assert(actor);
      const k = keys[provider];
      const p = k.pending;
      if (!p || p.id !== secretId) throw new Error('pending_mismatch');
      const old = k.id;
      const oldLast4 = k.last4;
      Object.assign(k, { id: p.id, last4: p.last4, fingerprint: p.fingerprint, status: 'valid', testedAt: now(), updatedAt: now(), pending: null });
      if (old) vault.delete(old);
      route();
      bump();
      record(old ? 'key_replaced' : 'key_set', { fornecedor: provider, chave: { de: oldLast4 ? `…${oldLast4}` : null, para: `…${p.last4}` } });
      return view();
    },
    async discardKey(actor, provider, secretId, reason) {
      assert(actor);
      const k = keys[provider];
      const p = k.pending;
      if (!p || p.id !== secretId) return;
      vault.delete(secretId);
      k.pending = null;
      record('key_rejected', { fornecedor: provider, chave: `…${p.last4}`, motivo: reason.slice(0, 200) });
    },
    async removeKey(actor, provider, expectedVersion) {
      assert(actor);
      if (expectedVersion !== meta.version) throw new Error('version_conflict');
      const k = keys[provider];
      const last4 = k.last4;
      const disabled = disableUsersOf(provider);
      if (k.id) vault.delete(k.id);
      Object.assign(k, { id: null, last4: null, fingerprint: null, status: 'none', testedAt: null, updatedAt: now() });
      route();
      bump();
      record('key_removed', { fornecedor: provider, chave: last4 ? `…${last4}` : null, ...disabled });
      return view();
    },
    async recordTest(actor, provider, ok, detail) {
      assert(actor);
      const k = keys[provider];
      if (!k.id) throw new Error('no_key');
      const disabled = ok ? {} : disableUsersOf(provider);
      k.status = ok ? 'valid' : 'invalid';
      k.testedAt = now();
      route();
      bump();
      record('key_tested', { fornecedor: provider, chave: `…${k.last4 ?? ''}`, resultado: ok ? 'aceite' : 'recusada', detalhe: detail.slice(0, 200), ...disabled });
      return view();
    },
    async setEnabled(actor, provider, enabled) {
      assert(actor);
      const k = keys[provider];
      if (enabled && k.status !== 'valid') throw new Error('key_not_valid');
      k.enabled = enabled;
      route();
      bump();
      record(enabled ? 'provider_enabled' : 'provider_disabled', {
        fornecedor: provider,
        edição: settings.enabled ? `${settings.provider} · ${settings.model}` : 'desativada',
        imagens: settings.image_enabled ? `${settings.image_provider ?? ''} · ${settings.image_model ?? ''}` : 'desativadas',
      });
      return view();
    },
    async providerKey(provider) {
      const id = keys[provider].id;
      return id ? (vault.get(id) ?? null) : null;
    },
    async checkKey(provider, _model, key) {
      if (checkKey) return checkKey(key, provider);
      await new Promise((r) => setTimeout(r, 150));
      if (key.includes('invalida')) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
      if (key.includes('sem-rede')) return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
      return { ok: true, formatChecked: provider === 'anthropic' };
    },
    async usage(actor) {
      assert(actor);
      return { month: now().slice(0, 7), requests: 0, confirmed_usd: 0, unknown_usd: 0, reserved_usd: 0, in_flight: 0, unknown_attempts: 0, image_usd: 0, budget_usd: settings.monthly_budget_usd };
    },
    async generation(actor) {
      assert(actor);
      return [];
    },
    async audit(actor) {
      assert(actor);
      return audit.slice(0, 50);
    },
  };
}

/** Utilizador local simulado (sempre administrador na simulação). */
export const LOCAL_ADMIN_AUTH = 'Bearer simulacao-local';
