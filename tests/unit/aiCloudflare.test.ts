import { describe, expect, it } from 'vitest';
import { cloudflareCheck, cloudflareImageBody, cloudflareImageGenerator, splitCloudflareKey } from '../../supabase/functions/_shared/ai/cloudflare.ts';
import { ProviderError } from '../../supabase/functions/_shared/ai/provider.ts';
import { checkProviderKey, makeEditProvider, makeImageGenerator } from '../../supabase/functions/_shared/ai/registry.ts';

/**
 * [simulado] Adaptador Cloudflare Workers AI (imagens FLUX.1 schnell). Respostas SIMULADAS no
 * formato da documentação oficial (08/10/2026): provam o pedido enviado e a leitura das respostas,
 * não que a Cloudflare aceita uma credencial real.
 */
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'token-de-teste-cloudflare-0000000000CFTK';
const KEY = `${ACCOUNT}:${TOKEN}`;
const FLUX = '@cf/black-forest-labs/flux-1-schnell';
const IMAGE = '/9j/4AAQSkZJRgABAQAAAQABAAD'.padEnd(64, 'A');

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
function fake(replies: Array<{ status: number; body: unknown }>) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => {
    sent.push({ url, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) });
    const r = replies.shift() ?? { status: 500, body: null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, sent };
}

describe('[simulado] Cloudflare Workers AI', () => {
  it('credencial «ACCOUNT_ID:TOKEN»: Account ID com 32 hexadecimais e token sem espaços', () => {
    expect(splitCloudflareKey(KEY)).toEqual({ accountId: ACCOUNT, token: TOKEN });
    expect(splitCloudflareKey(TOKEN)).toBeNull();
    expect(splitCloudflareKey(`conta-errada:${TOKEN}`)).toBeNull();
    expect(splitCloudflareKey(`${ACCOUNT}:curto`)).toBeNull();
  });

  it('gerar: endereço da conta e do modelo, Bearer token, corpo exatamente {prompt, steps}; devolve o JPEG em base64', async () => {
    const { fetch, sent } = fake([{ status: 200, body: { result: { image: IMAGE }, success: true, errors: [], messages: [] } }]);
    const img = await cloudflareImageGenerator({ apiKey: KEY, model: FLUX, fetch }).generate({ prompt: 'Retrato de estúdio, luz suave', aspect: '16:9' }, 5000);
    expect(sent[0]?.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${FLUX}`);
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // O esquema publicado tem additionalProperties: false: só prompt e steps.
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({ prompt: 'Retrato de estúdio, luz suave', steps: 4 });
    expect(img).toEqual({ mime: 'image/jpeg', base64: IMAGE, tokens: null });
    expect(cloudflareImageBody('x'.repeat(3000)).prompt).toHaveLength(2048);
  });

  it('erros: quota diária (429) explicada, sem resposta de imagem, credencial mal formada; nada com o token', async () => {
    const quota = fake([{ status: 429, body: { success: false, errors: [{ code: 3036, message: 'Account limited: daily free allocation exceeded' }], result: null } }]);
    const e1 = await cloudflareImageGenerator({ apiKey: KEY, model: FLUX, fetch: quota.fetch }).generate({ prompt: 'abc', aspect: '1:1' }, 5000).catch((e: unknown) => e);
    expect(e1 instanceof ProviderError && e1.message).toBe(
      'O fornecedor recusou o pedido de imagem (HTTP 429 · 3036: Account limited: daily free allocation exceeded). A quota gratuita diária da Cloudflare pode ter acabado; renova às 00:00 UTC.',
    );
    expect(e1 instanceof ProviderError && [e1.retriable, e1.charged]).toEqual([false, 'none']);
    const empty = fake([{ status: 200, body: { result: {}, success: true } }]);
    await expect(cloudflareImageGenerator({ apiKey: KEY, model: FLUX, fetch: empty.fetch }).generate({ prompt: 'abc', aspect: '1:1' }, 5000)).rejects.toThrow('não devolveu a imagem');
    const bad = fake([]);
    await expect(cloudflareImageGenerator({ apiKey: TOKEN, model: FLUX, fetch: bad.fetch }).generate({ prompt: 'abc', aspect: '1:1' }, 5000)).rejects.toThrow('credencial inválida');
    expect(bad.sent).toHaveLength(0);
    expect(JSON.stringify(e1)).not.toContain(TOKEN);
  });

  it('teste sem custo: GET à lista de modelos da conta; token recusado e Account ID errado são definitivos', async () => {
    const ok = fake([{ status: 200, body: { success: true, result: [{ name: FLUX }] } }]);
    expect(await cloudflareCheck({ apiKey: KEY, model: FLUX, fetch: ok.fetch })).toEqual({ ok: true, formatChecked: false });
    expect(ok.sent[0]).toMatchObject({ method: 'GET', url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/models/search?per_page=1` });
    expect(ok.sent[0]?.body).toBeUndefined();
    // Resposta real observada sem credencial válida (08/10): HTTP 400, código 9106.
    const token = fake([{ status: 400, body: { success: false, errors: [{ code: 9106, message: 'Authentication failed (status: 400)' }], result: null } }]);
    expect(await cloudflareCheck({ apiKey: KEY, model: FLUX, fetch: token.fetch })).toMatchObject({ ok: false, definitive: true, reason: expect.stringContaining('recusou o token') });
    const account = fake([{ status: 404, body: { success: false, errors: [{ code: 7003, message: 'Could not route to /accounts/x' }] } }]);
    expect(await cloudflareCheck({ apiKey: KEY, model: FLUX, fetch: account.fetch })).toMatchObject({ ok: false, definitive: true, reason: 'O Account ID não foi encontrado para este token.' });
    const busy = fake([{ status: 503, body: null }]);
    expect(await cloudflareCheck({ apiKey: KEY, model: FLUX, fetch: busy.fetch })).toMatchObject({ ok: false, definitive: false });
    expect(await cloudflareCheck({ apiKey: TOKEN, model: FLUX, fetch: busy.fetch })).toMatchObject({ ok: false, definitive: true, reason: expect.stringContaining('Account ID') });
  });

  it('registo: a Cloudflare gera imagens e testa a chave; nunca faz edição', async () => {
    const { fetch } = fake([{ status: 200, body: { success: true, result: [] } }]);
    expect(makeImageGenerator('cloudflare', { apiKey: KEY, model: FLUX, fetch })?.model).toBe(FLUX);
    expect(await checkProviderKey('cloudflare', { apiKey: KEY, model: FLUX, fetch, kind: 'image' })).toEqual({ ok: true, formatChecked: false });
    await expect(makeEditProvider('cloudflare', { apiKey: KEY, model: FLUX, fetch }).propose({ system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 10 })).rejects.toThrow('só gera imagens');
  });
});
