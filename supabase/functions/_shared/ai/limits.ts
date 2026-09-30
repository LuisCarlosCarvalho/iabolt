import { z } from 'zod';

/**
 * Limites do Assistente IA. FONTE ÚNICA: a configuração central `ai_settings` (gerida no painel
 * «Configurações de IA»), lida pela função `ai-propose` em cada pedido (`ai_runtime_settings`).
 * Não há limites em variáveis de ambiente; só o interruptor de emergência AI_FORCE_DISABLED, que
 * desliga e nunca liga.
 *
 * O controlo é feito ANTES da chamada ao fornecedor, reservando o custo MÁXIMO possível do pedido
 * (`ai_reserve`), e acertado depois com o consumo real — ou com o máximo, quando o consumo de uma
 * tentativa não é conhecido (nunca como zero).
 */
export interface AiPrices {
  /** USD por milhão de tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AiLimits {
  requestsPerUserDay: number;
  requestsPerWorkspaceDay: number;
  maxInstructionChars: number;
  /** Tamanho máximo do pedido (JSON do contexto + instrução), em caracteres. */
  maxInputChars: number;
  maxOutputTokens: number;
  maxOperations: number;
  maxConcurrentPerUser: number;
  maxConcurrentPerWorkspace: number;
  /** Repetições depois de uma resposta inválida (0 = só uma tentativa). */
  maxRetries: number;
  monthlyBudgetUsd: number;
  timeoutMs: number;
  /** Uma reserva sem acerto deixa de contar como «em curso» ao fim deste tempo (continua a contar para o orçamento). */
  reservationTtlSeconds: number;
  /** Tokens que o fornecedor acrescenta ao que enviamos (instruções de uso de ferramentas, papéis, estrutura). */
  overheadTokens: number;
  prices: AiPrices;
}

export const SONNET_5_5_PRICES: AiPrices = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

/** Tempo máximo de execução da função no Supabase (margem abaixo do limite da plataforma). */
export const FUNCTION_WALL_MS = 140_000;

/** Iguais aos valores por omissão da tabela `ai_settings` (usados em testes e na simulação local). */
export const DEFAULT_LIMITS: AiLimits = {
  requestsPerUserDay: 50,
  requestsPerWorkspaceDay: 300,
  maxInstructionChars: 1000,
  maxInputChars: 90_000,
  maxOutputTokens: 1500,
  maxOperations: 10,
  maxConcurrentPerUser: 1,
  maxConcurrentPerWorkspace: 4,
  maxRetries: 1,
  monthlyBudgetUsd: 25,
  timeoutMs: 30_000,
  reservationTtlSeconds: 300,
  overheadTokens: 1000,
  prices: SONNET_5_5_PRICES,
};

const num = z.coerce.number().finite();

/** Resultado de `ai_runtime_settings()` (configuração em vigor + preços do modelo; sem segredos). */
export const RuntimeSettings = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string().min(1).max(80),
  model_label: z.string().max(80),
  /** Estado da chave do fornecedor de EDIÇÃO. */
  key_status: z.enum(['none', 'valid', 'invalid']),
  image_enabled: z.boolean().default(false),
  image_provider: z.enum(['anthropic', 'openai', 'google']).nullable().default(null),
  image_model: z.string().max(80).nullable().default(null),
  image_label: z.string().max(80).nullable().default(null),
  image_key_status: z.enum(['none', 'valid', 'invalid']).default('none'),
  /** Preços do modelo de imagem: por token e teto por imagem (USD). */
  image_prices: z.object({ input: num, output: num, image: num.nullable() }).nullable().default(null),
  image_requests_per_user_day: num.default(10),
  max_parts: num.default(6),
  requests_per_user_day: num,
  requests_per_workspace_day: num,
  max_concurrent_per_user: num,
  max_concurrent_per_workspace: num,
  max_output_tokens: num,
  max_retries: num,
  max_operations: num,
  overhead_tokens: num,
  timeout_ms: num,
  reservation_ttl_seconds: num,
  monthly_budget_usd: num,
  prices: z.object({ input: num, output: num, cacheRead: num, cacheWrite: num }),
});
export type RuntimeSettings = z.infer<typeof RuntimeSettings>;

/** Converte a configuração central nos limites usados pela função. Recusa combinações inválidas. */
export function limitsFromRuntime(s: RuntimeSettings): AiLimits {
  const limits: AiLimits = {
    requestsPerUserDay: s.requests_per_user_day,
    requestsPerWorkspaceDay: s.requests_per_workspace_day,
    maxInstructionChars: DEFAULT_LIMITS.maxInstructionChars,
    maxInputChars: DEFAULT_LIMITS.maxInputChars,
    maxOutputTokens: s.max_output_tokens,
    maxOperations: s.max_operations,
    maxConcurrentPerUser: s.max_concurrent_per_user,
    maxConcurrentPerWorkspace: s.max_concurrent_per_workspace,
    maxRetries: s.max_retries,
    monthlyBudgetUsd: s.monthly_budget_usd,
    timeoutMs: s.timeout_ms,
    reservationTtlSeconds: s.reservation_ttl_seconds,
    overheadTokens: s.overhead_tokens,
    prices: { ...s.prices },
  };
  // Todas as tentativas têm de caber no tempo da função (a tabela já o impõe; confirmado aqui).
  if (limits.timeoutMs * (limits.maxRetries + 1) + 10_000 > FUNCTION_WALL_MS) {
    throw new Error(`timeout × tentativas excede o tempo da função (${FUNCTION_WALL_MS} ms).`);
  }
  return limits;
}

/** Bytes UTF-8 de um texto. */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(u: TokenUsage, p: AiPrices): number {
  const c = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000;
  return Math.round(c * 1e6) / 1e6;
}

/**
 * Máximo de tokens de entrada de UMA tentativa: 1 token por byte UTF-8 de tudo o que enviamos
 * (limite superior de um tokenizador por bytes) + a margem do fornecedor. A bateria real verifica
 * que o consumo medido fica abaixo deste limite.
 */
export function inputTokenBound(limits: AiLimits, sentBytes: number): number {
  return sentBytes + limits.overheadTokens;
}

/**
 * Custo máximo de UMA tentativa: toda a entrada ao preço mais alto entre entrada normal e escrita
 * de cache (o prefixo em cache pode ser escrito), e a saída no máximo pedido ao fornecedor
 * (`max_tokens`, imposto pelo próprio fornecedor).
 */
export function attemptCeilingUsd(limits: AiLimits, sentBytes: number): number {
  const p = limits.prices;
  const c = (inputTokenBound(limits, sentBytes) * Math.max(p.input, p.cacheWrite) + limits.maxOutputTokens * p.output) / 1_000_000;
  return Math.ceil(c * 1e6) / 1e6;
}

/** Reserva do pedido: o máximo de todas as tentativas possíveis (1 + repetições). */
export function reservationUsd(limits: AiLimits, sentBytes: number): number {
  return Math.ceil(attemptCeilingUsd(limits, sentBytes) * (limits.maxRetries + 1) * 1e6) / 1e6;
}
