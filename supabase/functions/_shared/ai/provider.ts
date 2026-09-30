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
  /**
   * O modelo respondeu SEM chamar a ferramenta (texto livre, ou recusa): tratada como inválida e
   * nunca aplicada. `text` é só para diagnóstico (curto, texto simples).
   */
  noToolCall?: { stopReason: string; text: string };
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

export const TOOL_DESCRIPTION = 'Propõe operações validadas sobre o âmbito do pedido.';

/** Tudo o que é enviado ao fornecedor numa tentativa (base do limite de tokens de entrada). */
export function sentText(user: string): string {
  return SYSTEM_PROMPT + TOOL_NAME + TOOL_DESCRIPTION + JSON.stringify(toolInputSchema()) + user;
}

/**
 * Motivo indicado pelo fornecedor num erro (tipo e mensagem), para diagnóstico. As mensagens do
 * fornecedor não trazem a chave; mesmo assim, tudo o que se pareça com uma chave é removido.
 */
export function providerErrorDetail(body: unknown): string {
  const err = body && typeof body === 'object' ? Reflect.get(body, 'error') : null;
  // Anthropic e OpenAI: error.type; Google: error.status.
  const type = err && typeof err === 'object' ? (Reflect.get(err, 'type') ?? Reflect.get(err, 'status')) : null;
  const message = err && typeof err === 'object' ? Reflect.get(err, 'message') : null;
  const parts = [typeof type === 'string' ? type : '', typeof message === 'string' ? message : ''].filter(Boolean);
  return parts
    .join(': ')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[removido]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[removido]')
    .slice(0, 240);
}

/**
 * Parâmetros próprios de cada modelo. Claude Sonnet 5.5 pensa por omissão (raciocínio adaptativo,
 * esforço «high»), e esse raciocínio conta como saída dentro de `max_tokens`: podia esgotar o
 * limite antes da chamada da ferramenta. `between_tools` é o nível mais baixo (sem raciocínio
 * inicial); `disabled` é recusado neste modelo. Os restantes modelos do catálogo não pensam por
 * omissão e não recebem o campo.
 */
const MODEL_PARAMS: Readonly<Record<string, Record<string, unknown>>> = {
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' } },
};

/**
 * Corpo do pedido ao fornecedor (o mesmo na chamada real e na verificação de formato).
 * `tool_choice` é «auto»: o Claude Sonnet 5.5 recusa forçar a ferramenta (`tool`/`any` → HTTP 400).
 * As instruções exigem a ferramenta, e uma resposta sem ela é inválida (ver `noToolCall`).
 */
export function requestBody(model: string, system: string, user: string): Record<string, unknown> {
  return {
    model,
    ...MODEL_PARAMS[model],
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: toolInputSchema() }],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  };
}

/** Texto das respostas sem ferramenta, só para diagnóstico: curto e sem nada parecido com uma chave. */
export function plainText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((b: unknown) => (b && typeof b === 'object' && Reflect.get(b, 'type') === 'text' ? Reflect.get(b, 'text') : ''))
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[removido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Argumentos de uma chamada de função (objeto ou JSON em texto); inválidos → null (resposta inválida). */
export function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Resultado do teste de ligação. `definitive`: o fornecedor respondeu (chave ou modelo recusados). */
/**
 * `warning`: a chave e o modelo foram reconhecidos, mas o formato do pedido não ficou confirmado.
 * É um problema do pedido (código), não da chave: não recusa a chave nem desativa o assistente.
 */
export type KeyCheck = { ok: true; warning?: string; formatChecked?: boolean } | { ok: false; definitive: boolean; reason: string };

/**
 * «Testar ligação» SEM CUSTO, em dois passos, sem gerar texto:
 *  1. consulta o modelo (`GET /v1/models/{modelo}`): valida a chave e a visibilidade do modelo;
 *  2. conta os tokens do pedido REAL (`POST /v1/messages/count_tokens`, gratuito): valida o formato
 *     (instruções, ferramenta, esquema) tal como o assistente o envia.
 * Não prova que a geração funcione (créditos, limites): isso só o piloto. Nunca devolve a chave.
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
    if (res.status === 401 || res.status === 403) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
    if (res.status === 404) return { ok: false, definitive: true, reason: 'O modelo escolhido não está disponível para esta chave.' };
    if (!res.ok) return { ok: false, definitive: false, reason: `O fornecedor não confirmou a chave (HTTP ${res.status}). Tente de novo.` };
    const count = await opts.fetch(`${opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages/count_tokens`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(requestBody(opts.model, SYSTEM_PROMPT, '<pedido>teste de formato</pedido>')),
    });
    if (count.ok) return { ok: true };
    const detail = providerErrorDetail(await count.json().catch(() => null));
    const refused = count.status >= 400 && count.status < 500 && count.status !== 429;
    const what = refused ? 'recusou o formato do pedido do assistente' : 'não confirmou o formato do pedido do assistente';
    return { ok: true, warning: `Chave e modelo reconhecidos, mas o fornecedor ${what} (HTTP ${count.status}${detail ? ` · ${detail}` : ''}).` };
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
          body: JSON.stringify({ ...requestBody(opts.model, call.system, call.user), max_tokens: call.maxOutputTokens }),
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
        const detail = providerErrorDetail(body);
        throw new ProviderError(`O fornecedor recusou o pedido (HTTP ${res.status}${detail ? ` · ${detail}` : ''}).`, res.status === 429 || server, server ? 'unknown' : 'none');
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
      const stopReason = Reflect.get(obj, 'stop_reason');
      return {
        toolInput: block ? Reflect.get(block, 'input') : undefined,
        usage,
        usageKnown,
        truncated: stopReason === 'max_tokens',
        ...(block ? {} : { noToolCall: { stopReason: typeof stopReason === 'string' ? stopReason : 'desconhecido', text: plainText(content) } }),
      };
    },
  };
}

export { SYSTEM_PROMPT };
