/**
 * ADMINISTRAÇÃO v1 (congelada, igual à do commit 6744483, o painel em produção). Só para a camada de
 * compatibilidade: pedidos sem «api: 2» são tratados aqui, com as funções SQL v1 (que a migração
 * 20261001120000 mantém, sobre a chave Anthropic). Não evoluir este ficheiro; ver admin.ts (v2).
 */
import { z } from 'zod';
import type { KeyCheck } from './provider.ts';

/**
 * Lógica da função `ai-admin` (painel «Configurações de IA»), independente do Deno.
 * Em TODAS as ações: sessão válida → administrador da plataforma (verificado no servidor, pela
 * tabela platform_admins; nunca pelo email nem por algo vindo do browser) → ação.
 * A chave só entra (setKey); nenhuma resposta a devolve. Uma chave nova fica pendente, é testada
 * sem custo e só substitui a ativa se o fornecedor a aceitar.
 */

// ---------------------------------------------------------------- contrato (partilhado com o painel)

const num = z.coerce.number().finite();
const int = z.coerce.number().int();

export const SUPPORTED_PROVIDERS = [{ id: 'anthropic', label: 'Anthropic' }] as const;

export const SettingsPatch = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['anthropic']),
    model: z.string().min(1).max(80),
    requests_per_user_day: int.min(1).max(1000),
    requests_per_workspace_day: int.min(1).max(10000),
    max_concurrent_per_user: int.min(1).max(5),
    max_concurrent_per_workspace: int.min(1).max(50),
    max_output_tokens: int.min(100).max(4000),
    max_retries: int.min(0).max(2),
    max_operations: int.min(1).max(20),
    overhead_tokens: int.min(0).max(10000),
    timeout_ms: int.min(5000).max(120000),
    reservation_ttl_seconds: int.min(60).max(3600),
    monthly_budget_usd: num.min(0).max(10000),
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const AdminRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('update'), expectedVersion: z.number().int(), patch: SettingsPatch }).strict(),
  z.object({ action: z.literal('setKey'), key: z.string().trim().min(20).max(300).regex(/^\S+$/) }).strict(),
  z.object({ action: z.literal('removeKey'), expectedVersion: z.number().int() }).strict(),
  z.object({ action: z.literal('test') }).strict(),
  z.object({ action: z.literal('usage') }).strict(),
  z.object({ action: z.literal('audit') }).strict(),
]);
export type AdminRequest = z.infer<typeof AdminRequest>;

export const AdminSettings = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic']),
  model: z.string(),
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
  key: z.object({
    configured: z.boolean(),
    last4: z.string().nullable(),
    fingerprint: z.string().nullable(),
    status: z.enum(['none', 'valid', 'invalid']),
    tested_at: z.string().nullable(),
    updated_at: z.string().nullable(),
  }),
  version: int,
  updated_at: z.string(),
  updated_by_email: z.string().nullable(),
});
export type AdminSettings = z.infer<typeof AdminSettings>;

export const AdminModel = z.object({
  provider: z.enum(['anthropic']),
  model: z.string(),
  label: z.string(),
  prices: z.object({ input: num, output: num, cacheRead: num, cacheWrite: num }),
});
export type AdminModel = z.infer<typeof AdminModel>;

export const AdminView = z.object({ settings: AdminSettings, models: z.array(AdminModel) });
export type AdminView = z.infer<typeof AdminView>;

export const AdminUsage = z.object({
  month: z.string(),
  requests: int,
  confirmed_usd: num,
  unknown_usd: num,
  reserved_usd: num,
  in_flight: int,
  unknown_attempts: int,
  budget_usd: num,
});
export type AdminUsage = z.infer<typeof AdminUsage>;

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
  audit?: AdminAuditEntry[];
  test?: TestResult;
  message?: string;
  error?: string;
  code?: string;
}

export const TEST_COST_NOTE = 'Sem custo: consulta o modelo no fornecedor, sem gerar texto.';

/**
 * O teste consulta o modelo: valida a autenticação da chave e que o modelo é visível para ela.
 * NÃO prova que a geração funcione (créditos, limites, permissões de mensagens): isso só o piloto.
 */
export const RECOGNISED = 'Chave e modelo reconhecidos pelo fornecedor (consulta sem gerar texto). A geração só fica comprovada no piloto.';

