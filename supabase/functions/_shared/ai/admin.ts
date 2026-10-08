import { z } from 'zod';
import { PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from './ids.ts';
import type { KeyCheck } from './provider.ts';

/**
 * Lógica da função `ai-admin` (painel «Configurações de IA»), independente do Deno.
 * Em TODAS as ações: sessão válida → administrador da plataforma (verificado no servidor, pela
 * tabela platform_admins; nunca pelo email nem por algo vindo do browser) → ação.
 * Cada fornecedor tem a sua chave. Uma chave só entra (setKey) e nenhuma resposta a devolve. Uma
 * chave nova fica pendente, é testada sem custo e só substitui a ativa desse fornecedor se ele a
 * aceitar. Trocar de fornecedor não apaga as outras chaves.
 */

// ---------------------------------------------------------------- contrato (partilhado com o painel)

const num = z.coerce.number().finite();
const int = z.coerce.number().int();
const Provider = z.enum(PROVIDER_IDS);

/** Fornecedores com adaptador implementado (os únicos que o painel mostra). */
export const SUPPORTED_PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = PROVIDER_IDS.map((id) => ({ id, label: PROVIDER_LABEL[id] }));

export const SettingsPatch = z
  .object({
    enabled: z.boolean(),
    provider: Provider,
    model: z.string().min(1).max(80),
    image_enabled: z.boolean(),
    image_provider: Provider.nullable(),
    image_model: z.string().min(1).max(80).nullable(),
    image_requests_per_user_day: int.min(1).max(200),
    max_parts: int.min(1).max(20),
    requests_per_user_day: int.min(1).max(1000),
    requests_per_workspace_day: int.min(1).max(10000),
    max_concurrent_per_user: int.min(1).max(5),
    max_concurrent_per_workspace: int.min(1).max(50),
    max_output_tokens: int.min(100).max(16000),
    max_retries: int.min(0).max(2),
    max_operations: int.min(1).max(200),
    overhead_tokens: int.min(0).max(10000),
    timeout_ms: int.min(5000).max(120000),
    reservation_ttl_seconds: int.min(60).max(3600),
    monthly_budget_usd: num.min(0).max(10000),
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

const KeyText = z.string().trim().min(20).max(300).regex(/^\S+$/);

/** Comandos do painel v2. */
export const AdminRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('update'), expectedVersion: z.number().int(), patch: SettingsPatch }).strict(),
  z.object({ action: z.literal('setKey'), provider: Provider, key: KeyText }).strict(),
  z.object({ action: z.literal('removeKey'), provider: Provider, expectedVersion: z.number().int() }).strict(),
  z.object({ action: z.literal('test'), provider: Provider }).strict(),
  /** Ativar/desativar um fornecedor; o servidor escolhe o melhor ativo para cada função. */
  z.object({ action: z.literal('setEnabled'), provider: Provider, enabled: z.boolean() }).strict(),
  // Diagnóstico progressivo do pedido ao Gemini (PAGO, teto DIAG_MAX_USD; só a pedido explícito).
  z.object({ action: z.literal('diagnose'), provider: z.literal('google'), maxUsd: z.number().positive().max(0.02) }).strict(),
  z.object({ action: z.literal('usage') }).strict(),
  z.object({ action: z.literal('audit') }).strict(),
]);
export type AdminRequest = z.infer<typeof AdminRequest>;

/**
 * Envelope dos pedidos v2: `{ api: 2, command }`. Pedidos sem `api: 2` são do painel v1 (frontend
 * anterior) e seguem pela camada de compatibilidade (compatV1.ts), nunca por aqui.
 */
export const AdminEnvelope = z.object({ api: z.literal(2), command: AdminRequest }).strict();
export const adminEnvelope = (command: AdminRequest) => ({ api: 2 as const, command });

export const AdminKey = z.object({
  configured: z.boolean(),
  last4: z.string().nullable(),
  fingerprint: z.string().nullable(),
  status: z.enum(['none', 'valid', 'invalid']),
  tested_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  /** O administrador ativou o fornecedor (migração 20261005120000; ausente num servidor anterior). */
  enabled: z.boolean().optional(),
});
export type AdminKey = z.infer<typeof AdminKey>;

