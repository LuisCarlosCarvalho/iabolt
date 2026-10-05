import { AI_STYLE_PROPS } from './contract.ts';
import type { TokenUsage } from './limits.ts';
import { portableToolSchema, TOOL_NAME } from './prompt.ts';
import { parseArgs, plainText, ProviderError, providerErrorDetail, providerErrorDiagnostic, TOOL_DESCRIPTION, type AiProvider, type FetchLike, type KeyCheck } from './provider.ts';
import type { GeneratedImage, ImageGenerator, ImageRequest } from './images.ts';

/**
 * Adaptador Google Gemini (Interactions API, `POST /v1beta/interactions`), confirmado na
 * documentação oficial a 30/09/2026:
 *  - ferramentas `{type: "function", name, description, parameters}`;
 *  - `generation_config.tool_choice: "any"` obriga a chamar uma função; `max_output_tokens`;
 *    `thinking_level` (o raciocínio conta como saída e dentro de `max_output_tokens`);
 *  - resposta com `status` (`incomplete` = limite de saída) e `steps` (`function_call` com
 *    `name`/`arguments`; `model_output` com texto ou imagem); consumo em `usage.total_*`;
 *  - `store: false`: a interação não fica guardada.
 * Nenhum parâmetro de outro fornecedor é reutilizado aqui.
 */
const BASE = 'https://generativelanguage.googleapis.com';

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): object | null => (v && typeof v === 'object' ? v : null);

/**
 * Nível de raciocínio por modelo: o Gemini 3.8 Flash não o desliga (por omissão «medium»); usa-se
 * «low». O 3.5 Flash-Lite não pensa por omissão e não recebe o campo.
 */
const THINKING: Readonly<Record<string, string>> = { 'gemini-3.8-flash': 'low' };

/** Palavras do JSON Schema que o Gemini não aceita no esquema das funções (documentação oficial). */
const UNSUPPORTED = new Set(['pattern', 'minLength', 'maxLength', '$schema']);

/**
 * Esquema da ferramenta no subconjunto de JSON Schema que o Gemini aceita. Com o esquema completo a
 * Google respondia 400 «Request contains an invalid argument» (pedido real de 05/10/2026):
 *  - `const` → `enum` com um só valor;
 *  - `pattern`, `minLength`, `maxLength` → omitidos;
 *  - objeto aberto (só `additionalProperties`, ex.: `style`) → propriedades explícitas (as de
 *    `AI_STYLE_PROPS`): o Gemini exige `properties` não vazias num objeto.
 * Não enfraquece nada: o servidor volta a validar a proposta com o contrato completo (limites,
 * formatos, operações permitidas) antes de ela poder ser aplicada.
 */
export function geminiToolSchema(): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (UNSUPPORTED.has(k)) continue;
      if (k === 'const') out.enum = [x];
      else out[k] = walk(x);
    }
    const props = out.properties;
    const open = out.additionalProperties;
    if (out.type === 'object' && (!props || (typeof props === 'object' && Object.keys(props).length === 0)) && open && typeof open === 'object') {
      out.properties = Object.fromEntries(AI_STYLE_PROPS.map((name) => [name, open]));
      out.additionalProperties = false;
    }
    return out;
  };
  const schema = walk(portableToolSchema());
  return schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as Record<string, unknown>) : {};
}

export function googleRequestBody(model: string, system: string, user: string, maxOutputTokens: number): Record<string, unknown> {
  const thinking = THINKING[model];
  return {
    model,
    system_instruction: system,
    input: user,
    tools: [{ type: 'function', name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: geminiToolSchema() }],
    generation_config: { tool_choice: 'any', max_output_tokens: maxOutputTokens, ...(thinking ? { thinking_level: thinking } : {}) },
    store: false,
  };
}

/** A interação vem na raiz ou em `interaction` (as duas formas aparecem na documentação). */
const interactionOf = (body: unknown): object => {
  const root = obj(body) ?? {};
  return obj(Reflect.get(root, 'interaction')) ?? root;
};

/**
 * Consumo: entrada total ao preço de entrada (o desconto de cache não é aplicado: nunca abaixo do
 * real) e saída + raciocínio ao preço de saída.
 */
