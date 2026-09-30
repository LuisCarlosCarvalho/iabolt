import { handleAdmin, type AdminDeps, type AdminResult } from './admin.ts';
import { handleAdmin as handleAdminV1, type AdminDeps as AdminDepsV1, type AdminResult as AdminResultV1 } from './adminV1.ts';
import { AI_CONTRACT_VERSION, type AiProposeRequest } from './contract.ts';
import { AiProposal as AiProposalV1, AiProposeRequest as AiProposeRequestV1, AiProposeResponse as AiProposeResponseV1, checkProposalShape as checkShapeV1 } from './contractV1.ts';
import type { AiProposeRequest as RequestV1 } from './contractV1.ts';
import { handlePropose, type HandlerDeps } from './handler.ts';

/**
 * Camada de COMPATIBILIDADE com o frontend anterior (contrato v1, commit 6744483), para publicar
 * funções, migração e frontend sem janela de quebra:
 *  - administração: pedidos sem `api: 2` são tratados pela lógica v1 congelada (adminV1.ts), com as
 *    funções SQL v1 que a migração mantém (chave Anthropic, formato anterior);
 *  - propostas: um pedido `contract: 1` é convertido para v2 (âmbito «elemento», sem imagens nem
 *    estrutura), passa pelo MESMO pipeline (reserva, fornecedor, validação) e a resposta volta ao
 *    formato v1, validada com o esquema v1. Uma proposta que o editor v1 não saiba aplicar é
 *    recusada (nada é alterado).
 * Retirar quando o frontend v1 deixar de estar em uso.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : null);

/** JSON do corpo, ou null se não for JSON (o handler respetivo responde com o erro). */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function handleAdminAny(authHeader: string | null, rawBody: string, v2: AdminDeps, v1: AdminDepsV1): Promise<AdminResult | AdminResultV1> {
  const json = parseJson(rawBody);
  return obj(json)?.api === 2 ? handleAdmin(authHeader, rawBody, v2) : handleAdminV1(authHeader, rawBody, v1);
}

/** Pedido v1 (elemento selecionado) → pedido v2 equivalente (âmbito «elemento», sem imagens). */
export function requestFromV1(v1: RequestV1): AiProposeRequest {
  const c = v1.context;
  const caps = { ...c.capabilities, image: false, container: false };
  const pageId = 'pagina-v1';
  return {
    contract: AI_CONTRACT_VERSION,
    projectId: v1.projectId,
    documentVersion: v1.documentVersion,
    requestId: v1.requestId,
    scope: { kind: 'element', id: v1.scope.id, pageId },
    device: v1.device,
    instruction: v1.instruction,
    imageGeneration: false,
    context: {
      target: { id: c.id, kind: c.kind, tagName: c.tagName, capabilities: caps, content: c.content, styles: c.styles },
      pages: [{ id: pageId, name: c.page.name, slug: '', current: true, nodes: [{ id: c.id, parent: null, kind: c.kind, tag: c.tagName, inScope: true, caps }] }],
      variables: c.variables,
    },
  };
}

export async function handleProposeAny(authHeader: string | null, rawBody: string, deps: HandlerDeps): Promise<{ status: number; body: unknown }> {
  const json = parseJson(rawBody);
  if (obj(json)?.contract !== 1) return handlePropose(authHeader, rawBody, deps);
  const v1 = AiProposeRequestV1.safeParse(json);
  if (!v1.success) return { status: 400, body: { error: 'Pedido fora do contrato.', code: 'bad_request' } };
  const r = await handlePropose(authHeader, JSON.stringify(requestFromV1(v1.data)), deps);
  const body = obj(r.body);
  const proposal = obj(body?.proposal);
  if (r.status !== 200 || !body || !proposal) return r;
  // Um esclarecimento vira resumo (o editor v1 não o mostra de outra forma); sem operações.
  const clar = obj(proposal.clarification);
  const summary = `${String(proposal.summary ?? '')}${clar ? ` ${String(clar.question ?? '')}` : ''}`.trim().slice(0, 500);
  const down = AiProposalV1.safeParse({ summary, operations: clar ? [] : proposal.operations });
  if (!down.success || checkShapeV1(v1.data, down.data).length) {
    return { status: 502, body: { error: 'A proposta usa operações que esta versão do editor não suporta. Recarregue a página para usar a versão atual. Nada foi alterado.', code: 'unsupported_v1' } };
  }
  const res = AiProposeResponseV1.safeParse({
    contract: 1,
    documentVersion: body.documentVersion,
    proposal: down.data,
    model: body.model,
    simulated: false,
    ...(body.usage ? { usage: body.usage } : {}),
  });
  if (!res.success) return { status: 502, body: { error: 'A resposta não pôde ser convertida para esta versão do editor. Nada foi alterado.', code: 'unsupported_v1' } };
  return { status: 200, body: res.data };
}