// ---------------------------------------------------------------- dependências

export interface AdminDeps {
  getUser(authHeader: string | null): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  get(actor: string): Promise<unknown>;
  update(actor: string, expectedVersion: number, patch: SettingsPatch): Promise<unknown>;
  stageKey(actor: string, key: string, last4: string, fingerprint: string): Promise<string>;
  activateKey(actor: string, secretId: string): Promise<unknown>;
  discardKey(actor: string, secretId: string, reason: string): Promise<void>;
  removeKey(actor: string, expectedVersion: number): Promise<unknown>;
  recordTest(actor: string, ok: boolean, detail: string): Promise<unknown>;
  providerKey(): Promise<string | null>;
  checkKey(provider: 'anthropic', model: string, key: string): Promise<KeyCheck>;
  usage(actor: string): Promise<unknown>;
  audit(actor: string): Promise<unknown>;
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
  if (/ai_settings_check|check constraint/.test(msg)) return fail(400, 'invalid_settings', 'Combinação inválida. O assistente só pode ser ativado com uma chave válida, e as tentativas têm de caber no tempo da função.');
  if (/invalid_field|invalid_patch/.test(msg)) return fail(400, 'invalid_field', 'Campo não permitido.');
  if (/foreign key|violates foreign/.test(msg)) return fail(400, 'invalid_model', 'Modelo não suportado.');
  if (/no_key/.test(msg)) return fail(400, 'no_key', 'Não há chave configurada.');
  return fail(500, 'internal', 'Não foi possível concluir a operação. Nada foi alterado.');
}

const parseView = (raw: unknown): AdminView => AdminView.parse(raw);

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
  const parsed = AdminRequest.safeParse(json);
  if (!parsed.success) return fail(400, 'bad_request', 'Pedido inválido.');
  const req = parsed.data;
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
      case 'removeKey':
        return { status: 200, body: { view: parseView(await deps.removeKey(actor, req.expectedVersion)), message: 'Chave removida. O assistente ficou desativado.' } };
      case 'usage':
        return { status: 200, body: { usage: AdminUsage.parse(await deps.usage(actor)) } };
      case 'audit':
        return { status: 200, body: { audit: z.array(AdminAuditEntry).parse(await deps.audit(actor)) } };
      case 'setKey': {
        const key = req.key;
        const before = parseView(await deps.get(actor));
        const secretId = await deps.stageKey(actor, key, key.slice(-4), await keyFingerprint(key));
        const check = await deps.checkKey(before.settings.provider, before.settings.model, key);
        if (check.ok) {
          const view = parseView(await deps.activateKey(actor, secretId));
          return { status: 200, body: { view, message: `Chave guardada (…${key.slice(-4)}): o fornecedor reconheceu a chave e o modelo. A geração de texto só fica comprovada no piloto.`, test: { ok: true, definitive: true, message: RECOGNISED, cost: TEST_COST_NOTE } } };
        }
        await deps.discardKey(actor, secretId, check.reason);
        const view = parseView(await deps.get(actor));
        const kept = before.settings.key.configured ? ` Mantém-se a chave anterior (…${before.settings.key.last4 ?? ''}).` : ' Não há chave configurada.';
        return fail(422, 'key_rejected', `A chave nova não foi aceite: ${check.reason}${kept}`, { view, test: { ok: false, definitive: check.definitive, message: check.reason, cost: TEST_COST_NOTE } });
      }
      case 'test': {
        const view = parseView(await deps.get(actor));
        const key = await deps.providerKey();
        if (!key) return fail(400, 'no_key', 'Não há chave configurada.', { view });
        const check = await deps.checkKey(view.settings.provider, view.settings.model, key);
        // Só um resultado definitivo (o fornecedor respondeu) muda o estado da chave.
        const after = check.ok || check.definitive ? parseView(await deps.recordTest(actor, check.ok, check.ok ? 'aceite' : check.reason)) : view;
        const message = check.ok ? RECOGNISED : check.definitive ? `${check.reason} O assistente foi desativado.` : check.reason;
        return { status: 200, body: { view: after, test: { ok: check.ok, definitive: check.ok || check.definitive, message, cost: TEST_COST_NOTE } } };
      }
    }
  }
}
