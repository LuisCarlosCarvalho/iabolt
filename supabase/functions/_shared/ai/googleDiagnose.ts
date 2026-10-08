import { DIAG_MAX_USD, type AdminDiagnosis } from './admin.ts';
import { AI_CONTRACT_VERSION, AiProposeRequest } from './contract.ts';
import { geminiThinkingLevel, geminiToolSchema, geminiUsage, googleRequestBody } from './google.ts';
import { SYSTEM_PROMPT, TOOL_NAME, userMessage } from './prompt.ts';
import { providerErrorDiagnostic, TOOL_DESCRIPTION, type FetchLike } from './provider.ts';

/**
 * Diagnóstico progressivo do HTTP 400 do Gemini (Interactions API), só para administradores e só
 * quando pedido explicitamente: parte do menor pedido válido e acrescenta UM elemento por degrau
 * até ao pedido real do assistente. Pára no primeiro degrau recusado: a diferença para o degrau
 * anterior é a causa. Pedidos aceites têm custo (o teto é verificado ANTES de cada degrau, pelo
 * pior caso). A chave fica no servidor; nada do projeto real é enviado (o último degrau usa um
 * pedido anonimizado com o formato real).
 */

export { DIAG_MAX_USD };
/** Saída máxima nos degraus intermédios (o último usa a do pedido real). */
const SMALL_OUTPUT = 64;
const REAL_OUTPUT = 1500;

export interface DiagStep {
  id: string;
  label: string;
  body: Record<string, unknown>;
}