export const AdminSettings = z.object({
  enabled: z.boolean(),
  provider: Provider,
  model: z.string(),
  image_enabled: z.boolean(),
  image_provider: Provider.nullable(),
  image_model: z.string().nullable(),
  image_requests_per_user_day: int,
  max_parts: int,
  requests_per_user_day: int,
  requests_per_workspace_day: int,
  max_concurrent_per_user: int,
  max_concurrent_per_workspace: int,
  max_output_tokens: int,
  max_retries: int,
  max_operations: int,
  overhead_tokens: int,
  timeout_ms: int,
  reservation_ttl_seconds: int,
  monthly_budget_usd: num,
  keys: z.object({ anthropic: AdminKey, openai: AdminKey, google: AdminKey }),
  version: int,
  updated_at: z.string(),
  updated_by_email: z.string().nullable(),
});
export type AdminSettings = z.infer<typeof AdminSettings>;

export const AdminModel = z.object({
  provider: Provider,
  model: z.string(),
  label: z.string(),
  capability: z.enum(['edit', 'image']),
  /** Teto (tarifa publicada) por imagem, USD. */
  price_image: num.nullable(),
  note: z.string().nullable(),
  /** Ordem de escolha automática por função (menor = melhor); null = nunca escolhido sozinho. */
  preference: num.nullable().optional(),
  prices: z.object({ input: num, output: num, cacheRead: num, cacheWrite: num }),
});
export type AdminModel = z.infer<typeof AdminModel>;

/**
 * Modelo que serve cada função, tal como o servidor o escolheu (melhor fornecedor ativo com chave
 * reconhecida). `null` = função indisponível.
 */
export function routing(view: AdminView): { edit: AdminModel | null; image: AdminModel | null } {
  const s = view.settings;
  const find = (provider: string | null, model: string | null) => view.models.find((m) => m.provider === provider && m.model === model) ?? null;
  return { edit: s.enabled ? find(s.provider, s.model) : null, image: s.image_enabled ? find(s.image_provider, s.image_model) : null };
}

export const AdminView = z.object({ settings: AdminSettings, models: z.array(AdminModel) });

/** Teto do diagnóstico progressivo do Gemini (USD), verificado no servidor antes de cada degrau. */
export const DIAG_MAX_USD = 0.02;

/** Relatório do diagnóstico progressivo (sem chaves; a resposta de erro do fornecedor, se houver). */
export const AdminDiagnosis = z.object({
  model: z.string(),
  endpoint: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      http: z.number().nullable(),
      accepted: z.boolean(),
      detail: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
    }),
  ),
  firstRejected: z.string().nullable(),
  /** Palavra(s) do esquema recusada(s) num degrau de sondagem (ex.: «additionalProperties»). */
  culprit: z.string().nullable().optional(),
  /** Sem a palavra recusada, o pedido real (último degrau) foi aceite pelo fornecedor. */
  fixValidated: z.boolean().optional(),
  stoppedForBudget: z.boolean(),
  costUsd: z.number(),
  maxUsd: z.number(),
});
export type AdminDiagnosis = z.infer<typeof AdminDiagnosis>;
export type AdminView = z.infer<typeof AdminView>;

export const AdminUsage = z.object({
  month: z.string(),
  requests: int,
  confirmed_usd: num,
  unknown_usd: num,
  reserved_usd: num,
  in_flight: int,
  unknown_attempts: int,
  image_usd: num,
  budget_usd: num,
});
export type AdminUsage = z.infer<typeof AdminUsage>;

/**
 * «Geração validada»: a última utilização REAL bem-sucedida por fornecedor, modelo e tipo.
 * É diferente de «credenciais reconhecidas», que o teste sem custo verifica sem gerar nada.
 */
export const AdminGenerationEntry = z.object({ provider: Provider, model: z.string(), kind: z.enum(['edit', 'image']), validated_at: z.string().nullable() });
export const AdminGeneration = z.array(AdminGenerationEntry);
export type AdminGeneration = z.infer<typeof AdminGeneration>;

