import type { Component, ComponentDefinition, Editor } from 'grapesjs';
import {
  checkProposalShape,
  type AiOperation,
  type AiProposal,
  type AiProposeRequest,
  type AiProposeResponse,
} from '../../supabase/functions/_shared/ai/contract.ts';
import type { GrapesProjectData } from '../contract/boltDocument';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { findById, setLink, setText, setTextTag, textTag } from '../engine/operations';
import { deviceById, EDITABLE_PROPS, getOwnStyle, setOwnStyle, type DeviceId, type EditableProp, type StylePatch } from '../engine/styles';
import { capabilitiesOf, plainText } from './context';

/**
 * Validação contra o documento atual, pré-visualização numa cópia e aplicação atómica das
 * operações propostas pelo assistente. Reutiliza as operações do editor (as mesmas da interface)
 * e a gravação existente (SaveQueue, pelos eventos normais do editor).
 */

// ---------------------------------------------------------------- versão local do documento

/** FNV-1a 32 bits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Versão LOCAL do documento: impressão digital do JSON do projeto no editor, incluindo alterações
 * ainda não gravadas (a revisão do servidor sozinha não as vê). Muda com qualquer edição.
 * NÃO chamar durante a edição de texto no canvas: ler o documento sincroniza o texto em edição e
 * reconstrói o elemento (o cursor saltaria). Ver `isEditingText`.
 */
/** Há texto a ser editado no canvas (o documento só fica atualizado quando a edição termina). */
export const isEditingText = (editor: Editor): boolean => Boolean(editor.getEditing());

export const EDITING_MESSAGE = 'Termine a edição de texto no canvas (clique fora do texto) antes de continuar. Nada foi alterado.';

export function documentVersion(editor: Editor): string {
  const json = JSON.stringify(getProjectData(editor));
  return `${json.length.toString(36)}-${fnv(json)}-${fnv(json.split('').reverse().join(''))}`;
}

// ---------------------------------------------------------------- validação

const EDITABLE = new Set<string>(EDITABLE_PROPS);
const isEditable = (p: string): p is EditableProp => EDITABLE.has(p);

/**
 * Valida a resposta contra o PEDIDO (forma, âmbito, capacidades) e contra o DOCUMENTO ATUAL
 * (versão local, elemento existente, capacidades reais). Devolve os problemas; vazio = aplicável.
 */
export function validateForDocument(editor: Editor, request: AiProposeRequest, response: AiProposeResponse): string[] {
  if (response.documentVersion !== request.documentVersion) return ['A resposta não corresponde a este pedido.'];
  if (isEditingText(editor)) return [EDITING_MESSAGE];
  if (documentVersion(editor) !== request.documentVersion) return ['O documento mudou desde o pedido. Nada foi alterado; peça uma nova proposta.'];
  const c = findById(editor, request.scope.id);
  if (!c) return ['O elemento do pedido já não existe.'];
  // As capacidades vêm do elemento real, não do que o pedido declarou.
  const live: AiProposeRequest = { ...request, context: { ...request.context, capabilities: capabilitiesOf(c) } };
  const errors = checkProposalShape(live, response.proposal);
  response.proposal.operations.forEach((op, i) => {
    if (op.op === 'setTextTag' && !textTag(c)) errors.push(`Operação ${i + 1}: o elemento não é um título nem um parágrafo.`);
    if (op.op === 'setOwnStyle') for (const p of Object.keys(op.style)) if (!isEditable(p)) errors.push(`Operação ${i + 1}: propriedade não editável (${p}).`);
  });
  return errors;
}

// ---------------------------------------------------------------- execução

function styleOf(op: Extract<AiOperation, { op: 'setOwnStyle' }>): StylePatch {
  const patch: StylePatch = {};
  for (const [p, v] of Object.entries(op.style)) if (isEditable(p) && typeof v === 'string') patch[p] = v.trim();
  return patch;
}

