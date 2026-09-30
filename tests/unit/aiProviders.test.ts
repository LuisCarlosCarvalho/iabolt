import { describe, expect, it } from 'vitest';
import { googleCheck, googleImageGenerator, googleProvider } from '../../supabase/functions/_shared/ai/google.ts';
import type { Reservation, Settlement } from '../../supabase/functions/_shared/ai/handler.ts';
import { handleImage, type ImageDeps } from '../../supabase/functions/_shared/ai/imageHandler.ts';
import { RuntimeSettings } from '../../supabase/functions/_shared/ai/limits.ts';
import { openaiCheck, openaiImageGenerator, openaiProvider } from '../../supabase/functions/_shared/ai/openai.ts';
import { portableToolSchema } from '../../supabase/functions/_shared/ai/prompt.ts';
import { ProviderError } from '../../supabase/functions/_shared/ai/provider.ts';
import { makeEditProvider, makeImageGenerator, PROVIDER_IDS } from '../../supabase/functions/_shared/ai/registry.ts';

/**
 * [simulado] Adaptadores OpenAI e Google Gemini e geração de imagens, com um fornecedor FALSO
 * (sem rede, sem custo). Provam o pedido enviado e a leitura das respostas, não a qualidade.
 */
type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(replies: { status: number; body: unknown }[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = replies.shift() ?? { status: 500, body: null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, sent };
}
const bodyOf = (s: Sent | undefined): Record<string, unknown> => JSON.parse(s?.body ?? '{}');
const CALL = { system: 'S', user: 'U', maxOutputTokens: 900, timeoutMs: 1000 };
const PROPOSAL = { summary: 'ok', operations: [] };

describe('esquema portável', () => {
  it('sem oneOf, propertyNames nem $schema (validação completa continua no servidor com zod)', () => {
    const txt = JSON.stringify(portableToolSchema());
    expect(txt).not.toMatch(/"oneOf"|"propertyNames"|"\$schema"/);
    expect(txt).toContain('"anyOf"');
  });

  it('registo: só os três fornecedores implementados; a Anthropic não gera imagens', () => {
    expect([...PROVIDER_IDS]).toEqual(['anthropic', 'openai', 'google']);
    const { fetch } = fakeFetch([]);
    expect(makeImageGenerator('anthropic', { apiKey: 'k', model: 'm', fetch })).toBeNull();
    expect(makeImageGenerator('google', { apiKey: 'k', model: 'm', fetch })).not.toBeNull();
    expect(makeEditProvider('openai', { apiKey: 'k', model: 'gpt-6-luna', fetch }).model).toBe('gpt-6-luna');
  });
});

describe('[simulado] OpenAI (Responses API)', () => {
  it('pedido: ferramenta de função forçada, sem modo estrito, raciocínio baixo, sem guardar; chave só no cabeçalho', async () => {
    const { fetch, sent } = fakeFetch([
      { status: 200, body: { status: 'completed', output: [{ type: 'reasoning' }, { type: 'function_call', name: 'propor_operacoes', arguments: JSON.stringify(PROPOSAL), call_id: 'c1' }], usage: { input_tokens: 1000, output_tokens: 80, input_tokens_details: { cached_tokens: 400 } } } },
    ]);
    const r = await openaiProvider({ apiKey: 'sk-oa', model: 'gpt-6.1-sol', fetch }).propose(CALL);
    expect(sent[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(sent[0]?.headers.authorization).toBe('Bearer sk-oa');
    const b = bodyOf(sent[0]);
    expect(b).toMatchObject({ model: 'gpt-6.1-sol', instructions: 'S', input: 'U', tool_choice: { type: 'function', name: 'propor_operacoes' }, reasoning: { effort: 'low' }, max_output_tokens: 900, store: false });
    expect(b.tools).toMatchObject([{ type: 'function', name: 'propor_operacoes', strict: false }]);
    // Nada de parâmetros de outro fornecedor.
    expect(JSON.stringify(b)).not.toMatch(/tool_use|input_schema|cache_control|thinking|generation_config/);
    expect(r).toMatchObject({ toolInput: PROPOSAL, usageKnown: true, truncated: false });
    // Entrada em cache separada (input_tokens já a inclui).
    expect(r.usage).toEqual({ inputTokens: 600, outputTokens: 80, cacheReadTokens: 400, cacheWriteTokens: 0 });
  });

  it('sem chamada da ferramenta (texto ou recusa) e resposta incompleta; erros com o motivo e sem repetir 4xx', async () => {
    const text = fakeFetch([{ status: 200, body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Não posso.' }] }], usage: { input_tokens: 10, output_tokens: 3 } } }]);
    expect((await openaiProvider({ apiKey: 'k', model: 'm', fetch: text.fetch }).propose(CALL)).noToolCall).toEqual({ stopReason: 'end_turn', text: 'Não posso.' });
    const refusal = fakeFetch([{ status: 200, body: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'x' }] }] } }]);
    const rr = await openaiProvider({ apiKey: 'k', model: 'm', fetch: refusal.fetch }).propose(CALL);
    expect(rr.noToolCall?.stopReason).toBe('refusal');
    expect(rr.usageKnown).toBe(false);
    const cut = fakeFetch([{ status: 200, body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 10, output_tokens: 900 } } }]);
    expect((await openaiProvider({ apiKey: 'k', model: 'm', fetch: cut.fetch }).propose(CALL)).truncated).toBe(true);
    const bad = fakeFetch([{ status: 400, body: { error: { type: 'invalid_request_error', message: 'unsupported parameter' } } }]);
    const err = await openaiProvider({ apiKey: 'k', model: 'm', fetch: bad.fetch }).propose(CALL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err instanceof ProviderError && [err.message, err.retriable, err.charged]).toEqual(['O fornecedor recusou o pedido (HTTP 400 · invalid_request_error: unsupported parameter).', false, 'none']);
  });

  it('teste sem custo: só GET do modelo; credenciais sem verificação de formato', async () => {
    const ok = fakeFetch([{ status: 200, body: { id: 'gpt-6-luna' } }]);
    expect(await openaiCheck({ apiKey: 'k', model: 'gpt-6-luna', fetch: ok.fetch })).toEqual({ ok: true, formatChecked: false });
    expect(ok.sent.map((s) => `${s.method} ${s.url}`)).toEqual(['GET https://api.openai.com/v1/models/gpt-6-luna']);
    expect(await openaiCheck({ apiKey: 'k', model: 'm', fetch: fakeFetch([{ status: 401, body: {} }]).fetch })).toMatchObject({ ok: false, definitive: true });
    expect(await openaiCheck({ apiKey: 'k', model: 'm', fetch: fakeFetch([{ status: 404, body: {} }]).fetch })).toMatchObject({ ok: false, definitive: true });
  });

  it('imagem: base64 (nunca um endereço) e tokens indicados', async () => {
    const { fetch, sent } = fakeFetch([{ status: 200, body: { data: [{ b64_json: 'QUJDREVGR0hJSktMTU5PUA==' }], usage: { input_tokens: 20, output_tokens: 1000 } } }]);
    const img = await openaiImageGenerator({ apiKey: 'k', model: 'gpt-image-2.5-flare', fetch }).generate({ prompt: 'um parque infantil', aspect: '16:9' }, 1000);
    expect(bodyOf(sent[0])).toMatchObject({ model: 'gpt-image-2.5-flare', prompt: 'um parque infantil', size: '1536x1024', output_format: 'jpeg', n: 1 });
    expect(img).toEqual({ mime: 'image/jpeg', base64: 'QUJDREVGR0hJSktMTU5PUA==', tokens: { input: 20, output: 1000 } });
  });
});

