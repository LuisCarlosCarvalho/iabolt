import { AI_CONTRACT_VERSION, AiProposal, AiProposeRequest, checkProposalShape, scopeRoot, type AiProposeResponse } from './contract.ts';
import { attemptCeilingUsd, costUsd, DEFAULT_LIMITS, limitsFromRuntime, reservationUsd, utf8Bytes, type AiPrices, type RuntimeSettings, type TokenUsage } from './limits.ts';
import { SYSTEM_PROMPT, userMessage } from './prompt.ts';
import { ProviderError, type AiProvider } from './provider.ts';
import type { ProviderId } from './ids.ts';
import { sentTextFor } from './registry.ts';

/**
 * Lógica da função `ai-propose`, independente do Deno (testada com dependências simuladas).
 * Ordem: emergência? → tamanho → forma do pedido → sessão → acesso ao projeto → CONFIGURAÇÃO
 * CENTRAL (ativa, modelo, preços, limites) e chave (cofre) → RESERVA atómica do custo máximo
 * (a base de dados volta a confirmar que está ativa e com o mesmo modelo) → fornecedor (repetições
 * já incluídas na reserva) → validação → acerto (confirmado e desconhecido em separado).
 * A chave do fornecedor nunca sai do servidor.
 */
export type LimitReason = 'disabled' | 'config_changed' | 'forbidden' | 'duplicate' | 'user_day' | 'workspace_day' | 'user_concurrency' | 'workspace_concurrency' | 'budget';

export interface Reservation {
  requestId: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  reserveUsd: number;
  /** Instantâneo guardado com a reserva; o acerto usa os mesmos preços. */
  provider: ProviderId;
  model: string;
  prices: AiPrices | Record<string, number | null>;
  kind: 'edit' | 'image';
}

export interface Settlement {
  status: 'done' | 'failed';
  usage: TokenUsage;
  /** Tokens indicados pelo fornecedor × preços do instantâneo. */
  confirmedCostUsd: number;
  /** Teto de cada tentativa sem dados de consumo. */
  unknownCostUsd: number;
  attempts: number;
  unknownAttempts: number;
  latencyMs: number;
  error?: string;
}

export interface HandlerDeps {
  /** AI_FORCE_DISABLED: interruptor de emergência (só desliga). */
  forceDisabled: boolean;
  getUser(authHeader: string | null): Promise<{ id: string } | null>;
  /** Workspace do projeto se o utilizador lhe tem acesso (verificado com a sessão dele, pela RLS). */
  projectWorkspace(authHeader: string, projectId: string): Promise<string | null>;
  /** Configuração central em vigor (lida em cada pedido). */
  loadRuntime(): Promise<RuntimeSettings | null>;
  /** Chave decifrada do cofre (só no servidor), do fornecedor indicado. */
  providerKey(provider: ProviderId): Promise<string | null>;
  makeProvider(runtime: RuntimeSettings, key: string): AiProvider;
  reserve(r: Reservation): Promise<{ ok: true; id: string } | { ok: false; reason: LimitReason }>;
  settle(id: string, s: Settlement): Promise<void>;
  /** Só quando NENHUMA tentativa foi enviada ao fornecedor. */
  release(id: string): Promise<void>;
  now(): number;
  /**
   * Administrador da plataforma (`platform_admins`)? Só estes recebem o consumo e o custo na
   * resposta. Sem esta dependência, ninguém os recebe. A contabilização é a mesma para todos.
   */
  isAdmin?(userId: string): Promise<boolean>;
}

export interface HandlerResult {
  status: number;
  body: AiProposeResponse | { error: string; code: string; details?: string[] };
}

const LIMIT_MESSAGE: Record<LimitReason, string> = {
  disabled: 'O assistente está desativado. Nada foi alterado.',
  config_changed: 'A configuração do assistente mudou durante o pedido. Tente de novo.',
  forbidden: 'Só quem pode editar o projeto usa o assistente.',
  duplicate: 'Este pedido já foi enviado. Nada foi alterado.',
  user_day: 'Atingiu o limite diário de pedidos ao assistente.',
  workspace_day: 'O workspace atingiu o limite diário de pedidos ao assistente.',
  user_concurrency: 'Já tem um pedido ao assistente em curso. Aguarde que termine.',
  workspace_concurrency: 'Há demasiados pedidos ao assistente em curso neste workspace. Tente daqui a pouco.',
  budget: 'O orçamento mensal do assistente foi atingido.',
};
/** Utilizadores comuns: mensagem funcional, sem conceitos nem valores financeiros. */
const USER_LIMIT = 'Limite de utilização do assistente atingido.';