function runOperation(editor: Editor, op: AiOperation): void {
  switch (op.op) {
    case 'setText':
      setText(editor, op.id, op.text);
      return;
    case 'setLink':
      setLink(editor, op.id, { ...(op.href !== undefined ? { href: op.href.trim() } : {}), ...(op.newTab !== undefined ? { newTab: op.newTab } : {}) });
      return;
    case 'setTextTag':
      setTextTag(editor, op.id, op.tag);
      return;
    case 'setOwnStyle': {
      const c = findById(editor, op.id);
      if (!c) throw new Error(`Componente inexistente: ${op.id}`);
      setOwnStyle(editor, c, op.device, styleOf(op));
      return;
    }
  }
}

// ---------------------------------------------------------------- descrição em linguagem simples

export interface ChangeLine {
  what: string;
  before: string;
  after: string;
}

const PROP_LABEL: Partial<Record<EditableProp, string>> = {
  color: 'Cor do texto',
  'background-color': 'Cor de fundo',
  'font-family': 'Fonte',
  'font-size': 'Tamanho da letra',
  'font-weight': 'Peso',
  'line-height': 'Altura de linha',
  'text-align': 'Alinhamento',
  'border-radius': 'Raio dos cantos',
  'border-color': 'Cor da borda',
  'border-width': 'Espessura da borda',
  'border-style': 'Estilo da borda',
  'max-width': 'Largura máxima',
  opacity: 'Opacidade',
};
const TAG_LABEL: Record<string, string> = { p: 'Parágrafo', h1: 'Título 1', h2: 'Título 2', h3: 'Título 3', h4: 'Título 4', h5: 'Título 5', h6: 'Título 6' };

function propLabel(p: string): string {
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(p);
  if (m) return `${m[1] === 'padding' ? 'Espaço interior' : 'Margem'} (${{ top: 'cima', right: 'direita', bottom: 'baixo', left: 'esquerda' }[m[2] ?? 'top']})`;
  return isEditable(p) ? (PROP_LABEL[p] ?? p) : p;
}

