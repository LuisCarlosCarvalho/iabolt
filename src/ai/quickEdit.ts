import type { Component, Editor } from 'grapesjs';
import { AI_CONTRACT_VERSION, AiProposeRequest, type AiOperation, type AiProposeResponse } from '../../supabase/functions/_shared/ai/contract.ts';
import type { DeviceId } from '../engine/styles';
import { applyOperations, describeOperations, documentVersion, EDITING_MESSAGE, imageSlots, isEditingText, validateForDocument, type ChangeLine } from './apply';
import { buildScopeContext, planParts, resolveScope } from './context';
import type { Proposer } from './proposers';
import { canvasSettled, hiddenStyleChanges, type HiddenChange } from './visibility';

/**
 * «Editar com IA» rápido (janela pequena junto ao elemento): pedido → proposta validada →
 * APLICADA logo, num único passo de desfazer. Usa exatamente o mesmo contrato, validação e
 * aplicação do painel do assistente; só não tem antes/depois. O que precisa de decisão do
 * utilizador (esclarecimento, imagens a escolher, pedido grande) não é aplicado: é encaminhado
 * para o painel completo.
 */
export type QuickEditResult =
  | { kind: 'applied'; changes: ChangeLine[]; hidden: HiddenChange[]; summary: string; ops: AiOperation[] }
  | { kind: 'nothing'; summary: string }
  | { kind: 'clarify'; question: string; summary: string }
  | { kind: 'needs-panel'; reason: string }
  /** A proposta precisa de imagens: segue para o painel JÁ com a proposta (sem novo pedido). */
  | { kind: 'needs-images'; handoff: AiHandoff; generate: boolean }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; details?: string[] };

/** Proposta passada da janela rápida para o painel completo (imagens a gerar ou a escolher). */
export interface AiHandoff {
  request: AiProposeRequest;
  response: AiProposeResponse;
  /** Abrir logo a confirmação «Gerar imagem». */
  autoGenerate: boolean;
}

export interface QuickEditInput {
  editor: Editor;
  proposer: Proposer;
  projectId: string;
  /** Ecrã visível no canvas (para verificar que os estilos aplicados se veem). O pedido é sempre sobre a base. */
  device: DeviceId;
  instruction: string;
  component: Component;
  signal: AbortSignal;
  /** Há gerador de imagens disponível (o modelo pode propor imagens NOVAS). */
  imageGeneration?: boolean;
  /** Só em desenvolvimento: os testes leem o pedido enviado. */
  onRequest?: (req: AiProposeRequest) => void;
}

export async function runQuickEdit(input: QuickEditInput): Promise<QuickEditResult> {
  const { editor, proposer, projectId, component, signal } = input;
  // Responsivo automático: base (todos os ecrãs) + ajustes de tablet/telemóvel propostos pelo assistente.
  const device: DeviceId = 'desktop';
  const view = input.device;
  const instruction = input.instruction.trim();
  if (!instruction) return { kind: 'error', message: 'Escreva o que quer alterar.' };
  if (isEditingText(editor)) return { kind: 'error', message: EDITING_MESSAGE };
  const scope = resolveScope(editor, 'element', component);
  if (!scope) return { kind: 'error', message: 'Selecione um elemento da página.' };
  const parts = planParts(buildScopeContext(editor, scope.scope, device));
  const part = parts[0];
  if (parts.length !== 1 || !part) return { kind: 'needs-panel', reason: 'Este elemento é grande demais para um pedido rápido.' };
  const parsed = AiProposeRequest.safeParse({
    contract: AI_CONTRACT_VERSION,
    projectId,
    documentVersion: documentVersion(editor),
    requestId: crypto.randomUUID(),
    scope: scope.scope,
    device,
    instruction,
    // Com gerador disponível o modelo pode propor gerar; a geração em si é confirmada no painel.
    imageGeneration: input.imageGeneration === true,
    context: part.context,
  });
  if (!parsed.success) return { kind: 'error', message: 'Não foi possível preparar o pedido. Nada foi enviado.' };
  const request = parsed.data;
  input.onRequest?.(request);
  let response;
  try {
    response = await proposer.propose(request, signal);
  } catch (e) {
    if (signal.aborted) return { kind: 'cancelled' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'O assistente não respondeu. Nada foi alterado.' };
  }
  if (signal.aborted) return { kind: 'cancelled' };
  const proposal = response.proposal;
  if (proposal.clarification) return { kind: 'clarify', question: proposal.clarification.question, summary: proposal.summary };
  const problems = validateForDocument(editor, request, response);
  if (problems.length) {
    if (problems[0] === EDITING_MESSAGE) return { kind: 'error', message: EDITING_MESSAGE };
    const stale = problems.some((p) => p.includes('documento mudou'));
    return stale
      ? { kind: 'error', message: 'O documento mudou enquanto esperava. Nada foi alterado; peça de novo.' }
      : { kind: 'error', message: 'A proposta não passou na validação. Nada foi alterado.', details: problems };
  }
  const ops = proposal.operations;
  if (ops.length === 0) return { kind: 'nothing', summary: proposal.summary };
  const slots = imageSlots(ops);
  if (slots.length > 0) {
    const generate = slots.some((x) => x.source.kind === 'generate');
    return { kind: 'needs-images', generate, handoff: { request, response, autoGenerate: generate } };
  }
  const changes = describeOperations(editor, ops);
  try {
    applyOperations(editor, ops, new Map());
  } catch {
    return { kind: 'error', message: 'A aplicação falhou e o documento foi reposto como estava. Nada foi alterado.' };
  }
  await canvasSettled(editor);
  return { kind: 'applied', changes, hidden: hiddenStyleChanges(editor, ops, view), summary: proposal.summary, ops };
}
