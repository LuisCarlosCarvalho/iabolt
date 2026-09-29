import type { TokenUsage } from './limits.ts';
import { SYSTEM_PROMPT, TOOL_NAME, toolInputSchema } from './prompt.ts';

/**
 * Adaptador de fornecedor. Mudar de fornecedor ou de modelo é trocar o adaptador (e os preços, ver
 * `limits.ts`); o resto da função não muda.
 */
export interface ProviderCall {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ProviderResult {
  /** Entrada da ferramenta, por validar (pode ser qualquer coisa). */
  toolInput: unknown;
  usage: TokenUsage;
  /** O fornecedor indicou o consumo. Se não, a tentativa conta pelo máximo reservado. */
  usageKnown: boolean;
  /** A resposta foi cortada (limite de saída): tratada como inválida. */
  truncated: boolean;
}

export interface AiProvider {
  readonly model: string;
  propose(call: ProviderCall): Promise<ProviderResult>;
}

/**
 * Falha do fornecedor. `charged`: «none» quando o fornecedor recusou o pedido sem o processar
 * (erros 4xx); «unknown» quando pode ter havido consumo (tempo esgotado, rede, 5xx) — nesse caso a
 * tentativa conta pelo máximo, nunca como zero.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
    readonly charged: 'none' | 'unknown',
  ) {
    super(message);
  }
}

const TOOL_DESCRIPTION = 'Propõe operações validadas sobre o elemento do âmbito.';

/** Tudo o que é enviado ao fornecedor numa tentativa (base do limite de tokens de entrada). */
export function sentText(user: string): string {
  return SYSTEM_PROMPT + TOOL_NAME + TOOL_DESCRIPTION + JSON.stringify(toolInputSchema()) + user;
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Resultado do teste de ligação. `definitive`: o fornecedor respondeu (chave ou modelo recusados). */
export type KeyCheck = { ok: true } | { ok: false; definitive: boolean; reason: string };

/**
 * «Testar ligação» SEM CUSTO: consulta o modelo (`GET /v1/models/{modelo}`), o que valida a chave e
 * a disponibilidade do modelo sem gerar texto. Nunca devolve nem regista a chave.
 */
export async function anthropicCheck(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string; timeoutMs?: number }): Promise<KeyCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await opts.fetch(`${opts.baseUrl ?? 'https://api.anthropic.com'}/v1/models/${encodeURIComponent(opts.model)}`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
    if (res.status === 404) return { ok: false, definitive: true, reason: 'O modelo escolhido não está disponível para esta chave.' };
    return { ok: false, definitive: false, reason: `O fornecedor não confirmou a chave (HTTP ${res.status}). Tente de novo.` };
  } catch {
    return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
  } finally {
    clearTimeout(timer);
  }
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Anthropic Messages API com uma única ferramenta obrigatória e cache do prompt de sistema. */
export function anthropicProvider(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): AiProvider {
  const url = `${opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
  return {
    model: opts.model,
    async propose(call) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), call.timeoutMs);
      let res;
      try {
        res = await opts.fetch(url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: call.maxOutputTokens,
            system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
            tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: toolInputSchema() }],
            tool_choice: { type: 'tool', name: TOOL_NAME },
            messages: [{ role: 'user', content: call.user }],
          }),
        });
      } catch (e) {
        const why = ctrl.signal.aborted ? 'O fornecedor não respondeu a tempo.' : `Falha de rede: ${e instanceof Error ? e.message : String(e)}`;
        throw new ProviderError(why, true, 'unknown');
      } finally {
        clearTimeout(timer);
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const server = res.status >= 500;
        throw new ProviderError(`O fornecedor recusou o pedido (HTTP ${res.status}).`, res.status === 429 || server, server ? 'unknown' : 'none');
      }
      const obj = body && typeof body === 'object' ? body : {};
      const usageRaw = Reflect.get(obj, 'usage');
      const u = usageRaw && typeof usageRaw === 'object' ? usageRaw : {};
      const usageKnown = typeof Reflect.get(u, 'input_tokens') === 'number' && typeof Reflect.get(u, 'output_tokens') === 'number';
      const usage: TokenUsage = {
        inputTokens: n(Reflect.get(u, 'input_tokens')),
        outputTokens: n(Reflect.get(u, 'output_tokens')),
        cacheReadTokens: n(Reflect.get(u, 'cache_read_input_tokens')),
        cacheWriteTokens: n(Reflect.get(u, 'cache_creation_input_tokens')),
      };
      const content = Reflect.get(obj, 'content');
      const block = Array.isArray(content) ? content.find((b: unknown) => b && typeof b === 'object' && Reflect.get(b, 'type') === 'tool_use') : undefined;
      return {
        toolInput: block ? Reflect.get(block, 'input') : undefined,
        usage,
        usageKnown,
        truncated: Reflect.get(obj, 'stop_reason') === 'max_tokens',
      };
    },
  };
}

export { SYSTEM_PROMPT };