/** Lista de alterações («o quê: antes → depois»), lida do documento atual. */
export function describeOperations(editor: Editor, ops: readonly AiOperation[]): ChangeLine[] {
  const out: ChangeLine[] = [];
  for (const op of ops) {
    const c = findById(editor, op.id);
    if (!c) continue;
    if (op.op === 'setText') out.push({ what: 'Texto', before: plainText(c), after: op.text });
    if (op.op === 'setLink') {
      const a = c.getAttributes();
      if (op.href !== undefined) out.push({ what: 'Destino da ligação', before: String(a.href ?? '—'), after: op.href || '—' });
      if (op.newTab !== undefined) out.push({ what: 'Abrir num novo separador', before: a.target === '_blank' ? 'sim' : 'não', after: op.newTab ? 'sim' : 'não' });
    }
    if (op.op === 'setTextTag') out.push({ what: 'Tipo de texto', before: TAG_LABEL[textTag(c) ?? ''] ?? '—', after: TAG_LABEL[op.tag] ?? op.tag });
    if (op.op === 'setOwnStyle') {
      const own = getOwnStyle(editor, c, op.device);
      const dev = deviceById(op.device).label;
      for (const [p, v] of Object.entries(styleOf(op))) out.push({ what: `${propLabel(p)} (${dev})`, before: (isEditable(p) ? own[p] : undefined) ?? 'herdado', after: v || 'herdado' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- pré-visualização numa cópia

/** Aplica as operações numa CÓPIA headless do documento (o editor real não muda). */
export function previewAfter(editor: Editor, ops: readonly AiOperation[]): GrapesProjectData {
  const copy = createBoltEditor({ projectData: getProjectData(editor) });
  try {
    const page = editor.Pages.getSelected();
    const same = page ? copy.Pages.get(page.getId()) : undefined;
    if (same) copy.Pages.select(same);
    for (const op of ops) runOperation(copy, op);
    return getProjectData(copy);
  } finally {
    copy.destroy();
  }
}

// ---------------------------------------------------------------- aplicação atómica

interface Snapshot {
  children: ComponentDefinition[];
  /** Texto guardado no próprio componente (templates), além dos filhos. */
  content: string;
  attributes: Record<string, unknown>;
  tagName: string;
  rules: Array<{ media: string; existed: boolean; style: Record<string, unknown> }>;
}

const mediaOf = (d: DeviceId) => (deviceById(d).media ? { atRuleType: 'media', atRuleParams: `(max-width: ${deviceById(d).media})` } : {});
const DEVICE_IDS: DeviceId[] = ['desktop', 'tablet', 'mobile'];

function snapshot(editor: Editor, c: Component): Snapshot {
  const children: ComponentDefinition[] = JSON.parse(JSON.stringify(c.components().toJSON()));
  return {
    children,
    content: String(c.get('content') ?? ''),
    attributes: { ...c.getAttributes() },
    tagName: String(c.get('tagName') ?? ''),
    rules: DEVICE_IDS.map((d) => {
      const rule = editor.Css.getRule(`#${c.getId()}`, mediaOf(d));
      return { media: d, existed: Boolean(rule), style: { ...(rule?.getStyle({ skipResolve: true }) ?? {}) } };
    }),
  };
}

function restore(editor: Editor, c: Component, s: Snapshot): void {
  if (JSON.stringify(c.components().toJSON()) !== JSON.stringify(s.children)) c.components(s.children);
  if (String(c.get('content') ?? '') !== s.content) c.set('content', s.content);
  c.setAttributes(s.attributes);
  if (c.get('tagName') !== s.tagName) c.set('tagName', s.tagName);
  for (const r of s.rules) {
    const opts = mediaOf(r.media as DeviceId);
    const rule = editor.Css.getRule(`#${c.getId()}`, opts);
    if (r.existed) {
      if (rule) rule.setStyle(r.style);
      else editor.Css.setRule(`#${c.getId()}`, r.style, opts);
    } else if (rule) editor.Css.remove(rule);
  }
}

/** Só para testes (desenvolvimento): força uma falha depois de N operações na aplicação. */
declare global {
  interface Window {
    __boltAiFailAfter?: number;
  }
}

export interface ApplyOptions {
  /** Falha simulada depois de N operações (testes). */
  failAfter?: number;
}

/**
 * Aplica as operações ao editor real, de forma atómica:
 *  1. ensaio SEM histórico, com cópia do estado do elemento; qualquer falha repõe o estado e
 *     sai sem tocar no histórico (o anterior, incluindo «Refazer», fica intacto);
 *  2. reposição e aplicação COM histórico, tudo na mesma volta do ciclo de eventos: um único
 *     passo de desfazer reverte o lote.
 * Tudo é síncrono: a gravação automática (temporizada) nunca vê um estado intermédio.
 */
export function applyOperations(editor: Editor, scopeId: string, ops: readonly AiOperation[], opts: ApplyOptions = {}): void {
  const c = findById(editor, scopeId);
  if (!c) throw new Error('O elemento do pedido já não existe.');
  const failAfter = opts.failAfter ?? (import.meta.env.DEV && typeof window !== 'undefined' ? window.__boltAiFailAfter : undefined);
  const before = snapshot(editor, c);
  const um = editor.UndoManager;
  um.stop();
  try {
    ops.forEach((op, i) => {
      if (failAfter !== undefined && i >= failAfter) throw new Error('Falha simulada durante a aplicação.');
      runOperation(editor, op);
    });
  } catch (e) {
    restore(editor, c, before);
    um.start();
    throw e;
  }
  restore(editor, c, before);
  um.start();
  for (const op of ops) runOperation(editor, op);
}

export type { AiProposal };
