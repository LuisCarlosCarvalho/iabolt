import { describe, expect, it } from 'vitest';
import { DIAG_MAX_USD, geminiLadder, runGeminiLadder, stripKeywords, worstCaseUsd } from '../../supabase/functions/_shared/ai/googleDiagnose.ts';
import { geminiToolSchema, googleRequestBody } from '../../supabase/functions/_shared/ai/google.ts';
import { SYSTEM_PROMPT } from '../../supabase/functions/_shared/ai/prompt.ts';

/**
 * Diagnóstico progressivo do HTTP 400 do Gemini. As respostas aqui são SIMULADAS: confirmam a
 * mecânica (ordem, paragem, teto, sem chaves no relatório), não que a Google aceita o pedido.
 */
const FLASH_LITE = { input: 0.3, output: 2.5 };

function fake(replies: Array<{ status: number; body: unknown }>) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body ?? '{}') });
    const r = replies.shift() ?? { status: 200, body: { status: 'completed', steps: [], usage: { total_input_tokens: 10, total_output_tokens: 2 } } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, sent };
}

describe('diagnóstico progressivo do Gemini', () => {
  it('degraus: do mínimo ao pedido real, um elemento de cada vez; o último só muda o input face ao anterior', () => {
    const lite = geminiLadder('gemini-3.5-flash-lite');
    const ids = lite.map((s) => s.id);
    expect(ids).toEqual(['1-minimo', '2-store', '3-sistema', '4-ferramenta', '5-tool-choice', '6a-estrutura', '6b-enum', '6c-maxitems', '6d-additional', '7-sem-aninhado', '8-esquema-completo', '10-saida', '11-pedido-real']);
    // O 3.8 Flash recebe thinking_level: tem um degrau próprio.
    expect(geminiLadder('gemini-3.8-flash').map((s) => s.id)).toContain('9-thinking');
    const at = (id: string) => lite.find((s) => s.id === id);
    const keys = lite.map((s) => Object.keys(s.body).sort().join(','));
    expect(keys[0]).toBe('generation_config,input,model');
    expect(keys[1]).toBe('generation_config,input,model,store');
    expect(keys[2]).toBe('generation_config,input,model,store,system_instruction');
    expect(keys[3]).toBe('generation_config,input,model,store,system_instruction,tools');
    expect(at('4-ferramenta')?.body.generation_config).toEqual({ max_output_tokens: 64 });
    expect(at('5-tool-choice')?.body.generation_config).toEqual({ max_output_tokens: 64, tool_choice: 'any' });
    const params = (id: string) => {
      const tools = at(id)?.body.tools;
      const first: unknown = Array.isArray(tools) ? tools[0] : undefined;
      return JSON.stringify(first && typeof first === 'object' ? Reflect.get(first, 'parameters') : undefined);
    };
    // Sondagens: cada uma acrescenta UMA palavra ao esquema real com uma operação.
    expect(params('6a-estrutura')).not.toMatch(/"enum"|"maxItems"|"minItems"|"additionalProperties"/);
    expect(params('6b-enum')).toContain('"enum"');
    expect(params('6b-enum')).not.toMatch(/"maxItems"|"additionalProperties"/);
    expect(params('6c-maxitems')).toContain('"maxItems"');
    expect(params('6c-maxitems')).not.toContain('"additionalProperties"');
    expect(params('6d-additional')).toContain('"additionalProperties":false');
    expect(at('6d-additional')?.probe).toEqual(['additionalProperties']);
    expect(params('6d-additional')).not.toContain('"anyOf"');
    expect(params('7-sem-aninhado')).toContain('"anyOf"');
    expect(params('8-esquema-completo')).toBe(JSON.stringify(geminiToolSchema()));
    expect(at('10-saida')?.body.generation_config).toEqual({ max_output_tokens: 1500, tool_choice: 'any' });
    // Último degrau = googleRequestBody; face ao anterior só o input muda.
    const real = at('11-pedido-real')?.body;
    const ref = googleRequestBody('gemini-3.5-flash-lite', SYSTEM_PROMPT, String(real?.input), 1500);
    expect(real).toEqual(ref);
    expect({ ...at('10-saida')?.body, input: real?.input }).toEqual(real);
    expect(String(real?.input)).toContain('<pedido>Pode fazer uma mudança no website e colocar fotos relacionadas com o assunto?</pedido>');
  });

  it('sondagem recusada (caso de 08/10): identifica a palavra, retira-a dos degraus seguintes e valida o pedido real sem ela', async () => {
    const sent: string[] = [];
    const reject = { status: 400, body: { error: { message: 'Request contains an invalid argument.', code: 'invalid_request' } } };
    const ok = { status: 200, body: { status: 'requires_action', steps: [{ type: 'function_call' }], usage: { total_input_tokens: 5, total_output_tokens: 1 } } };
    // Simula a regra: o fornecedor recusa qualquer corpo com additionalProperties.
    const fetch = async (_url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => {
      const body = init.body ?? '';
      sent.push(body);
      const r = body.includes('"additionalProperties"') ? reject : ok;
      return { ok: r.status === 200, status: r.status, json: async () => r.body };
    };
    const r = await runGeminiLadder({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetch, prices: FLASH_LITE });
    expect(r.firstRejected).toBe('6d-additional');
    expect(r.culprit).toBe('additionalProperties');
    expect(r.fixValidated).toBe(true);
    expect(r.steps.at(-1)?.id).toBe('11-pedido-real');
    expect(r.steps.at(-1)?.label).toContain('[sem additionalProperties]');
    // Depois da sondagem, nenhum degrau voltou a enviar a palavra recusada.
    const after = sent.slice(sent.findIndex((b) => b.includes('"additionalProperties"')) + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((b) => !b.includes('"additionalProperties"'))).toBe(true);
    // Nomes de propriedades nunca são retirados (só palavras do esquema).
    expect(stripKeywords({ type: 'object', properties: { enum: { type: 'string', enum: ['a'] } } }, ['enum'])).toEqual({ type: 'object', properties: { enum: { type: 'string' } } });
  });

  it('falha temporária (503) repete até 2 vezes e continua; se persistir, fica «Interrompido», não «recusado»', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const busy = { status: 503, body: { error: { message: 'high demand', code: 'service_unavailable' } } };
    const ok = { status: 200, body: { status: 'completed', steps: [], usage: { total_input_tokens: 5, total_output_tokens: 1 } } };
    const once = fake([ok, busy, ok, { status: 400, body: { error: { message: 'Request contains an invalid argument.', code: 'invalid_request' } } }]);
    const r1 = await runGeminiLadder({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetch: once.fetch, prices: FLASH_LITE, sleep });
    expect(r1.steps.map((s) => [s.id, s.http, s.accepted])).toEqual([
      ['1-minimo', 200, true],
      ['2-store', 200, true],
      ['3-sistema', 400, false],
    ]);
    expect(r1.steps[1]?.detail).toContain('após 1 repetição');
    expect(r1.firstRejected).toBe('3-sistema');
    expect(waits).toEqual([2000]);
    const always = fake([ok, busy, busy, busy]);
    const r2 = await runGeminiLadder({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetch: always.fetch, prices: FLASH_LITE, sleep });
    expect(r2.firstRejected).toBeNull();
    expect(r2.steps[1]?.accepted).toBe(false);
    expect(r2.steps[1]?.detail).toMatch(/^Interrompido: falha temporária do fornecedor \(após 2 repetição/);
  });

  it('teto: o pior caso de todos os degraus cabe no teto (0,02 USD) com os preços do Flash-Lite', () => {
    const total = geminiLadder('gemini-3.5-flash-lite').reduce((sum, s) => sum + worstCaseUsd(s.body, FLASH_LITE), 0);
    expect(total).toBeLessThan(DIAG_MAX_USD);
  });

  it('pára no primeiro degrau recusado e guarda a resposta completa, sem a chave', async () => {
    const { fetch, sent } = fake([
      { status: 200, body: { status: 'completed', steps: [{ type: 'model_output' }], usage: { total_input_tokens: 8, total_output_tokens: 2 } } },
      { status: 200, body: { status: 'completed', steps: [], usage: { total_input_tokens: 9, total_output_tokens: 2 } } },
      { status: 400, body: { error: { message: 'Request contains an invalid argument.', code: 'invalid_request' } } },
    ]);
    const r = await runGeminiLadder({ apiKey: 'AIzaSyD-chave-de-teste-nao-real-0123456789', model: 'gemini-3.5-flash-lite', fetch, prices: FLASH_LITE });
    expect(sent).toHaveLength(3);
    expect(sent[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(r.firstRejected).toBe('3-sistema');
    expect(r.steps.map((s) => [s.id, s.http, s.accepted])).toEqual([
      ['1-minimo', 200, true],
      ['2-store', 200, true],
      ['3-sistema', 400, false],
    ]);
    expect(r.steps[2]?.detail).toBe('{"error":{"message":"Request contains an invalid argument.","code":"invalid_request"}}');
    expect(JSON.stringify(r)).not.toContain('AIzaSy');
    expect(r.costUsd).toBeCloseTo((17 * 0.3 + 4 * 2.5) / 1e6, 6);
  });

  it('teto respeitado: com um teto baixo, nenhum degrau é enviado', async () => {
    const { fetch, sent } = fake([]);
    const r = await runGeminiLadder({ apiKey: 'k', model: 'm', fetch, prices: FLASH_LITE, maxUsd: 0.000001 });
    expect(sent).toHaveLength(0);
    expect(r.stoppedForBudget).toBe(true);
  });
});
