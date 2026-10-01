import type { LimitReason, Reservation, Settlement } from './handler.ts';
import { AiImageRequest, MAX_IMAGE_BASE64, OUTDATED_CLIENT_MESSAGE, type AiImageResponse, type ImageGenerator } from './images.ts';
import type { RuntimeSettings } from './limits.ts';
import { ProviderError } from './provider.ts';
import type { ProviderId } from './ids.ts';

/**
 * Lógica da função `ai-image` (gerar UMA imagem), independente do Deno.
 * Ordem: emergência → forma → sessão → acesso ao projeto → configuração (imagens ativas, chave do
 * fornecedor de imagens) → RESERVA do teto por imagem → fornecedor (sem repetições automáticas) →
 * acerto. O custo fica registado mesmo que o utilizador descarte a imagem depois.
 * A imagem volta em base64; nunca se devolve nem guarda um endereço do fornecedor.
 */
export interface ImageDeps {
  forceDisabled: boolean;
  getUser(authHeader: string | null): Promise<{ id: string } | null>;
  projectWorkspace(authHeader: string, projectId: string): Promise<string | null>;
  loadRuntime(): Promise<RuntimeSettings | null>;
  providerKey(provider: ProviderId): Promise<string | null>;
  makeGenerator(provider: ProviderId, model: string, key: string): ImageGenerator | null;
  reserve(r: Reservation): Promise<{ ok: true; id: string } | { ok: false; reason: LimitReason }>;
  settle(id: string, s: Settlement): Promise<void>;
  release(id: string): Promise<void>;
  now(): number;
  /**
   * Administrador da plataforma (`platform_admins`)? Só estes recebem valores financeiros. Sem esta
   * dependência, ninguém os recebe. A contabilização e os limites são iguais para todos.
   */
  isAdmin?(userId: string): Promise<boolean>;
}

export interface ImageResult {
  status: number;
  body: AiImageResponse | { error: string; code: string };
}

const fail = (status: number, code: string, error: string): ImageResult => ({ status, body: { error, code } });
const DISABLED = () => fail(503, 'disabled', 'A geração de imagens está desativada. Nada foi gerado.');
const LIMITS: Partial<Record<LimitReason, [number, string]>> = {
  config_changed: [409, 'A configuração de imagens mudou. Tente de novo.'],
  forbidden: [403, 'Só quem pode editar o projeto gera imagens.'],
  duplicate: [409, 'Este pedido já foi enviado.'],
  user_day: [429, 'Atingiu o limite diário de pedidos (ou de imagens).'],
  workspace_day: [429, 'O workspace atingiu o limite diário de pedidos.'],
  user_concurrency: [429, 'Já tem um pedido em curso. Aguarde que termine.'],
  workspace_concurrency: [429, 'Há demasiados pedidos em curso neste workspace.'],
  budget: [429, 'O orçamento mensal foi atingido.'],
};
/** Utilizadores comuns: mensagem funcional, sem conceitos nem valores financeiros. */
const USER_LIMIT = 'Limite de utilização atingido.';

/** Tempo máximo de uma geração (uma única tentativa). */
export const IMAGE_TIMEOUT_MS = 90_000;

export async function handleImage(authHeader: string | null, rawBody: string, deps: ImageDeps): Promise<ImageResult> {
  if (deps.forceDisabled) return DISABLED();
  if (rawBody.length > 4000) return fail(413, 'too_large', 'O pedido é demasiado grande.');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail(400, 'bad_json', 'Pedido inválido.');
  }
  const parsed = AiImageRequest.safeParse(json);
  if (!parsed.success) return fail(400, 'bad_request', 'Pedido fora do contrato.');
  const req = parsed.data;

  const who = await deps.getUser(authHeader);
  if (!who || !authHeader) return fail(401, 'no_session', 'Sessão inválida. Entre novamente.');
  const workspaceId = await deps.projectWorkspace(authHeader, req.projectId);
  if (!workspaceId) return fail(403, 'no_access', 'Sem acesso a este projeto.');

  const admin = (await deps.isAdmin?.(who.id).catch(() => false)) === true;
  // Separador aberto com o frontend anterior: exige o custo na resposta, que um utilizador comum já
  // não recebe. Recusa-se ANTES da reserva (nada gerado nem cobrado), com instrução clara.
  if (req.client !== 2 && !admin) return fail(409, 'client_outdated', OUTDATED_CLIENT_MESSAGE);

  const rt = await deps.loadRuntime();
  if (!rt || !rt.image_enabled || rt.image_key_status !== 'valid' || !rt.image_provider || !rt.image_model || !rt.image_prices || rt.image_prices.image === null) return DISABLED();
  const key = await deps.providerKey(rt.image_provider);
  if (!key) return DISABLED();
  const generator = deps.makeGenerator(rt.image_provider, rt.image_model, key);
  if (!generator) return DISABLED();

  // Teto: o preço por imagem publicado (uma tentativa; sem repetições automáticas).
  const ceiling = rt.image_prices.image;
  const reservation = await deps.reserve({
    requestId: req.requestId,
    userId: who.id,
    workspaceId,
    projectId: req.projectId,
    reserveUsd: ceiling,
    provider: rt.image_provider,
    model: rt.image_model,
    prices: { input: rt.image_prices.input, output: rt.image_prices.output, image: ceiling },
    kind: 'image',
  });
  if (!reservation.ok) {
    if (reservation.reason === 'disabled') return DISABLED();
    const [status, message] = LIMITS[reservation.reason] ?? [429, 'Limite atingido.'];
    return fail(status, `limit_${reservation.reason}`, reservation.reason === 'budget' && !admin ? USER_LIMIT : message);
  }

  const started = deps.now();
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  try {
    const img = await generator.generate({ prompt: req.prompt, aspect: req.aspect }, IMAGE_TIMEOUT_MS);
    if (img.base64.length > MAX_IMAGE_BASE64) throw new ProviderError('A imagem gerada excede o tamanho aceite.', false, 'unknown');
    // Com tokens indicados: preço por token (se passar o teto, conta o valor real e fica
    // registado como tal). Sem tokens: a tarifa publicada por imagem (o teto) é o custo.
    const byTokens = img.tokens ? (img.tokens.input * rt.image_prices.input + img.tokens.output * rt.image_prices.output) / 1_000_000 : null;
    const cost = Math.round((byTokens ?? ceiling) * 1e6) / 1e6;
    await deps.settle(reservation.id, {
      status: 'done',
      usage: img.tokens ? { ...zero, inputTokens: img.tokens.input, outputTokens: img.tokens.output } : zero,
      confirmedCostUsd: cost,
      unknownCostUsd: 0,
      attempts: 1,
      unknownAttempts: 0,
      latencyMs: deps.now() - started,
    });
    return {
      status: 200,
      body: { mime: img.mime, base64: img.base64, model: rt.image_model, provider: rt.image_provider, ...(admin ? { costUsd: cost, estimated: false } : {}), simulated: false },
    };
  } catch (e) {
    const charged = e instanceof ProviderError ? e.charged : 'unknown';
    await deps.settle(reservation.id, {
      status: 'failed',
      usage: zero,
      confirmedCostUsd: 0,
      unknownCostUsd: charged === 'unknown' ? ceiling : 0,
      attempts: 1,
      unknownAttempts: charged === 'unknown' ? 1 : 0,
      latencyMs: deps.now() - started,
      error: e instanceof Error ? e.message.slice(0, 300) : 'erro',
    });
    return fail(502, 'provider_error', `${e instanceof Error ? e.message : 'O fornecedor não gerou a imagem.'} Nada foi alterado.`);
  }
}
