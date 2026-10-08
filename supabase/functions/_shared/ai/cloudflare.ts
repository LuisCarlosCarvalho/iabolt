import type { GeneratedImage, ImageGenerator, ImageRequest } from './images.ts';
import { ProviderError, providerErrorDiagnostic, type FetchLike, type KeyCheck } from './provider.ts';

/**
 * Adaptador Cloudflare Workers AI (só imagens), confirmado na documentação oficial a 08/10/2026:
 *  - `POST /client/v4/accounts/{account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell`, com
 *    `Authorization: Bearer {token}`;
 *  - entrada `{prompt (1..2048), steps (≤ 8, por omissão 4)}`, com `additionalProperties: false`
 *    (sem largura/altura: a imagem sai quadrada);
 *  - saída `{result: {image: base64 JPEG}, success, errors, messages}`.
 * Plano gratuito: 10 000 «neurons» por dia (cerca de 170 imagens de 1024 px). Acima disso, o plano
 * gratuito recusa o pedido em vez de cobrar.
 *
 * A credencial guardada é «ACCOUNT_ID:TOKEN» (o painel junta os dois campos): o Account ID não é
 * secreto, mas faz parte do endereço; o token é o segredo.
 */
const BASE = 'https://api.cloudflare.com/client/v4';
const STEPS = 4;

/** Separa «ACCOUNT_ID:TOKEN». O Account ID da Cloudflare tem 32 caracteres hexadecimais. */
export function splitCloudflareKey(key: string): { accountId: string; token: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const accountId = key.slice(0, i).trim();
  const token = key.slice(i + 1).trim();
  return /^[0-9a-f]{32}$/i.test(accountId) && token.length >= 20 && !/\s/.test(token) ? { accountId, token } : null;
}

/** Corpo do pedido de imagem (exatamente o esquema publicado: só prompt e steps). */
export function cloudflareImageBody(prompt: string): { prompt: string; steps: number } {
  return { prompt: prompt.slice(0, 2048), steps: STEPS };
}

const obj = (v: unknown): object | null => (v && typeof v === 'object' ? v : null);

/** Primeiro erro da resposta da Cloudflare: «código: mensagem» (sem chaves). */
export function cloudflareErrorDetail(body: unknown): string {
  const errors = obj(body) ? Reflect.get(obj(body) ?? {}, 'errors') : null;
  const first = Array.isArray(errors) ? obj(errors[0]) : null;
  if (!first) return '';
  const code = Reflect.get(first, 'code');
  const message = Reflect.get(first, 'message');
  return providerErrorDiagnostic(`${typeof code === 'number' ? `${code}: ` : ''}${typeof message === 'string' ? message : ''}`, 240);
}

const BAD_KEY = 'credencial inválida: confirme o Account ID e o token (com permissão «Workers AI»).';

export function cloudflareImageGenerator(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string }): ImageGenerator {
  return {
    model: opts.model,
    async generate(req: ImageRequest, timeoutMs: number): Promise<GeneratedImage> {
      const cred = splitCloudflareKey(opts.apiKey);
      if (!cred) throw new ProviderError(`O fornecedor recusou o pedido de imagem (${BAD_KEY})`, false, 'none');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await opts.fetch(`${opts.baseUrl ?? BASE}/accounts/${cred.accountId}/ai/run/${opts.model}`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cred.token}` },
          body: JSON.stringify(cloudflareImageBody(req.prompt)),
        });
      } catch (e) {
        const why = ctrl.signal.aborted ? 'O fornecedor não respondeu a tempo.' : `Falha de rede: ${e instanceof Error ? e.message : String(e)}`;
        throw new ProviderError(why, false, 'unknown');
      } finally {
        clearTimeout(timer);
      }
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = cloudflareErrorDetail(json);
        // 429: a quota gratuita do dia acabou (renova às 00:00 UTC) ou limite de ritmo.
        const quota = res.status === 429 ? ' A quota gratuita diária da Cloudflare pode ter acabado; renova às 00:00 UTC.' : '';
        throw new ProviderError(
          `O fornecedor recusou o pedido de imagem (HTTP ${res.status}${detail ? ` · ${detail}` : ''}).${quota}`,
          false,
          res.status >= 500 ? 'unknown' : 'none',
          json === null ? '(resposta sem JSON)' : providerErrorDiagnostic(JSON.stringify(json)),
        );
      }
      const result = obj(json) ? obj(Reflect.get(obj(json) ?? {}, 'result')) : null;
      const image = result ? Reflect.get(result, 'image') : null;
      if (typeof image !== 'string' || image.length < 16) throw new ProviderError('O fornecedor não devolveu a imagem.', false, 'unknown');
      // O FLUX.1 schnell devolve JPEG; o preço é por imagem (sem tokens).
      return { mime: image.startsWith('iVBOR') ? 'image/png' : 'image/jpeg', base64: image, tokens: null };
    },
  };
}

/**
 * Teste sem custo: lista um modelo da conta (`GET /accounts/{id}/ai/models/search?per_page=1`).
 * Confirma o token, a permissão «Workers AI» e o Account ID de uma vez, sem gerar nada.
 */
export async function cloudflareCheck(opts: { apiKey: string; model: string; fetch: FetchLike; baseUrl?: string; timeoutMs?: number }): Promise<KeyCheck> {
  const cred = splitCloudflareKey(opts.apiKey);
  if (!cred) return { ok: false, definitive: true, reason: 'Formato inválido: indique o Account ID (32 caracteres) e o token.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await opts.fetch(`${opts.baseUrl ?? BASE}/accounts/${cred.accountId}/ai/models/search?per_page=1`, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${cred.token}` },
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok && obj(json) && Reflect.get(obj(json) ?? {}, 'success') === true) return { ok: true, formatChecked: false };
    const detail = cloudflareErrorDetail(json);
    // 9106 / 10000 / 401 / 403: token recusado ou sem permissão; 7003 / 404: Account ID errado.
    if (/^(7003|7000)\b/.test(detail) || res.status === 404) return { ok: false, definitive: true, reason: 'O Account ID não foi encontrado para este token.' };
    if (/^(9106|9109|10000|10001)\b/.test(detail) || res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, definitive: true, reason: `O fornecedor recusou o token${detail ? ` (${detail})` : ''}. Confirme que tem a permissão «Workers AI».` };
    }
    return { ok: false, definitive: false, reason: `O fornecedor não confirmou a credencial (HTTP ${res.status}). Tente de novo.` };
  } catch {
    return { ok: false, definitive: false, reason: 'Sem resposta do fornecedor. Tente de novo.' };
  } finally {
    clearTimeout(timer);
  }
}
