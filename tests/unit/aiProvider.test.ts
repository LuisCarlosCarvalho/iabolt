import { describe, expect, it } from 'vitest';
import { anthropicCheck, anthropicProvider, ProviderError, providerErrorDetail } from '../../supabase/functions/_shared/ai/provider.ts';
import { toolInputSchema } from '../../supabase/functions/_shared/ai/prompt.ts';

type Sent = { url: string; method: string; body?: string };

/** Fornecedor simulado: responde por ordem, e regista o que recebeu. */
function fakeFetch(replies: { status: number; body: unknown }[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    sent.push({ url, method: init.method, body: init.body });
    const r = replies.shift() ?? { status: 500, body: null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, sent };
}

const badRequest = { type: 'error', error: { type: 'invalid_request_error', message: 'tools.0.input_schema: formato inválido' } };

describe('adaptador do fornecedor', () => {
  it('o esquema da ferramenta não leva $schema', () => {
    expect(toolInputSchema()).not.toHaveProperty('$schema');
    expect(toolInputSchema()).toHaveProperty('type', 'object');
  });

  it('o motivo do fornecedor é extraído e nada parecido com uma chave passa', () => {
    expect(providerErrorDetail(badRequest)).toBe('invalid_request_error: tools.0.input_schema: formato inválido');
    const leaky = { error: { type: 'x', message: 'chave sk-ant-api03-abcdefghijklmnop inválida' } };
    expect(providerErrorDetail(leaky)).not.toContain('sk-ant');
    expect(providerErrorDetail(null)).toBe('');
    expect(providerErrorDetail({ error: 'texto' })).toBe('');
  });

  it('um erro no pedido real mostra o motivo do fornecedor', async () => {
    const { fetch } = fakeFetch([{ status: 400, body: badRequest }]);
    const provider = anthropicProvider({ apiKey: 'k', model: 'm', fetch });
    const err = await provider.propose({ system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err instanceof ProviderError && err.message).toBe('O fornecedor recusou o pedido (HTTP 400 · invalid_request_error: tools.0.input_schema: formato inválido).');
    expect(err instanceof ProviderError && err.charged).toBe('none');
  });

  it('regressão: pedido ao Claude Sonnet 5.5 sem ferramenta forçada e sem raciocínio inicial', async () => {
    const { fetch, sent } = fakeFetch([{ status: 200, body: { content: [], stop_reason: 'end_turn' } }]);
    await anthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', fetch }).propose({ system: 's', user: 'u', maxOutputTokens: 900, timeoutMs: 1000 });
    const body: unknown = JSON.parse(sent[0]?.body ?? '{}');
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 900,
      thinking: { type: 'between_tools' },
      tool_choice: { type: 'auto' },
      tools: [{ name: 'propor_operacoes' }],
    });
    expect(JSON.stringify(body)).not.toMatch(/"type":"(tool|any|disabled)"/);
    // Os outros modelos do catálogo não pensam por omissão: não recebem o campo.
    const haiku = fakeFetch([{ status: 200, body: { content: [] } }]);
    await anthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5-20251001', fetch: haiku.fetch }).propose({ system: 's', user: 'u', maxOutputTokens: 900, timeoutMs: 1000 });
    expect(JSON.parse(haiku.sent[0]?.body ?? '{}')).not.toHaveProperty('thinking');
  });

  it('resposta sem chamada da ferramenta: sem entrada, marcada com o motivo e o texto (sem chaves)', async () => {
    const usage = { input_tokens: 100, output_tokens: 20 };
    const textOnly = { content: [{ type: 'text', text: 'Não consigo   trocar imagens. sk-ant-api03-abcdefghijk' }], stop_reason: 'end_turn', usage };
    const { fetch } = fakeFetch([{ status: 200, body: textOnly }]);
    const r = await anthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', fetch }).propose({ system: 's', user: 'u', maxOutputTokens: 900, timeoutMs: 1000 });
    expect(r.toolInput).toBeUndefined();
    expect(r.usageKnown).toBe(true);
    expect(r.noToolCall).toEqual({ stopReason: 'end_turn', text: 'Não consigo trocar imagens. [removido]' });

    // Com a ferramenta (mesmo depois de um bloco de raciocínio), a entrada segue para validação.
    const withTool = { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', name: 'propor_operacoes', input: { summary: 'x', operations: [] } }], stop_reason: 'tool_use', usage };
    const t = fakeFetch([{ status: 200, body: withTool }]);
    const r2 = await anthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', fetch: t.fetch }).propose({ system: 's', user: 'u', maxOutputTokens: 900, timeoutMs: 1000 });
    expect(r2.toolInput).toEqual({ summary: 'x', operations: [] });
    expect(r2.noToolCall).toBeUndefined();
  });

  it('«Testar ligação» consulta o modelo e depois conta os tokens do pedido real, sem gerar', async () => {
    const { fetch, sent } = fakeFetch([{ status: 200, body: {} }, { status: 200, body: { input_tokens: 900 } }]);
    await expect(anthropicCheck({ apiKey: 'k', model: 'm', fetch })).resolves.toEqual({ ok: true });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET https://api.anthropic.com/v1/models/m',
      'POST https://api.anthropic.com/v1/messages/count_tokens',
    ]);
    const body: unknown = JSON.parse(sent[1]?.body ?? '{}');
    expect(body).toMatchObject({ model: 'm', tool_choice: { type: 'auto' } });
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('formato recusado: a chave vale, com aviso e o motivo; chave recusada: não chega a contar', async () => {
    const format = fakeFetch([{ status: 200, body: {} }, { status: 400, body: badRequest }]);
    await expect(anthropicCheck({ apiKey: 'k', model: 'm', fetch: format.fetch })).resolves.toEqual({
      ok: true,
      warning: 'Chave e modelo reconhecidos, mas o fornecedor recusou o formato do pedido do assistente (HTTP 400 · invalid_request_error: tools.0.input_schema: formato inválido).',
    });
    const key = fakeFetch([{ status: 401, body: {} }]);
    await expect(anthropicCheck({ apiKey: 'k', model: 'm', fetch: key.fetch })).resolves.toMatchObject({ ok: false, definitive: true });
    expect(key.sent).toHaveLength(1);
  });
});