describe('[simulado] Google Gemini (Interactions API)', () => {
  it('pedido: função obrigatória (any), raciocínio «low» só no 3.8 Flash, sem guardar; chave só no cabeçalho', async () => {
    const reply = { status: 'completed', steps: [{ type: 'thought' }, { type: 'function_call', name: 'propor_operacoes', arguments: PROPOSAL, id: 'f1' }], usage: { total_input_tokens: 1200, total_output_tokens: 60, total_thought_tokens: 40, total_cached_tokens: 0 } };
    const { fetch, sent } = fakeFetch([{ status: 200, body: reply }, { status: 200, body: { interaction: reply } }]);
    const r = await googleProvider({ apiKey: 'AIza-g', model: 'gemini-3.8-flash', fetch }).propose(CALL);
    expect(sent[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(sent[0]?.headers['x-goog-api-key']).toBe('AIza-g');
    expect(sent[0]?.url).not.toContain('AIza');
    const b = bodyOf(sent[0]);
    expect(b).toMatchObject({ model: 'gemini-3.8-flash', system_instruction: 'S', input: 'U', generation_config: { tool_choice: 'any', max_output_tokens: 900, thinking_level: 'low' }, store: false });
    expect(JSON.stringify(b)).not.toMatch(/input_schema|cache_control|reasoning|max_tokens"/);
    // Saída conta com o raciocínio.
    expect(r).toMatchObject({ toolInput: PROPOSAL, usageKnown: true, usage: { inputTokens: 1200, outputTokens: 100 } });
    // Forma com «interaction» na raiz também é lida; o Flash-Lite não recebe thinking_level.
    const lite = await googleProvider({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetch }).propose(CALL);
    expect(lite.toolInput).toEqual(PROPOSAL);
    expect(bodyOf(sent[1]).generation_config).toEqual({ tool_choice: 'any', max_output_tokens: 900 });
  });

  it('sem função, incompleta, argumentos em texto e erros', async () => {
    const text = fakeFetch([{ status: 200, body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Qual imagem?' }] }] } }]);
    expect((await googleProvider({ apiKey: 'k', model: 'm', fetch: text.fetch }).propose(CALL)).noToolCall).toEqual({ stopReason: 'end_turn', text: 'Qual imagem?' });
    const cut = fakeFetch([{ status: 200, body: { status: 'incomplete', steps: [] } }]);
    expect((await googleProvider({ apiKey: 'k', model: 'm', fetch: cut.fetch }).propose(CALL)).truncated).toBe(true);
    const asText = fakeFetch([{ status: 200, body: { status: 'completed', steps: [{ type: 'function_call', name: 'propor_operacoes', arguments: JSON.stringify(PROPOSAL) }] } }]);
    expect((await googleProvider({ apiKey: 'k', model: 'm', fetch: asText.fetch }).propose(CALL)).toolInput).toEqual(PROPOSAL);
    const bad = fakeFetch([{ status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad field' } } }]);
    const err = await googleProvider({ apiKey: 'k', model: 'm', fetch: bad.fetch }).propose(CALL).catch((e: unknown) => e);
    expect(err instanceof ProviderError && [err.message, err.retriable]).toEqual(['O fornecedor recusou o pedido (HTTP 400 · INVALID_ARGUMENT: bad field).', false]);
  });

  it('teste sem custo: GET do modelo; chave inválida (400 «API key not valid») é recusa definitiva', async () => {
    const ok = fakeFetch([{ status: 200, body: { name: 'models/gemini-3.8-flash' } }]);
    expect(await googleCheck({ apiKey: 'k', model: 'gemini-3.8-flash', fetch: ok.fetch })).toEqual({ ok: true, formatChecked: false });
    expect(ok.sent[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash');
    const invalid = fakeFetch([{ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } } }]);
    expect(await googleCheck({ apiKey: 'k', model: 'm', fetch: invalid.fetch })).toMatchObject({ ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' });
    expect(await googleCheck({ apiKey: 'k', model: 'm', fetch: fakeFetch([{ status: 503, body: {} }]).fetch })).toMatchObject({ ok: false, definitive: false });
  });

  it('imagem: pedido com formato de imagem 1K; base64 de output_image ou dos passos', async () => {
    const a = fakeFetch([{ status: 200, body: { output_image: { data: 'QUFBQUFBQUFBQUFBQUFBQQ==', mime_type: 'image/png' } } }]);
    const img = await googleImageGenerator({ apiKey: 'k', model: 'gemini-3.1-flash-image', fetch: a.fetch }).generate({ prompt: 'parque infantil', aspect: '16:9' }, 1000);
    expect(bodyOf(a.sent[0])).toMatchObject({ model: 'gemini-3.1-flash-image', response_format: { type: 'image', aspect_ratio: '16:9', image_size: '1K' }, store: false });
    expect(img).toEqual({ mime: 'image/png', base64: 'QUFBQUFBQUFBQUFBQUFBQQ==', tokens: null });
    const b = fakeFetch([{ status: 200, body: { interaction: { steps: [{ type: 'model_output', content: [{ type: 'image', data: 'QkJCQkJCQkJCQkJCQkJCQg==', mime_type: 'image/jpeg' }] }] } } }]);
    expect((await googleImageGenerator({ apiKey: 'k', model: 'm', fetch: b.fetch }).generate({ prompt: 'x x x', aspect: '1:1' }, 1000)).base64).toBe('QkJCQkJCQkJCQkJCQkJCQg==');
    const none = fakeFetch([{ status: 200, body: { steps: [] } }]);
    await expect(googleImageGenerator({ apiKey: 'k', model: 'm', fetch: none.fetch }).generate({ prompt: 'x x x', aspect: '1:1' }, 1000)).rejects.toThrow('não devolveu a imagem');
  });
});

describe('[simulado] função ai-image (gerador falso)', () => {
  const RT = RuntimeSettings.parse({
    enabled: true,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    model_label: 'Claude Sonnet 5.5',
    key_status: 'valid',
    image_enabled: true,
    image_provider: 'google',
    image_model: 'gemini-3.1-flash-image',
    image_label: 'Gemini 3.1 Flash Image',
    image_key_status: 'valid',
    image_prices: { input: 0.5, output: 3, image: 0.067 },
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
    prices: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  });
  const req = (over: Record<string, unknown> = {}) => JSON.stringify({ contract: 1, requestId: crypto.randomUUID(), projectId: 'p1', prompt: 'um parque infantil ao sol', aspect: '16:9', ...over });
  const deps = (gen: () => Promise<{ mime: 'image/jpeg'; base64: string; tokens: null }>, over: Partial<ImageDeps> = {}) => {
    const reserved: Reservation[] = [];
    const settled: Settlement[] = [];
    let calls = 0;
    const d: ImageDeps & { reserved: Reservation[]; settled: Settlement[]; calls: () => number } = {
      reserved,
      settled,
      calls: () => calls,
      forceDisabled: false,
      now: () => 0,
      getUser: async (h) => (h === 'Bearer ok' ? { id: 'u1' } : null),
      projectWorkspace: async () => 'w1',
      loadRuntime: async () => RT,
      providerKey: async (p) => (p === 'google' ? 'AIza-servidor' : null),
      makeGenerator: (_p, model) => ({
        model,
        generate: async () => {
          calls += 1;
          return gen();
        },
      }),
      reserve: async (r) => {
        reserved.push(r);
        return { ok: true, id: 'r1' };
      },
      settle: async (_id, s) => {
        settled.push(s);
      },
      release: async () => undefined,
      ...over,
    };
    return d;
  };

  it('reserva o teto por imagem (tipo imagem, fornecedor de imagens) e regista a tarifa como custo confirmado', async () => {
    const d = deps(async () => ({ mime: 'image/jpeg', base64: 'QUJDREVGR0hJSktMTU5PUA==', tokens: null }));
    const r = await handleImage('Bearer ok', req(), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mime: 'image/jpeg', model: 'gemini-3.1-flash-image', provider: 'google', costUsd: 0.067, estimated: false, simulated: false });
    expect(d.reserved[0]).toMatchObject({ provider: 'google', model: 'gemini-3.1-flash-image', kind: 'image', reserveUsd: 0.067 });
    expect(d.settled[0]).toMatchObject({ status: 'done', confirmedCostUsd: 0.067, unknownCostUsd: 0 });
    // Nenhum endereço devolvido: só dados.
    expect(JSON.stringify(r.body)).not.toMatch(/https?:\/\//);
  });

  it('falha: sem repetição; consumo desconhecido conta pelo teto; desativado/sem sessão não chamam o fornecedor', async () => {
    const d = deps(async () => {
      throw new ProviderError('O fornecedor não respondeu a tempo.', false, 'unknown');
    });
    const r = await handleImage('Bearer ok', req(), d);
    expect(r.status).toBe(502);
    expect(d.calls()).toBe(1);
    expect(d.settled[0]).toMatchObject({ status: 'failed', unknownCostUsd: 0.067, confirmedCostUsd: 0 });

    const off = deps(async () => ({ mime: 'image/jpeg', base64: 'x'.repeat(20), tokens: null }), { loadRuntime: async () => ({ ...RT, image_enabled: false }) });
    expect((await handleImage('Bearer ok', req(), off)).status).toBe(503);
    expect(off.calls()).toBe(0);
    expect((await handleImage(null, req(), off)).status).toBe(401);
    expect((await handleImage('Bearer ok', req({ prompt: '' }), off)).status).toBe(400);
    expect((await handleImage('Bearer ok', req({ aspect: '2:1' }), off)).status).toBe(400);
  });
});
