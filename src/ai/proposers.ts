import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AI_CONTRACT_VERSION,
  AI_TEXT_TAGS,
  AiProposeResponse,
  scopeRoot,
  type AiImageSource,
  type AiNode,
  type AiOperation,
  type AiProposal,
  type AiProposeRequest,
  type AiSectionItem,
  type AiStyleProp,
} from '../../supabase/functions/_shared/ai/contract.ts';
import { AiImageResponse, type AiImageRequest } from '../../supabase/functions/_shared/ai/images.ts';

/**
 * Quem produz propostas. O editor não sabe se é o simulador ou o servidor: recebe sempre uma
 * resposta por validar (forma com zod; documento em `apply.ts`).
 */
export interface Proposer {
  /** Texto mostrado no painel (ex.: «Simulador · sem IA»). */
  readonly label: string;
  readonly simulated: boolean;
  propose(req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse>;
}

export class ProposerError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Valida a forma da resposta (qualquer que seja a origem). */
export function parseResponse(raw: unknown): AiProposeResponse {
  const r = AiProposeResponse.safeParse(raw);
  if (!r.success) throw new ProposerError('A resposta do assistente não respeitou o formato. Nada foi alterado.', 'invalid_response');
  return r.data;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ProposerError('Pedido cancelado. Nada foi alterado.', 'aborted'));
    });
  });

const nodesInScope = (req: AiProposeRequest): AiNode[] => req.context.pages.flatMap((p) => p.nodes.filter((n) => n.inScope));

/**
 * SIMULADOR (sem IA, sem rede): interpreta comandos simples, para desenvolvimento, modo local e
 * testes automáticos. Não é o assistente real e o painel di-lo. Comandos (separados por «;» ou
 * mudança de linha), aplicados ao elemento/secção do âmbito:
 *   «texto: …», «ligação: URL», «nova janela», «nível h1…h6», «parágrafo», «cor VALOR»,
 *   «fundo VALOR», «tamanho VALOR», «negrito», «centrar»,
 *   «imagem: escolher» / «imagem: gerar DESCRIÇÃO», «fundo-imagem: escolher» / «fundo-imagem: gerar DESCRIÇÃO»,
 *   «inserir título: TEXTO» (dentro do âmbito), «duplicar ID», «eliminar ID», «mover ID depois de ID»,
 *   «secção: título=… | texto=… | botão=… -> /destino | imagem=gerar DESCRIÇÃO» (secção nova completa,
 *   no fim da página, com âmbito «Página» ou «Site inteiro»);
 * e, em página ou site inteiro: «títulos: cor VALOR» (todos os títulos do âmbito, em todas as páginas).
 * Marcadores de teste: [simulado:lento], [simulado:invalido], [simulado:fora], [simulado:vazio],
 * [simulado:ambiguo] (pergunta qual imagem, com a secção que tem imagem de fundo como opção).
 */
export class SimulatedProposer implements Proposer {
  readonly label = 'Simulador · sem IA';
  readonly simulated = true;
  constructor(private readonly delayMs = 250) {}