export const AdminAuditEntry = z.object({ at: z.string(), action: z.string(), changes: z.record(z.string(), z.unknown()), actor_email: z.string().nullable() });
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export interface TestResult {
  ok: boolean;
  definitive: boolean;
  message: string;
  /** Sempre indicado ao utilizador antes e depois do teste. */
  cost: string;
}

export interface AdminBody {
  view?: AdminView;
  usage?: AdminUsage;
  generation?: AdminGeneration;
  audit?: AdminAuditEntry[];
  test?: TestResult;
  message?: string;
  error?: string;
  code?: string;
  diagnosis?: AdminDiagnosis;
}

export const TEST_COST_NOTE = 'Sem custo: consulta o fornecedor sem gerar texto nem imagens.';

/**
 * O teste confirma CREDENCIAIS (chave e modelo). Na Anthropic também conta os tokens do pedido real
 * (formato). NÃO prova a geração: isso só uma utilização real bem-sucedida, indicada à parte.
 */
export const RECOGNISED = 'Credenciais reconhecidas: chave, modelo e formato do pedido aceites, sem gerar texto. Isto não comprova a geração.';
export const CREDENTIALS_ONLY = 'Credenciais reconhecidas: chave e modelo aceites, sem gerar nada. O formato do pedido e a geração só ficam comprovados com uma utilização real.';

// ---------------------------------------------------------------- dependências

export interface AdminDeps {
  getUser(authHeader: string | null): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  get(actor: string): Promise<unknown>;
  update(actor: string, expectedVersion: number, patch: SettingsPatch): Promise<unknown>;
  stageKey(actor: string, provider: ProviderId, key: string, last4: string, fingerprint: string): Promise<string>;
  activateKey(actor: string, provider: ProviderId, secretId: string): Promise<unknown>;
  discardKey(actor: string, provider: ProviderId, secretId: string, reason: string): Promise<void>;
  removeKey(actor: string, provider: ProviderId, expectedVersion: number): Promise<unknown>;
  recordTest(actor: string, provider: ProviderId, ok: boolean, detail: string): Promise<unknown>;
  setEnabled(actor: string, provider: ProviderId, enabled: boolean): Promise<unknown>;
  providerKey(provider: ProviderId): Promise<string | null>;
  checkKey(provider: ProviderId, model: string, key: string, kind: 'edit' | 'image'): Promise<KeyCheck>;
  usage(actor: string): Promise<unknown>;
  /** Última utilização real bem-sucedida por fornecedor/modelo/tipo. */
  generation(actor: string): Promise<unknown>;
  audit(actor: string): Promise<unknown>;
  /** Diagnóstico progressivo (pago, com teto) com a chave guardada; a chave nunca sai do servidor. */
  diagnose(model: string, key: string, prices: { input: number; output: number }, maxUsd: number): Promise<AdminDiagnosis>;
}

/** Impressão digital de uma chave (16 hex do SHA-256): identifica sem revelar. */
export async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AdminResult {
  status: number;
  body: AdminBody;
}

const fail = (status: number, code: string, error: string, extra: AdminBody = {}): AdminResult => ({ status, body: { ...extra, error, code } });

/** Erros da base de dados → mensagens sem detalhes internos (nunca o texto do erro original). */
function mapError(e: unknown): AdminResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not_admin/.test(msg)) return fail(403, 'not_admin', 'Esta área é só para administradores do Bolt IA.');
  if (/version_conflict/.test(msg)) return fail(409, 'version_conflict', 'As configurações mudaram entretanto. Recarregue antes de alterar.');
  if (/ai_settings_check|check constraint/.test(msg)) {
    return fail(400, 'invalid_settings', 'Combinação inválida: só se ativa um uso (edição ou imagens) com a chave desse fornecedor reconhecida e um modelo suportado para esse uso; as tentativas têm de caber no tempo da função.');
  }
  if (/invalid_field|invalid_patch/.test(msg)) return fail(400, 'invalid_field', 'Campo não permitido.');
  if (/foreign key|violates foreign/.test(msg)) return fail(400, 'invalid_model', 'Modelo não suportado.');
  if (/no_key/.test(msg)) return fail(400, 'no_key', 'Não há chave configurada para este fornecedor.');
  if (/key_not_valid/.test(msg)) return fail(400, 'key_not_valid', 'Só se ativa um fornecedor com a chave reconhecida. Guarde (ou teste) a chave primeiro.');
  return fail(500, 'internal', 'Não foi possível concluir a operação. Nada foi alterado.');
}