const LIMIT_STATUS: Record<LimitReason, number> = {
  disabled: 503,
  config_changed: 409,
  forbidden: 403,
  duplicate: 409,
  user_day: 429,
  workspace_day: 429,
  user_concurrency: 429,
  workspace_concurrency: 429,
  budget: 429,
};

const fail = (status: number, code: string, error: string, details?: string[]): HandlerResult => ({ status, body: { error, code, ...(details ? { details } : {}) } });
const DISABLED = (): HandlerResult => fail(503, 'disabled', LIMIT_MESSAGE.disabled);

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function handlePropose(authHeader: string | null, rawBody: string, deps: HandlerDeps): Promise<HandlerResult> {
  if (deps.forceDisabled) return DISABLED();
  if (rawBody.length > DEFAULT_LIMITS.maxInputChars + DEFAULT_LIMITS.maxInstructionChars + 2000) return fail(413, 'too_large', 'O pedido é demasiado grande.');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail(400, 'bad_json', 'Pedido inválido.');
  }
  const parsed = AiProposeRequest.safeParse(json);
  if (!parsed.success) return fail(400, 'bad_request', 'Pedido fora do contrato.', parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`));
  const asked = parsed.data;
  // O contexto tem de corresponder ao âmbito: o elemento/secção principal e a(s) página(s) certas.
  const root = scopeRoot(asked.scope);
  if (root !== null && asked.context.target?.id !== root) return fail(400, 'scope_mismatch', 'O contexto não corresponde ao âmbito.');
  const scopePage = asked.scope.kind === 'site' ? null : asked.scope.pageId;
  if (scopePage !== null && !asked.context.pages.some((p) => p.id === scopePage)) return fail(400, 'scope_mismatch', 'O contexto não corresponde ao âmbito.');
  if (asked.scope.kind !== 'site' && asked.context.pages.length !== 1) return fail(400, 'scope_mismatch', 'O contexto não corresponde ao âmbito.');

  const who = await deps.getUser(authHeader);
  if (!who || !authHeader) return fail(401, 'no_session', 'Sessão inválida. Entre novamente.');
  const workspaceId = await deps.projectWorkspace(authHeader, asked.projectId);
  if (!workspaceId) return fail(403, 'no_access', 'Sem acesso a este projeto.');

  // Configuração central em vigor (desativar no painel bloqueia já a chamada seguinte).
  const runtime = await deps.loadRuntime();
  if (!runtime || !runtime.enabled || runtime.key_status !== 'valid') return DISABLED();
  const limits = limitsFromRuntime(runtime);
  // A geração de imagens só é oferecida ao modelo se estiver REALMENTE ativa no servidor.
  const req: AiProposeRequest = { ...asked, imageGeneration: asked.imageGeneration && runtime.image_enabled && runtime.image_key_status === 'valid' };
  const user = userMessage(req);
  if (user.length > DEFAULT_LIMITS.maxInputChars) return fail(413, 'context_too_large', 'O âmbito tem conteúdo a mais para um só pedido; o editor divide pedidos grandes em partes.');
  const key = await deps.providerKey(runtime.provider);
  if (!key) return DISABLED();
  const provider = deps.makeProvider(runtime, key);

  // Teto por tentativa a partir do que vai REALMENTE ser enviado (corpo do pedido deste
  // fornecedor, em bytes UTF-8, + margem).
  const sentBytes = utf8Bytes(sentTextFor(runtime.provider, runtime.model, user, limits.maxOutputTokens));
  const ceiling = attemptCeilingUsd(limits, sentBytes);
  const reservation = await deps.reserve({
    requestId: req.requestId,
    userId: who.id,
    workspaceId,
    projectId: req.projectId,
    reserveUsd: reservationUsd(limits, sentBytes),
    provider: runtime.provider,
    model: runtime.model,
    prices: limits.prices,
    kind: 'edit',
  });
  const admin = (await deps.isAdmin?.(who.id).catch(() => false)) === true;
  if (!reservation.ok) return fail(LIMIT_STATUS[reservation.reason], `limit_${reservation.reason}`, reservation.reason === 'budget' && !admin ? USER_LIMIT : LIMIT_MESSAGE[reservation.reason]);

  const started = deps.now();
  let known = ZERO;
  let sent = 0;
  let unknownAttempts = 0;
  let lastProblem = '';
  /** Resposta de erro do fornecedor (só para o registo `ai_usage.error`; o ecrã mostra `lastProblem`). */
  let lastDiagnostic = '';
  let details: string[] = [];
  let settled = false;
  const confirmed = () => costUsd(known, limits.prices);
  const unknown = () => round6(unknownAttempts * ceiling);
  const settle = async (status: 'done' | 'failed', error?: string) => {
    settled = true;
    if (sent === 0) return deps.release(reservation.id);
    return deps.settle(reservation.id, {
      status,
      usage: known,
      confirmedCostUsd: confirmed(),
      unknownCostUsd: unknown(),
      attempts: sent,
      unknownAttempts,
      latencyMs: deps.now() - started,
      ...(error ? { error } : {}),
    });
  };
  try {
    while (sent <= limits.maxRetries) {
      sent += 1;
      try {
        const r = await provider.propose({ system: SYSTEM_PROMPT, user, maxOutputTokens: limits.maxOutputTokens, timeoutMs: limits.timeoutMs });
        if (r.usageKnown) known = addUsage(known, r.usage);
        else unknownAttempts += 1;
        if (r.truncated) {
          lastProblem = 'A resposta do assistente ficou incompleta.';
          continue;
        }
        if (r.noToolCall) {
          // Texto livre ou recusa, sem a ferramenta: nada é aplicado. Não se repete (o modelo decidiu
          // responder assim; repetir custaria de novo, provavelmente com o mesmo resultado).
          lastProblem = r.noToolCall.stopReason === 'refusal' ? 'O modelo recusou o pedido.' : 'O assistente respondeu sem propor operações.';
          details = r.noToolCall.text ? [`Resposta do modelo: ${r.noToolCall.text}`] : [];
          break;
        }
        const p = AiProposal.safeParse(r.toolInput);
        if (!p.success) {
          lastProblem = 'A resposta do assistente não respeitou o formato.';
          continue;
        }
        const problems = checkProposalShape(req, p.data, limits.maxOperations);
        if (problems.length) {
          lastProblem = 'A resposta do assistente propôs operações não permitidas.';
          details = problems;
          continue;
        }
        await settle('done');
        return {
          status: 200,
          body: {
            contract: AI_CONTRACT_VERSION,
            documentVersion: req.documentVersion,
            proposal: p.data,
            model: runtime.model,
            simulated: false,
            // Consumo e custo: só para administradores (a contabilização no servidor é igual).
            ...(admin ? { usage: { ...known, costUsd: round6(confirmed() + unknown()), attempts: sent, latencyMs: deps.now() - started, estimated: unknownAttempts > 0 } } : {}),
          },
        };
      } catch (e) {
        if (e instanceof ProviderError) {
          if (e.charged === 'unknown') unknownAttempts += 1;
          lastProblem = e.message;
          lastDiagnostic = e.diagnostic;
          if (!e.retriable) break;
          continue;
        }
        // Erro inesperado depois de enviar: o consumo desta tentativa é desconhecido.
        unknownAttempts += 1;
        throw e;
      }
    }
    await settle('failed', lastDiagnostic ? `${lastProblem} | resposta do fornecedor: ${lastDiagnostic}` : lastProblem);
    return fail(502, 'invalid_response', `${lastProblem || 'O assistente não respondeu.'} Nada foi alterado.`, details.length ? details : undefined);
  } finally {
    if (!settled) await settle('failed', 'erro interno');
  }
}