export function geminiUsage(it: object): { usage: TokenUsage; known: boolean } {
  const u = obj(Reflect.get(it, 'usage'));
  if (!u || typeof Reflect.get(u, 'total_input_tokens') !== 'number' || typeof Reflect.get(u, 'total_output_tokens') !== 'number') {
    return { usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, known: false };
  }
  return {
    usage: {
      inputTokens: n(Reflect.get(u, 'total_input_tokens')),
      outputTokens: n(Reflect.get(u, 'total_output_tokens')) + n(Reflect.get(u, 'total_thought_tokens')),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    known: true,
  };
}

const stepsOf = (it: object): object[] => {
  const s = Reflect.get(it, 'steps');
  return (Array.isArray(s) ? s : []).map(obj).filter((x): x is object => x !== null);
};

async function post(opts: { apiKey: string; fetch: FetchLike; baseUrl?: string }, body: Record<string, unknown>, timeoutMs: number, what: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await opts.fetch(`${opts.baseUrl ?? BASE}/v1beta/interactions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const why = ctrl.signal.aborted ? 'O fornecedor não respondeu a tempo.' : `Falha de rede: ${e instanceof Error ? e.message : String(e)}`;
    throw new ProviderError(why, what === 'texto', 'unknown');
  } finally {
    clearTimeout(timer);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const server = res.status >= 500;
    const detail = providerErrorDetail(json);
    throw new ProviderError(
      `O fornecedor recusou o pedido${what === 'imagem' ? ' de imagem' : ''} (HTTP ${res.status}${detail ? ` · ${detail}` : ''}).`,
      what === 'texto' && (res.status === 429 || server),
      server ? 'unknown' : 'none',
      // Resposta completa (estado, código, detalhes): só para o registo do consumo.
      json === null ? '(resposta sem JSON)' : providerErrorDiagnostic(JSON.stringify(json)),
    );
  }
  return json;
}

export function googleProvider(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): AiProvider {
  return {
    model: opts.model,
    async propose(call) {
      const it = interactionOf(await post(opts, googleRequestBody(opts.model, call.system, call.user, call.maxOutputTokens), call.timeoutMs, 'texto'));
      const { usage, known } = geminiUsage(it);
      const truncated = Reflect.get(it, 'status') === 'incomplete';
      const steps = stepsOf(it);
      const fc = steps.find((s) => Reflect.get(s, 'type') === 'function_call' && Reflect.get(s, 'name') === TOOL_NAME);
      if (fc) {
        const args = Reflect.get(fc, 'arguments');
        return { toolInput: parseArgs(args), usage, usageKnown: known, truncated };
      }
      const texts = steps.filter((s) => Reflect.get(s, 'type') === 'model_output').flatMap((s) => {
        const c = Reflect.get(s, 'content');
        return Array.isArray(c) ? c : [];
      });
      return { toolInput: undefined, usage, usageKnown: known, truncated, noToolCall: { stopReason: truncated ? 'max_tokens' : 'end_turn', text: plainText(texts) } };
    },
  };
}

/**
 * Teste sem custo: `GET /v1beta/models/{modelo}` (chave e modelo). A Google responde 400 com
 * «API key not valid» a uma chave inválida. O formato do pedido não é verificado (sem contagem
 * gratuita confirmada para a Interactions API).
 */
export async function googleCheck(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string; timeoutMs?: number }): Promise<KeyCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await opts.fetch(`${opts.baseUrl ?? BASE}/v1beta/models/${encodeURIComponent(opts.model)}`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': opts.apiKey },
    });
    if (res.ok) return { ok: true, formatChecked: false };
    const detail = providerErrorDetail(await res.json().catch(() => null));
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key|API_KEY/i.test(detail))) return { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' };
    if (res.status === 404) return { ok: false, definitive: true, reason: 'O modelo escolhido não está disponível para esta chave.' };
    return { ok: false, definitive: false, reason: `O fornecedor não confirmou a chave (HTTP ${res.status}). Tente de novo.` };
  } catch {
    return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Imagens Gemini (Interactions API com `response_format: {type: "image", …}`): a imagem vem em
 * base64 (`output_image` ou um passo `model_output` com conteúdo `image`). Preço por imagem
 * publicado (resolução 1K), aplicado pelo servidor.
 */
export function googleImageGenerator(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): ImageGenerator {
  return {
    model: opts.model,
    async generate(req: ImageRequest, timeoutMs: number): Promise<GeneratedImage> {
      const it = interactionOf(
        await post(
          opts,
          {
            model: opts.model,
            input: [{ type: 'text', text: req.prompt }],
            response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: req.aspect, image_size: '1K' },
            store: false,
          },
          timeoutMs,
          'imagem',
        ),
      );
      const direct = obj(Reflect.get(it, 'output_image'));
      const fromSteps = stepsOf(it)
        .flatMap((s) => {
          const c = Reflect.get(s, 'content');
          return Array.isArray(c) ? c : [];
        })
        .map(obj)
        .find((c) => c && Reflect.get(c, 'type') === 'image');
      const img = direct ?? fromSteps ?? null;
      const data = img ? Reflect.get(img, 'data') : null;
      const mime = img ? Reflect.get(img, 'mime_type') : null;
      if (typeof data !== 'string' || !data) throw new ProviderError('O fornecedor não devolveu a imagem.', false, 'unknown');
      return { mime: mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg', base64: data, tokens: null };
    },
  };
}