const parseView = (raw: unknown): AdminView => AdminView.parse(raw);

/**
 * Modelo usado no teste de um fornecedor: o de edição se for o fornecedor de edição; o de imagem se
 * for o de imagens; senão o primeiro modelo suportado desse fornecedor (edição, depois imagem).
 */
export function modelForTest(view: AdminView, provider: ProviderId): { model: string; kind: 'edit' | 'image' } | null {
  const s = view.settings;
  if (s.provider === provider) return { model: s.model, kind: 'edit' };
  if (s.image_provider === provider && s.image_model) return { model: s.image_model, kind: 'image' };
  const m = view.models.find((x) => x.provider === provider && x.capability === 'edit') ?? view.models.find((x) => x.provider === provider);
  return m ? { model: m.model, kind: m.capability } : null;
}

export async function handleAdmin(authHeader: string | null, rawBody: string, deps: AdminDeps): Promise<AdminResult> {
  const who = await deps.getUser(authHeader);
  if (!who) return fail(401, 'no_session', 'Sessão inválida. Entre novamente.');
  if (!(await deps.isAdmin(who.id))) return fail(403, 'not_admin', 'Esta área é só para administradores do Bolt IA.');
  if (rawBody.length > 4000) return fail(413, 'too_large', 'Pedido demasiado grande.');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail(400, 'bad_json', 'Pedido inválido.');
  }
  const parsed = AdminEnvelope.safeParse(json);
  if (!parsed.success) return fail(400, 'bad_request', 'Pedido inválido.');
  const req = parsed.data.command;
  const actor = who.id;
  // A chave recebida (se houver) nunca pode aparecer numa resposta: verificação final abaixo.
  const incomingKey = req.action === 'setKey' ? req.key : null;

  let result: AdminResult;
  try {
    result = await run();
  } catch (e) {
    result = mapError(e);
  }
  if (incomingKey && JSON.stringify(result.body).includes(incomingKey)) return fail(500, 'internal', 'Não foi possível concluir a operação.');
  return result;

  async function run(): Promise<AdminResult> {
    switch (req.action) {
      case 'get':
        return { status: 200, body: { view: parseView(await deps.get(actor)) } };
      case 'update':
        return { status: 200, body: { view: parseView(await deps.update(actor, req.expectedVersion, req.patch)), message: 'Configurações guardadas.' } };
      case 'removeKey': {
        const view = parseView(await deps.removeKey(actor, req.provider, req.expectedVersion));
        return { status: 200, body: { view, message: `Chave ${PROVIDER_LABEL[req.provider]} removida. As outras chaves mantêm-se; o que a usava ficou desativado.` } };
      }
      case 'setEnabled': {
        const view = parseView(await deps.setEnabled(actor, req.provider, req.enabled));
        const r = routing(view);
        const label = PROVIDER_LABEL[req.provider];
        return {
          status: 200,
          body: {
            view,
            message: `${label} ${req.enabled ? 'ativado' : 'desativado'}. Edição: ${r.edit ? r.edit.label : 'indisponível (nenhum fornecedor ativo com chave reconhecida)'}. Imagens: ${r.image ? r.image.label : 'indisponíveis'}.`,
          },
        };
      }
      case 'usage': {
        const usage = AdminUsage.parse(await deps.usage(actor));
        return { status: 200, body: { usage, generation: AdminGeneration.parse(await deps.generation(actor)) } };
      }
      case 'audit':
        return { status: 200, body: { audit: z.array(AdminAuditEntry).parse(await deps.audit(actor)) } };
      case 'setKey': {
        const { key, provider } = req;
        const label = PROVIDER_LABEL[provider];
        const before = parseView(await deps.get(actor));
        const target = modelForTest(before, provider);
        if (!target) return fail(400, 'no_model', `Não há modelos suportados de ${label}.`);
        const secretId = await deps.stageKey(actor, provider, key, key.slice(-4), await keyFingerprint(key));
        const check = await deps.checkKey(provider, target.model, key, target.kind);
        if (check.ok) {
          const view = parseView(await deps.activateKey(actor, provider, secretId));
          if (check.warning) {
            return { status: 200, body: { view, message: `Chave ${label} guardada (…${key.slice(-4)}). ${check.warning}`, test: { ok: false, definitive: false, message: check.warning, cost: TEST_COST_NOTE } } };
          }
          const message = check.formatChecked === false ? CREDENTIALS_ONLY : RECOGNISED;
          return { status: 200, body: { view, message: `Chave ${label} guardada (…${key.slice(-4)}). ${message}`, test: { ok: true, definitive: true, message, cost: TEST_COST_NOTE } } };
        }
        await deps.discardKey(actor, provider, secretId, check.reason);
        const view = parseView(await deps.get(actor));
        const old = before.settings.keys[provider];
        const kept = old.configured ? ` Mantém-se a chave anterior (…${old.last4 ?? ''}).` : ' Não há chave configurada.';
        return fail(422, 'key_rejected', `A chave nova (${label}) não foi aceite: ${check.reason}${kept}`, { view, test: { ok: false, definitive: check.definitive, message: check.reason, cost: TEST_COST_NOTE } });
      }
      case 'diagnose': {
        const view = parseView(await deps.get(actor));
        const key = await deps.providerKey('google');
        if (!key) return fail(400, 'no_key', 'Não há chave configurada para a Google.', { view });
        // O modelo de edição da Google mais barato: o HTTP 400 acontece igual em todos (Flash-Lite e
        // 3.8 Flash, 05-08/10), por isso a causa é comum e o diagnóstico cabe no teto.
        const model = view.models
          .filter((m) => m.provider === 'google' && m.capability === 'edit')
          .sort((a, b) => a.prices.output - b.prices.output || a.prices.input - b.prices.input)[0];
        if (!model) return fail(400, 'no_model', 'Não há modelos de edição da Google.', { view });
        const diagnosis = AdminDiagnosis.parse(await deps.diagnose(model.model, key, { input: model.prices.input, output: model.prices.output }, Math.min(req.maxUsd, DIAG_MAX_USD)));
        return { status: 200, body: { view, diagnosis } };
      }
      case 'test': {
        const { provider } = req;
        const view = parseView(await deps.get(actor));
        const key = await deps.providerKey(provider);
        if (!key) return fail(400, 'no_key', 'Não há chave configurada para este fornecedor.', { view });
        const target = modelForTest(view, provider);
        if (!target) return fail(400, 'no_model', `Não há modelos suportados de ${PROVIDER_LABEL[provider]}.`, { view });
        const check = await deps.checkKey(provider, target.model, key, target.kind);
        // Só um resultado definitivo (o fornecedor respondeu) muda o estado da chave.
        const after = check.ok || check.definitive ? parseView(await deps.recordTest(actor, provider, check.ok, check.ok ? 'aceite' : check.reason)) : view;
        if (check.ok && check.warning) return { status: 200, body: { view: after, test: { ok: false, definitive: false, message: check.warning, cost: TEST_COST_NOTE } } };
        const message = check.ok ? (check.formatChecked === false ? CREDENTIALS_ONLY : RECOGNISED) : check.definitive ? `${check.reason} O que usava esta chave foi desativado.` : check.reason;
        return { status: 200, body: { view: after, test: { ok: check.ok, definitive: check.ok || check.definitive, message, cost: TEST_COST_NOTE } } };
      }
    }
  }
}
