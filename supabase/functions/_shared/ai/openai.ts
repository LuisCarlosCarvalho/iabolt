import type { TokenUsage } from './limits.ts';
import { portableToolSchema, TOOL_NAME } from './prompt.ts';
import { parseArgs, plainText, ProviderError, providerErrorDetail, TOOL_DESCRIPTION, type AiProvider, type FetchLike, type KeyCheck } from './provider.ts';
import type { GeneratedImage, ImageGenerator, ImageRequest } from './images.ts';

/**
 * Adaptador OpenAI (Responses API, `POST /v1/responses`), confirmado na documentação oficial a
 * 30/09/2026:
 *  - ferramenta de função (`type: "function"`, `parameters`, `strict: false`: o esquema completo usa
 *    construções que o modo estrito não aceita; a resposta é validada no servidor com zod);
 *  - `tool_choice: {"type": "function", "name": …}` força a ferramenta;
 *  - `reasoning: {effort: "low"}`: o raciocínio conta como saída dentro de `max_output_tokens`;
 *  - `store: false`: o pedido não fica guardado no fornecedor;
 *  - chamadas na saída como itens `function_call` com `arguments` em JSON (texto).
 * Nenhum parâmetro de outro fornecedor é reutilizado aqui.
 */
const BASE = 'https://api.openai.com';

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): object | null => (v && typeof v === 'object' ? v : null);

export function openaiRequestBody(model: string, system: string, user: string, maxOutputTokens: number): Record<string, unknown> {
  return {
    model,
    instructions: system,
    input: user,
    tools: [{ type: 'function', name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: portableToolSchema(), strict: false }],
    tool_choice: { type: 'function', name: TOOL_NAME },
    reasoning: { effort: 'low' },
    max_output_tokens: maxOutputTokens,
    store: false,
  };
}

/** Consumo da Responses API: `input_tokens` inclui os tokens em cache (`input_tokens_details.cached_tokens`). */
function usageOf(body: object): { usage: TokenUsage; known: boolean } {
  const u = obj(Reflect.get(body, 'usage'));
  if (!u || typeof Reflect.get(u, 'input_tokens') !== 'number' || typeof Reflect.get(u, 'output_tokens') !== 'number') {
    return { usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, known: false };
  }
  const details = obj(Reflect.get(u, 'input_tokens_details'));
  const cached = Math.min(n(details ? Reflect.get(details, 'cached_tokens') : 0), n(Reflect.get(u, 'input_tokens')));
  return {
    usage: { inputTokens: n(Reflect.get(u, 'input_tokens')) - cached, outputTokens: n(Reflect.get(u, 'output_tokens')), cacheReadTokens: cached, cacheWriteTokens: 0 },
    known: true,
  };
}

export function openaiProvider(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): AiProvider {
  return {
    model: opts.model,
    async propose(call) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), call.timeoutMs);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await opts.fetch(`${opts.baseUrl ?? BASE}/v1/responses`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(openaiRequestBody(opts.model, call.system, call.user, call.maxOutputTokens)),
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
      const root = obj(body) ?? {};
      const { usage, known } = usageOf(root);
      const output = Reflect.get(root, 'output');
      const items: unknown[] = Array.isArray(output) ? output : [];
      const call0 = items.map(obj).find((i) => i && Reflect.get(i, 'type') === 'function_call' && Reflect.get(i, 'name') === TOOL_NAME);
      const incomplete = obj(Reflect.get(root, 'incomplete_details'));
      const truncated = Reflect.get(root, 'status') === 'incomplete' && (!incomplete || Reflect.get(incomplete, 'reason') === 'max_output_tokens');
      if (call0) {
        const args = Reflect.get(call0, 'arguments');
        return { toolInput: parseArgs(args), usage, usageKnown: known, truncated };
      }
      // Sem chamada da ferramenta: mensagem de texto ou recusa (itens «message»).
      const contents = items.flatMap((i) => {
        const c = obj(i) ? Reflect.get(obj(i) ?? {}, 'content') : null;
        return Array.isArray(c) ? c : [];
      });
      const refused = contents.some((c) => obj(c) && Reflect.get(obj(c) ?? {}, 'type') === 'refusal');
      const text = plainText(contents.map((c) => (obj(c) && Reflect.get(obj(c) ?? {}, 'type') === 'output_text' ? { type: 'text', text: Reflect.get(obj(c) ?? {}, 'text') } : c)));
      return { toolInput: undefined, usage, usageKnown: known, truncated, noToolCall: { stopReason: refused ? 'refusal' : truncated ? 'max_tokens' : 'end_turn', text } };
    },
  };
}

/** Teste sem custo: `GET /v1/models/{modelo}` (chave e modelo). A OpenAI não tem contagem gratuita confirmada: o formato não é verificado. */
export async function openaiCheck(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string; timeoutMs?: number }): Promise<KeyCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await opts.fetch(`${opts.baseUrl ?? BASE}/v1/models/${encodeURIComponent(opts.model)}`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${opts.apiKey}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
    if (res.status === 404) return { ok: false, definitive: true, reason: 'O modelo escolhido não está disponível para esta chave.' };
    if (!res.ok) return { ok: false, definitive: false, reason: `O fornecedor não confirmou a chave (HTTP ${res.status}). Tente de novo.` };
    return { ok: true, formatChecked: false };
  } catch {
    return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
  } finally {
    clearTimeout(timer);
  }
}

const OPENAI_SIZES: Record<ImageRequest['aspect'], string> = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '3:4': '1024x1536', '9:16': '1024x1536' };

/**
 * Imagens OpenAI (`POST /v1/images/generations`): resposta em base64 (`data[0].b64_json`), nunca
 * um endereço. O custo vem dos tokens indicados (`usage`), aos preços do instantâneo.
 */
export function openaiImageGenerator(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): ImageGenerator {
  return {
    model: opts.model,
    async generate(req, timeoutMs): Promise<GeneratedImage> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await opts.fetch(`${opts.baseUrl ?? BASE}/v1/images/generations`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ model: opts.model, prompt: req.prompt, size: OPENAI_SIZES[req.aspect], quality: 'medium', output_format: 'jpeg', n: 1 }),
        });
      } catch (e) {
        throw new ProviderError(ctrl.signal.aborted ? 'O fornecedor não respondeu a tempo.' : `Falha de rede: ${e instanceof Error ? e.message : String(e)}`, false, 'unknown');
      } finally {
        clearTimeout(timer);
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = providerErrorDetail(body);
        throw new ProviderError(`O fornecedor recusou o pedido de imagem (HTTP ${res.status}${detail ? ` · ${detail}` : ''}).`, false, res.status >= 500 ? 'unknown' : 'none');
      }
      const root = obj(body) ?? {};
      const data = Reflect.get(root, 'data');
      const first = Array.isArray(data) ? obj(data[0]) : null;
      const b64 = first ? Reflect.get(first, 'b64_json') : null;
      const u = obj(Reflect.get(root, 'usage'));
      const tokens = u && typeof Reflect.get(u, 'output_tokens') === 'number' ? { input: n(Reflect.get(u, 'input_tokens')), output: n(Reflect.get(u, 'output_tokens')) } : null;
      if (typeof b64 !== 'string' || !b64) throw new ProviderError('O fornecedor não devolveu a imagem.', false, tokens ? 'none' : 'unknown');
      return { mime: 'image/jpeg', base64: b64, tokens };
    },
  };
}