  async propose(req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse> {
    const text = req.instruction;
    await wait(text.includes('[simulado:lento]') ? 1500 : this.delayMs, signal);
    const respond = (proposal: AiProposal) => parseResponse({ contract: AI_CONTRACT_VERSION, documentVersion: req.documentVersion, proposal, model: 'simulador', simulated: true });
    if (text.includes('[simulado:invalido]')) {
      return parseResponse({ contract: AI_CONTRACT_VERSION, documentVersion: req.documentVersion, proposal: { summary: 'x', operations: [{ op: 'setHtml', id: 'x', html: '<b>x</b>' }] }, model: 'simulador', simulated: true });
    }
    const root = scopeRoot(req.scope);
    if (text.includes('[simulado:ambiguo]')) {
      const withBg = req.context.pages.flatMap((p) => p.nodes).find((n) => n.backgroundImage && !n.inScope);
      return respond({
        summary: 'Simulador: o pedido refere uma imagem que não é claramente a do âmbito.',
        operations: [],
        clarification: {
          question: 'Que imagem quer alterar? A imagem selecionada tem outra descrição; a secção tem uma imagem de fundo.',
          options: [
            ...(withBg ? [{ label: `A imagem de fundo de «${withBg.kind}»`, scope: { kind: 'section' as const, id: withBg.id } }] : []),
            { label: 'A imagem selecionada' },
          ],
        },
      });
    }
    const target = text.includes('[simulado:fora]') ? 'elemento-fora-do-ambito' : (root ?? nodesInScope(req)[0]?.id ?? '');
    const ops: AiOperation[] = [];
    const style: Partial<Record<AiStyleProp, string>> = {};
    const source = (rest: string): AiImageSource => {
      const m = /^gerar\s+(.+)$/i.exec(rest.trim());
      return m?.[1] ? { kind: 'generate', prompt: m[1].trim(), aspect: '16:9' } : { kind: 'choose', hint: rest.trim() || undefined };
    };
    const parts = text.replace(/\[simulado:[a-z]+\]/g, '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    let seq = 0;
    for (const part of parts) {
      let m: RegExpExecArray | null;
      if ((m = /^texto\s*:\s*(.+)$/i.exec(part)) && m[1]) ops.push({ op: 'setText', id: target, text: m[1].trim() });
      else if ((m = /^liga[çc][ãa]o\s*:\s*(\S+)$/i.exec(part)) && m[1]) ops.push({ op: 'setLink', id: target, href: m[1] });
      else if (/^nova janela$/i.test(part)) ops.push({ op: 'setLink', id: target, newTab: true });
      else if ((m = /^n[íi]vel\s+(h[1-6])$/i.exec(part)) && m[1]) {
        const level = m[1].toLowerCase();
        const tag = AI_TEXT_TAGS.find((t) => t === level);
        if (tag) ops.push({ op: 'setTextTag', id: target, tag });
      } else if (/^par[áa]grafo$/i.test(part)) ops.push({ op: 'setTextTag', id: target, tag: 'p' });
      else if ((m = /^imagem\s*:\s*(.*)$/i.exec(part))) ops.push({ op: 'replaceImage', id: target, image: source(m[1] ?? '') });
      else if ((m = /^fundo-imagem\s*:\s*(.*)$/i.exec(part))) ops.push({ op: 'setBackgroundImage', id: target, device: req.device, image: source(m[1] ?? '') });
      else if ((m = /^(?:cria|criar|gera|gerar)\s+(?:uma\s+)?imagem\s+de\s+fundo\s+(?:com|de)\s+(.+)$/i.exec(part)) && m[1]) {
        // Texto livre: imagem de fundo NOVA → geração (ou escolha, se a geração não estiver disponível).
        const prompt = m[1].trim();
        ops.push({ op: 'setBackgroundImage', id: target, device: req.device, image: req.imageGeneration ? { kind: 'generate', prompt, aspect: '16:9' } : { kind: 'choose', hint: prompt } });
      }
      else if ((m = /^inserir t[íi]tulo\s*:\s*(.+)$/i.exec(part)) && m[1]) {
        seq += 1;
        ops.push({ op: 'insertBlock', block: 'heading', anchor: target, position: 'inside', newId: `ai-titulo-${seq}`, text: m[1].trim() });
      } else if ((m = /^sec[çc][ãa]o\s*:\s*(.+)$/i.exec(part)) && m[1]) {
        seq += 1;
        const items: AiSectionItem[] = [];
        m[1].split('|').forEach((raw, k) => {
          const [key, ...rest] = raw.split('=');
          const value = rest.join('=').trim();
          const newId = `ai-seccao-${seq}-${k + 1}`;
          const kind = (key ?? '').trim().toLowerCase();
          if (kind === 'título' || kind === 'titulo') items.push({ block: 'heading', newId, text: value, tag: 'h2' });
          else if (kind === 'texto') items.push({ block: 'text', newId, text: value });
          else if (kind === 'botão' || kind === 'botao') {
            const [label, href] = value.split('->').map((x) => x.trim());
            items.push({ block: 'button', newId, text: label ?? '', ...(href ? { href } : {}) });
          } else if (kind === 'imagem') items.push({ block: 'image', newId, alt: 'Imagem da secção', image: source(value) });
        });
        const page = req.context.pages[0]?.nodes.find((n) => n.parent === null && n.inScope);
        if (items.length) ops.push({ op: 'insertSection', anchor: page?.id ?? target, position: 'inside', newId: `ai-seccao-${seq}`, items });
      } else if ((m = /^duplicar\s+(\S+)$/i.exec(part)) && m[1]) ops.push({ op: 'duplicate', id: m[1] });
      else if ((m = /^eliminar\s+(\S+)$/i.exec(part)) && m[1]) ops.push({ op: 'remove', id: m[1] });
      else if ((m = /^mover\s+(\S+)\s+depois de\s+(\S+)$/i.exec(part)) && m[1] && m[2]) ops.push({ op: 'move', id: m[1], anchor: m[2], position: 'after' });
      else if ((m = /^t[íi]tulos\s*:\s*cor\s+(.+)$/i.exec(part)) && m[1]) {
        const color = m[1].trim();
        for (const n of nodesInScope(req)) if (n.caps.tag && /^h[1-6]$/i.test(n.tag)) ops.push({ op: 'setOwnStyle', id: n.id, device: req.device, style: { color } });
      } else if ((m = /^cor\s+(.+)$/i.exec(part)) && m[1]) style.color = m[1];
      else if ((m = /^fundo\s+(.+)$/i.exec(part)) && m[1]) style['background-color'] = m[1];
      else if ((m = /^tamanho\s+(.+)$/i.exec(part)) && m[1]) style['font-size'] = m[1];
      else if (/^negrito$/i.test(part)) style['font-weight'] = '700';
      else if (/^centrar$/i.test(part)) style['text-align'] = 'center';
    }
    if (Object.keys(style).length) ops.push({ op: 'setOwnStyle', id: target, device: req.device, style });
    if (text.includes('[simulado:vazio]')) ops.length = 0;
    const part = req.context.part ? ` (parte ${req.context.part.index} de ${req.context.part.total})` : '';
    return respond({
      summary: ops.length ? `Simulador${part}: ${ops.length} operação(ões) a partir dos comandos do pedido.` : `Simulador${part}: nenhum comando reconhecido; nada a alterar.`,
      operations: ops,
    });
  }
}

/** Assistente real através da função `ai-propose` (só em modo servidor, quando ativado). */
export class ServerProposer implements Proposer {
  readonly simulated = false;
  constructor(
    private readonly client: SupabaseClient,
    readonly label = 'Assistente IA',
  ) {}

  async propose(req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse> {
    const { data, error } = await this.client.functions.invoke('ai-propose', { body: req, signal });
    if (signal.aborted) throw new ProposerError('Pedido cancelado. Nada foi alterado.', 'aborted');
    if (error) throw new ProposerError(await errorText(error, 'O assistente não respondeu. Nada foi alterado.'), 'server');
    return parseResponse(data);
  }
}

/** Mensagem de erro da função (corpo JSON com «error»), sem detalhes internos. */
async function errorText(error: unknown, fallback: string): Promise<string> {
  const ctx: unknown = error && typeof error === 'object' ? Reflect.get(error, 'context') : null;
  if (!(ctx instanceof Response)) return fallback;
  const body: unknown = await ctx.json().catch(() => null);
  const m = body && typeof body === 'object' ? Reflect.get(body, 'error') : null;
  if (typeof m !== 'string') return fallback;
  return m.includes('Nada foi') ? m : `${m} Nada foi alterado.`;
}

// ---------------------------------------------------------------- imagens

export interface GeneratedImageResult {
  blob: Blob;
  /** Só para administradores (o servidor não o envia aos outros utilizadores). */
  costUsd?: number;
  estimated?: boolean;
  simulated: boolean;
  model: string;
}

/** Quem gera imagens. Cada chamada é uma geração (com custo, no servidor); nunca repete sozinho. */
export interface ImageGenerator {
  readonly label: string;
  readonly simulated: boolean;
  /** Custo máximo por imagem (USD), mostrado ao ADMINISTRADOR antes de confirmar (NULL para os outros). */
  readonly priceUsd: number | null;
  generate(req: Omit<AiImageRequest, 'contract'>, signal: AbortSignal): Promise<GeneratedImageResult>;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Geração real pela função `ai-image` (imagem em base64; nada é guardado até aplicar). */
export class ServerImageGenerator implements ImageGenerator {
  readonly simulated = false;
  constructor(
    private readonly client: SupabaseClient,
    readonly label: string,
    readonly priceUsd: number | null,
  ) {}

  async generate(req: Omit<AiImageRequest, 'contract'>, signal: AbortSignal): Promise<GeneratedImageResult> {
    const { data, error } = await this.client.functions.invoke('ai-image', { body: { contract: 1, ...req }, signal });
    if (signal.aborted) throw new ProposerError('Geração cancelada.', 'aborted');
    if (error) throw new ProposerError(await errorText(error, 'A imagem não foi gerada. Nada foi alterado.'), 'server');
    const r = AiImageResponse.safeParse(data);
    if (!r.success) throw new ProposerError('A resposta da geração não respeitou o formato. Nada foi alterado.', 'invalid_response');
    return { blob: base64ToBlob(r.data.base64, r.data.mime), ...(r.data.costUsd !== undefined ? { costUsd: r.data.costUsd } : {}), ...(r.data.estimated !== undefined ? { estimated: r.data.estimated } : {}), simulated: false, model: r.data.model };
  }
}

/**
 * SIMULADOR de imagens (modo local e testes): desenha uma imagem de teste identificada como
 * «SIMULADA» (não é uma imagem gerada por IA), sem rede nem custo.
 */
export class SimulatedImageGenerator implements ImageGenerator {
  readonly label = 'Simulador de imagens · sem IA';
  readonly simulated = true;
  readonly priceUsd = 0;

  async generate(req: Omit<AiImageRequest, 'contract'>, signal: AbortSignal): Promise<GeneratedImageResult> {
    await wait(200, signal);
    const [w, h] = req.aspect === '1:1' ? [640, 640] : req.aspect === '9:16' || req.aspect === '3:4' ? [480, 640] : [800, 450];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ProposerError('O simulador de imagens não está disponível neste browser.', 'unavailable');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0ea5e9');
    g.addColorStop(1, '#6366f1');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('IMAGEM SIMULADA', 24, 56);
    ctx.font = '18px sans-serif';
    ctx.fillText(req.prompt.slice(0, 60), 24, 92);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new ProposerError('O simulador de imagens falhou.', 'unavailable');
    return { blob, costUsd: 0, estimated: false, simulated: true, model: 'simulador' };
  }
}
