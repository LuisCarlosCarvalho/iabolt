import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AI_CONTRACT_VERSION,
  AI_TEXT_TAGS,
  AiProposeResponse,
  type AiOperation,
  type AiProposeRequest,
  type AiStyleProp,
} from '../../supabase/functions/_shared/ai/contract.ts';

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

/**
 * SIMULADOR (sem IA, sem rede): interpreta comandos simples, para desenvolvimento, modo local e
 * testes automáticos. Não é o assistente real e o painel di-lo. Comandos (separados por «;» ou
 * mudança de linha):
 *   «texto: …», «ligação: URL», «nova janela», «nível h1…h6», «parágrafo»,
 *   «cor VALOR», «fundo VALOR», «tamanho VALOR», «negrito», «centrar».
 * Marcadores de teste: [simulado:lento] (demora), [simulado:invalido] (resposta fora do formato),
 * [simulado:fora] (operação noutro elemento), [simulado:vazio] (sem operações).
 */
export class SimulatedProposer implements Proposer {
  readonly label = 'Simulador · sem IA';
  readonly simulated = true;
  constructor(private readonly delayMs = 250) {}

  async propose(req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse> {
    const text = req.instruction;
    await wait(text.includes('[simulado:lento]') ? 1500 : this.delayMs, signal);
    if (text.includes('[simulado:invalido]')) return parseResponse({ contract: AI_CONTRACT_VERSION, documentVersion: req.documentVersion, proposal: { summary: 'x', operations: [{ op: 'setHtml', id: req.scope.id, html: '<b>x</b>' }] }, model: 'simulador', simulated: true });
    const id = text.includes('[simulado:fora]') ? 'elemento-fora-do-ambito' : req.scope.id;
    const ops: AiOperation[] = [];
    const style: Partial<Record<AiStyleProp, string>> = {};
    const parts = text.replace(/\[simulado:[a-z]+\]/g, '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      let m: RegExpExecArray | null;
      if ((m = /^texto\s*:\s*(.+)$/i.exec(part)) && m[1]) ops.push({ op: 'setText', id, text: m[1].trim() });
      else if ((m = /^liga[çc][ãa]o\s*:\s*(\S+)$/i.exec(part)) && m[1]) ops.push({ op: 'setLink', id, href: m[1] });
      else if (/^nova janela$/i.test(part)) ops.push({ op: 'setLink', id, newTab: true });
      else if ((m = /^n[íi]vel\s+(h[1-6])$/i.exec(part)) && m[1]) {
        const level = m[1].toLowerCase();
        const tag = AI_TEXT_TAGS.find((t) => t === level);
        if (tag) ops.push({ op: 'setTextTag', id, tag });
      }
      else if (/^par[áa]grafo$/i.test(part)) ops.push({ op: 'setTextTag', id, tag: 'p' });
      else if ((m = /^cor\s+(.+)$/i.exec(part)) && m[1]) style.color = m[1];
      else if ((m = /^fundo\s+(.+)$/i.exec(part)) && m[1]) style['background-color'] = m[1];
      else if ((m = /^tamanho\s+(.+)$/i.exec(part)) && m[1]) style['font-size'] = m[1];
      else if (/^negrito$/i.test(part)) style['font-weight'] = '700';
      else if (/^centrar$/i.test(part)) style['text-align'] = 'center';
    }
    if (Object.keys(style).length) ops.push({ op: 'setOwnStyle', id, device: req.device, style });
    if (text.includes('[simulado:vazio]')) ops.length = 0;
    return parseResponse({
      contract: AI_CONTRACT_VERSION,
      documentVersion: req.documentVersion,
      proposal: { summary: ops.length ? `Simulador: ${ops.length} operação(ões) a partir dos comandos do pedido.` : 'Simulador: nenhum comando reconhecido; nada a alterar.', operations: ops },
      model: 'simulador',
      simulated: true,
    });
  }
}

/** Assistente real através da função `ai-propose` (só em modo servidor, quando ativado). */
export class ServerProposer implements Proposer {
  readonly simulated = false;
  constructor(
    private readonly client: SupabaseClient,
    readonly label = 'Claude Sonnet 5.5 · piloto',
  ) {}

  async propose(req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse> {
    const { data, error } = await this.client.functions.invoke('ai-propose', { body: req, signal });
    if (signal.aborted) throw new ProposerError('Pedido cancelado. Nada foi alterado.', 'aborted');
    if (error) {
      let message = 'O assistente não respondeu. Nada foi alterado.';
      const ctx: unknown = Reflect.get(error, 'context');
      if (ctx instanceof Response) {
        const body: unknown = await ctx.json().catch(() => null);
        const m = body && typeof body === 'object' ? Reflect.get(body, 'error') : null;
        if (typeof m === 'string') message = m.includes('Nada foi alterado') ? m : `${m} Nada foi alterado.`;
      }
      throw new ProposerError(message, 'server');
    }
    return parseResponse(data);
  }
}