export interface DiagStepResult {
  id: string;
  label: string;
  /** null = não enviado (teto) ou falha de rede. */
  http: number | null;
  accepted: boolean;
  /** Resposta de erro completa (sem chaves), ou estado da interação aceite. */
  detail: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** `firstRejected`: primeiro degrau recusado (a causa está no que esse degrau acrescenta). */
export type DiagReport = AdminDiagnosis & { steps: DiagStepResult[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Esquema real com `operations.items` substituído (degraus intermédios). */
function schemaWithItems(pick: (branches: unknown[]) => unknown[]): Record<string, unknown> {
  const s = clone(geminiToolSchema());
  const items = rec(rec(rec(s.properties).operations).items);
  const branches = Array.isArray(items.anyOf) ? items.anyOf : [];
  const chosen = pick(branches);
  if (chosen.length === 1) rec(rec(s.properties).operations).items = chosen[0];
  else items.anyOf = chosen;
  return s;
}

const hasNestedAnyOf = (v: unknown): boolean => JSON.stringify(v).includes('"anyOf"');

/** Pedido anonimizado com o formato real (âmbito «página», pedido do print, contexto pequeno). */
export function anonymizedUserMessage(): string {
  const caps = (o: Partial<Record<'text' | 'link' | 'tag' | 'image' | 'container', boolean>>) => ({ text: false, link: false, tag: false, image: false, container: false, ...o });
  const req = AiProposeRequest.parse({
    contract: AI_CONTRACT_VERSION,
    projectId: 'projeto-anonimo',
    documentVersion: 'v1',
    requestId: '00000000-0000-4000-8000-000000000001',
    scope: { kind: 'page', pageId: 'pagina-1' },
    device: 'desktop',
    instruction: 'Pode fazer uma mudança no website e colocar fotos relacionadas com o assunto?',
    imageGeneration: true,
    context: {
      pages: [
        {
          id: 'pagina-1',
          name: 'Página inicial',
          slug: 'index',
          current: true,
          nodes: [
            { id: 'sec-1', parent: null, kind: 'Secção', tag: 'section', inScope: true, caps: caps({ container: true }) },
            { id: 'tit-1', parent: 'sec-1', kind: 'Título', tag: 'h1', inScope: true, caps: caps({ text: true, tag: true }), text: 'Retratos profissionais com qualidade de estúdio' },
            { id: 'txt-1', parent: 'sec-1', kind: 'Texto', tag: 'p', inScope: true, caps: caps({ text: true, tag: true }), text: 'Sem maquilhagem, sem produção.' },
            { id: 'img-1', parent: 'sec-1', kind: 'Imagem', tag: 'img', inScope: true, caps: caps({ image: true }), imageAlt: 'Retrato' },
            { id: 'btn-1', parent: 'sec-1', kind: 'Botão', tag: 'a', inScope: true, caps: caps({ text: true, link: true }), text: 'Quero os meus retratos', href: '#contacto' },
          ],
        },
      ],
      variables: [{ name: '--cor-principal', label: 'Cor principal', value: '#c08080', kind: 'color' }],
    },
  });
  return userMessage(req);
}

/** Degraus, do menor pedido ao pedido real; cada um acrescenta um elemento ao anterior. */
export function geminiLadder(model: string): DiagStep[] {
  const steps: DiagStep[] = [];
  let body: Record<string, unknown> = { model, input: 'Responde apenas: ok', generation_config: { max_output_tokens: SMALL_OUTPUT } };
  const add = (id: string, label: string, change: (b: Record<string, unknown>) => Record<string, unknown>) => {
    body = change(clone(body));
    steps.push({ id, label, body: clone(body) });
  };
  add('1-minimo', 'Geração mínima (model, input, max_output_tokens)', (b) => b);
  add('2-store', '+ store: false', (b) => ({ ...b, store: false }));
  add('3-sistema', '+ system_instruction (instruções reais do assistente)', (b) => ({ ...b, system_instruction: SYSTEM_PROMPT }));
  const minimalTool = { type: 'function', name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } };
  add('4-ferramenta', '+ ferramenta mínima (um campo de texto), sem tool_choice', (b) => ({ ...b, tools: [minimalTool] }));
  add('5-tool-choice', '+ generation_config.tool_choice: "any"', (b) => ({ ...b, generation_config: { ...rec(b.generation_config), tool_choice: 'any' } }));
  const withParams = (parameters: Record<string, unknown>) => (b: Record<string, unknown>) => ({ ...b, tools: [{ ...minimalTool, parameters }] });
  add('6-uma-operacao', 'Esquema real com uma só operação (setText, sem anyOf)', withParams(schemaWithItems((br) => br.slice(0, 1))));
  add('7-sem-aninhado', 'Esquema real: operações sem anyOf aninhado (anyOf de topo)', withParams(schemaWithItems((br) => br.filter((x) => !hasNestedAnyOf(x)))));
  add('8-esquema-completo', 'Esquema real completo (com anyOf aninhado em «image»)', withParams(geminiToolSchema()));
  const thinking = geminiThinkingLevel(model);
  if (thinking) add('9-thinking', `+ generation_config.thinking_level: "${thinking}" (só neste modelo)`, (b) => ({ ...b, generation_config: { ...rec(b.generation_config), thinking_level: thinking } }));
  add('10-saida', '+ max_output_tokens 1500 (como no pedido real)', (b) => ({ ...b, generation_config: { ...rec(b.generation_config), max_output_tokens: REAL_OUTPUT } }));
  // Último degrau: exatamente o corpo do assistente (googleRequestBody); só o input muda face ao anterior.
  body = googleRequestBody(model, SYSTEM_PROMPT, anonymizedUserMessage(), REAL_OUTPUT);
  steps.push({ id: '11-pedido-real', label: 'Input no formato real do assistente (pedido anonimizado)', body: clone(body) });
  return steps;
}

/** Pior caso de um degrau: entrada estimada por cima (2,5 caracteres por token) + saída máxima. */
export function worstCaseUsd(body: Record<string, unknown>, prices: { input: number; output: number }): number {
  const inputTokens = Math.ceil(JSON.stringify(body).length / 2.5);
  const out = Number(rec(body.generation_config).max_output_tokens ?? REAL_OUTPUT);
  return (inputTokens * prices.input + out * prices.output) / 1_000_000;
}

/** Respostas temporárias do fornecedor (sobrecarga, limite de ritmo): repetem-se em vez de parar. */
const TEMPORARY = new Set([429, 500, 503]);
const RETRIES = 2;

export async function runGeminiLadder(opts: {
  apiKey: string;
  model: string;
  fetch: FetchLike;
  prices: { input: number; output: number };
  maxUsd?: number;
  baseUrl?: string;
  timeoutMs?: number;
  /** Espera entre repetições (injetável nos testes). */
  sleep?: (ms: number) => Promise<void>;
}): Promise<DiagReport> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxUsd = Math.min(opts.maxUsd ?? DIAG_MAX_USD, DIAG_MAX_USD);
  const endpoint = `${opts.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/interactions`;
  const report: DiagReport = { model: opts.model, endpoint: '/v1beta/interactions', steps: [], firstRejected: null, stoppedForBudget: false, costUsd: 0, maxUsd };
  for (const step of geminiLadder(opts.model)) {
    const base = { id: step.id, label: step.label, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const worst = worstCaseUsd(step.body, opts.prices);
    if (report.costUsd + worst > maxUsd) {
      report.steps.push({ ...base, http: null, accepted: false, detail: `Não enviado: o pior caso (${worst.toFixed(4)} USD) ultrapassaria o teto de ${maxUsd} USD.` });
      report.stoppedForBudget = true;
      break;
    }
    let res: Awaited<ReturnType<FetchLike>> | null = null;
    let json: unknown = null;
    let retries = 0;
    let networkProblem = '';
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
      try {
        res = await opts.fetch(endpoint, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(step.body),
        });
      } catch (e) {
        networkProblem = ctrl.signal.aborted ? 'Sem resposta a tempo.' : `Falha de rede: ${e instanceof Error ? e.message : String(e)}`;
        res = null;
      } finally {
        clearTimeout(timer);
      }
      if (!res) break;
      json = await res.json().catch(() => null);
      if (!TEMPORARY.has(res.status) || attempt === RETRIES) break;
      retries += 1;
      await sleep(2000 * (attempt + 1));
    }
    if (!res) {
      // Sem resposta: o consumo é desconhecido; conta-se o pior caso e pára.
      report.costUsd += worst;
      report.steps.push({ ...base, http: null, accepted: false, costUsd: worst, detail: networkProblem });
      break;
    }
    const again = retries ? ` (após ${retries} repetição(ões) por falha temporária)` : '';
    if (!res.ok) {
      const detail = json === null ? '(resposta sem JSON)' : providerErrorDiagnostic(JSON.stringify(json), 1500);
      report.steps.push({ ...base, http: res.status, accepted: false, detail: TEMPORARY.has(res.status) ? `Interrompido: falha temporária do fornecedor${again}. ${detail}` : detail });
      if (res.status === 400) report.firstRejected = step.id;
      break;
    }
    const it = rec(rec(json).interaction ?? json);
    const { usage, known } = geminiUsage(it);
    const cost = known ? (usage.inputTokens * opts.prices.input + usage.outputTokens * opts.prices.output) / 1_000_000 : worst;
    report.costUsd += cost;
    const steps = Array.isArray(it.steps) ? it.steps : [];
    const kinds = steps.map((s) => String(rec(s).type ?? '?')).join(', ');
    report.steps.push({ ...base, http: res.status, accepted: true, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: cost, detail: `aceite${again} · estado ${String(it.status ?? '?')} · passos: ${kinds || 'nenhum'}${known ? '' : ' · consumo desconhecido (contado o pior caso)'}` });
  }
  report.costUsd = Math.round(report.costUsd * 1e6) / 1e6;
  return report;
}
