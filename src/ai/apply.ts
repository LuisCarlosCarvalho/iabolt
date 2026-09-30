import type { Component, ComponentDefinition, CssRule, Editor } from 'grapesjs';
import {
  checkProposalShape,
  imageSourcesOf,
  opTargets,
  type AiCapabilities,
  type AiImageSource,
  type AiNode,
  type AiOperation,
  type AiProposal,
  type AiProposeRequest,
  type AiProposeResponse,
  type AiScope,
  type AiSectionItem,
} from '../../supabase/functions/_shared/ai/contract.ts';
import type { GrapesProjectData } from '../contract/boltDocument';
import { blockById } from '../engine/blocks';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { displayName } from '../engine/labels';
import {
  duplicateComponent,
  findInProject,
  insertDefAt,
  moveRelative,
  setImageOn,
  setLinkOn,
  setTextOn,
  setTextTagOn,
  textTag,
} from '../engine/operations';
import { listPages } from '../engine/pages';
import { deviceById, EDITABLE_PROPS, getOwnStyle, setOwnStyle, type DeviceId, type EditableProp, type StylePatch } from '../engine/styles';
import { capabilitiesOf, plainText } from './context';

/**
 * Validação contra o documento atual, pré-visualização numa cópia e aplicação atómica das
 * operações propostas pelo assistente, em qualquer âmbito (elemento, secção, página, site).
 * Reutiliza as operações do editor (as mesmas da interface) e a gravação existente (SaveQueue,
 * pelos eventos normais do editor). Uma proposta aplicada = um único passo de desfazer, mesmo
 * quando altera várias páginas.
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

/** Há texto a ser editado no canvas (o documento só fica atualizado quando a edição termina). */
export const isEditingText = (editor: Editor): boolean => Boolean(editor.getEditing());

export const EDITING_MESSAGE = 'Termine a edição de texto no canvas (clique fora do texto) antes de continuar. Nada foi alterado.';

/**
 * Versão LOCAL do documento: impressão digital do JSON do projeto no editor, incluindo alterações
 * ainda não gravadas. Muda com qualquer edição. NÃO chamar durante a edição de texto no canvas
 * (ler o documento reconstrói o elemento em edição; ver `isEditingText`).
 */
export function documentVersion(editor: Editor): string {
  const json = JSON.stringify(getProjectData(editor));
  return `${json.length.toString(36)}-${fnv(json)}-${fnv(json.split('').reverse().join(''))}`;
}

// ---------------------------------------------------------------- imagens resolvidas

/**
 * Imagem escolhida para uma operação (índice na proposta): o endereço para MOSTRAR agora e o que
 * fica gravado. Uma imagem gerada ou carregada ainda por enviar tem `pending` (o ficheiro), e só é
 * guardada no armazenamento do workspace quando o utilizador aplica.
 */
export interface ImageChoice {
  display: string;
  /** Referência permanente (biblioteca, imagem da página). Ausente enquanto `pending`. */
  stored?: string;
  pending?: Blob;
  /** De onde veio (para mostrar): escolhida, carregada ou gerada. */
  origin: 'library' | 'page' | 'upload' | 'generated';
  /** Custo já incorrido (geração), só informativo. */
  costUsd?: number;
}

/** Imagens escolhidas, por chave («N» ou «N.i», ver `imageSourcesOf`). */
export type ImageChoices = ReadonlyMap<string, ImageChoice>;

export interface ImageSlotInfo {
  key: string;
  source: AiImageSource;
  op: AiOperation;
  /** Elemento de uma secção nova, quando a imagem é de um deles. */
  item?: AiSectionItem;
}

/** Imagens da proposta que o utilizador tem de escolher, carregar ou gerar antes de aplicar. */
export function imageSlots(ops: readonly AiOperation[]): ImageSlotInfo[] {
  return ops.flatMap((op, index) =>
    imageSourcesOf(op, index).map((s) => {
      const item = op.op === 'insertSection' ? op.items[Number(s.key.split('.')[1])] : undefined;
      return { key: s.key, source: s.source, op, ...(item ? { item } : {}) };
    }),
  );
}

// ---------------------------------------------------------------- âmbito no documento real

/** O elemento pertence ao âmbito, lido do DOCUMENTO (não do pedido). */
function inScope(editor: Editor, scope: AiScope, c: Component, pageId: string): boolean {
  switch (scope.kind) {
    case 'site':
      return true;
    case 'page':
      return pageId === scope.pageId;
    case 'element':
      return pageId === scope.pageId && c.getId() === scope.id;
    case 'section': {
      if (pageId !== scope.pageId) return false;
      return c.getId() === scope.id || c.parents().some((p) => p.getId() === scope.id);
    }
  }
}

const EDITABLE = new Set<string>(EDITABLE_PROPS);
const isEditable = (p: string): p is EditableProp => EDITABLE.has(p);

/**
 * Valida a resposta contra o PEDIDO (forma, âmbito, capacidades) e contra o DOCUMENTO ATUAL
 * (versão local, elementos existentes, âmbito e capacidades reais) e ensaia-a numa cópia.
 * Devolve os problemas; vazio = aplicável.
 */
export function validateForDocument(editor: Editor, request: AiProposeRequest, response: AiProposeResponse): string[] {
  if (response.documentVersion !== request.documentVersion) return ['A resposta não corresponde a este pedido.'];
  if (isEditingText(editor)) return [EDITING_MESSAGE];
  if (documentVersion(editor) !== request.documentVersion) return ['O documento mudou desde o pedido. Nada foi alterado; peça uma nova proposta.'];
  const ops = response.proposal.operations;
  // Nós referidos, com capacidades e âmbito lidos do documento.
  const nodes: AiNode[] = [];
  const seen = new Set<string>();
  let root: Component | undefined;
  for (const op of ops) {
    const { id, anchor } = opTargets(op);
    for (const x of [id, anchor]) {
      if (!x || seen.has(x)) continue;
      seen.add(x);
      const hit = findInProject(editor, x);
      if (!hit) continue; // criado pela própria proposta, ou inexistente (a forma o diz)
      if (request.scope.kind !== 'site' && request.scope.kind !== 'page' && hit.component.getId() === request.scope.id) root = hit.component;
      nodes.push({ id: x, parent: null, kind: '', tag: '', inScope: inScope(editor, request.scope, hit.component, hit.page.getId()), caps: capabilitiesOf(editor, hit.component) });
    }
  }
  const live: AiProposeRequest = {
    ...request,
    context: {
      ...request.context,
      ...(request.context.target && root ? { target: { ...request.context.target, capabilities: capabilitiesOf(editor, root) } } : {}),
      pages: [{ id: 'documento', name: '', slug: '', current: true, nodes }],
    },
  };
  const errors = checkProposalShape(live, response.proposal);
  ops.forEach((op, i) => {
    if (op.op === 'insertBlock' && findInProject(editor, op.newId)) errors.push(`Operação ${i + 1}: o identificador novo já existe no documento.`);
    if (op.op === 'setOwnStyle') for (const p of Object.keys(op.style)) if (!isEditable(p)) errors.push(`Operação ${i + 1}: propriedade não editável (${p}).`);
  });
  if (errors.length) return errors;
  // Ensaio numa cópia: qualquer operação que o motor recuse torna a proposta inaplicável.
  try {
    previewAfter(editor, ops, placeholderChoices(ops));
  } catch (e) {
    return [`A proposta não pode ser aplicada a este documento: ${e instanceof Error ? e.message : String(e)}`];
  }
  return [];
}

/** Imagens provisórias para ensaiar a estrutura antes de o utilizador escolher as reais. */
function placeholderChoices(ops: readonly AiOperation[]): ImageChoices {
  const px = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  return new Map(imageSlots(ops).map((s) => [s.key, { display: px, origin: 'page' as const }]));
}

// ---------------------------------------------------------------- execução

function styleOf(op: Extract<AiOperation, { op: 'setOwnStyle' }>): StylePatch {
  const patch: StylePatch = {};
  for (const [p, v] of Object.entries(op.style)) if (isEditable(p) && typeof v === 'string') patch[p] = v.trim();
  return patch;
}

/** Componentes criados pela proposta (newId → componente), válidos durante uma execução. */
type Created = Map<string, Component>;

function resolve(editor: Editor, id: string, created: Created): Component {
  const c = created.get(id) ?? findInProject(editor, id)?.component;
  if (!c) throw new Error(`Elemento inexistente: ${id}`);
  return c;
}

function imageFor(choices: ImageChoices, key: string): string {
  const c = choices.get(key);
  if (!c) throw new Error('Falta escolher uma imagem da proposta.');
  return c.display;
}

function runOperation(editor: Editor, op: AiOperation, index: number, choices: ImageChoices, created: Created): void {
  switch (op.op) {
    case 'setText':
      setTextOn(resolve(editor, op.id, created), op.text);
      return;
    case 'setLink':
      setLinkOn(resolve(editor, op.id, created), { ...(op.href !== undefined ? { href: op.href.trim() } : {}), ...(op.newTab !== undefined ? { newTab: op.newTab } : {}) });
      return;
    case 'setTextTag':
      setTextTagOn(resolve(editor, op.id, created), op.tag);
      return;
    case 'setOwnStyle':
      setOwnStyle(editor, resolve(editor, op.id, created), op.device, styleOf(op));
      return;
    case 'replaceImage':
      setImageOn(resolve(editor, op.id, created), { src: imageFor(choices, String(index)), ...(op.alt !== undefined ? { alt: op.alt } : {}) });
      return;
    case 'setBackgroundImage':
      setOwnStyle(editor, resolve(editor, op.id, created), op.device, { 'background-image': `url("${imageFor(choices, String(index))}")` });
      return;
    case 'insertBlock': {
      const block = blockById(op.block);
      if (!block) throw new Error(`Bloco desconhecido: ${op.block}`);
      const base: ComponentDefinition = block.content();
      const def: ComponentDefinition = { ...base, attributes: { ...(typeof base.attributes === 'object' && base.attributes ? base.attributes : {}), id: op.newId } };
      const added = insertDefAt(editor, def, resolve(editor, op.anchor, created), op.position);
      created.set(op.newId, added);
      if (op.text !== undefined) setTextOn(added, op.text);
      if (op.href !== undefined) setLinkOn(added, { href: op.href.trim() });
      if (op.block === 'image') setImageOn(added, { src: imageFor(choices, String(index)) });
      return;
    }
    case 'insertSection': {
      const added = insertDefAt(editor, sectionDef(op.newId, op.items, (i) => imageFor(choices, `${index}.${i}`)), resolve(editor, op.anchor, created), op.position);
      // Referências temporárias → elementos criados (para as operações seguintes da proposta).
      const walk = (c: Component) => {
        created.set(c.getId(), c);
        c.components().models.forEach(walk);
      };
      walk(added);
      for (const id of [op.newId, ...op.items.map((it) => it.newId)]) if (!created.has(id)) throw new Error(`Elemento novo sem identificador: ${id}`);
      return;
    }
    case 'move':
      moveRelative(editor, resolve(editor, op.id, created), resolve(editor, op.anchor, created), op.position);
      return;
    case 'duplicate':
      duplicateComponent(editor, resolve(editor, op.id, created));
      return;
    case 'remove': {
      const c = resolve(editor, op.id, created);
      if (!c.parent()) throw new Error('A página não pode ser eliminada.');
      c.remove();
      return;
    }
  }
}

/**
 * Definição de uma secção nova com os elementos pedidos (mesma estrutura do bloco «Secção» do
 * editor: secção → contentor → elementos), cada um com o identificador proposto. O texto entra como
 * nó de texto (nunca HTML).
 */
function sectionDef(newId: string, items: readonly AiSectionItem[], imageOf: (i: number) => string): ComponentDefinition {
  const text = (t: string | undefined): ComponentDefinition[] => [{ type: 'textnode', content: t ?? '' }];
  const children: ComponentDefinition[] = items.map((it, i) => {
    switch (it.block) {
      case 'heading':
        return { type: 'text', tagName: it.tag ?? 'h2', attributes: { id: it.newId }, components: text(it.text) };
      case 'text':
        return { type: 'text', tagName: it.tag ?? 'p', attributes: { id: it.newId }, components: text(it.text) };
      case 'button':
        return { type: 'bolt-button', classes: ['bolt-btn'], attributes: { id: it.newId, href: (it.href ?? '#').trim() }, components: text(it.text) };
      case 'image':
        return { type: 'image', classes: ['bolt-image'], attributes: { id: it.newId, src: imageOf(i), alt: it.alt ?? '' } };
    }
  });
  return {
    type: 'bolt-section',
    classes: ['bolt-section'],
    attributes: { id: newId },
    components: [{ type: 'bolt-container', classes: ['bolt-container'], components: children }],
  };
}

function runAll(editor: Editor, ops: readonly AiOperation[], choices: ImageChoices, failAfter?: number): void {
  const created: Created = new Map();
  ops.forEach((op, i) => {
    if (failAfter !== undefined && i >= failAfter) throw new Error('Falha simulada durante a aplicação.');
    runOperation(editor, op, i, choices, created);
  });
}

// ---------------------------------------------------------------- descrição em linguagem simples

export interface ChangeLine {
  what: string;
  before: string;
  after: string;
  /** Página do elemento alterado. */
  page: string;
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
  'background-size': 'Tamanho do fundo',
  'background-position': 'Posição do fundo',
};
const TAG_LABEL: Record<string, string> = { p: 'Parágrafo', h1: 'Título 1', h2: 'Título 2', h3: 'Título 3', h4: 'Título 4', h5: 'Título 5', h6: 'Título 6' };
const BLOCK_LABEL: Record<string, string> = { section: 'Secção', columns: 'Colunas', heading: 'Título', text: 'Texto', button: 'Botão', image: 'Imagem' };
const POSITION_LABEL = { before: 'antes de', after: 'depois de', inside: 'dentro de' } as const;
const ITEM_LABEL: Record<AiSectionItem['block'], string> = { heading: 'Título', text: 'Texto', button: 'Botão', image: 'Imagem' };
const ORIGIN_LABEL: Record<ImageChoice['origin'], string> = { library: 'imagem do workspace', page: 'imagem já usada', upload: 'imagem carregada', generated: 'imagem gerada' };

function propLabel(p: string): string {
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(p);
  if (m) return `${m[1] === 'padding' ? 'Espaço interior' : 'Margem'} (${{ top: 'cima', right: 'direita', bottom: 'baixo', left: 'esquerda' }[m[2] ?? 'top']})`;
  return isEditable(p) ? (PROP_LABEL[p] ?? p) : p;
}

/** Nome da página de cada componente. */
function pageNames(editor: Editor): Map<string, string> {
  return new Map(listPages(editor).map((p) => [p.id, p.name]));
}

/** Lista de alterações («o quê: antes → depois», com a página), lida do documento atual. */
export function describeOperations(editor: Editor, ops: readonly AiOperation[], choices: ImageChoices = new Map()): ChangeLine[] {
  const names = pageNames(editor);
  const out: ChangeLine[] = [];
  const newNames = new Map<string, string>();
  const label = (id: string) => {
    const c = findInProject(editor, id)?.component;
    return c ? displayName(c) : (newNames.get(id) ?? id);
  };
  ops.forEach((op, index) => {
    const { id, anchor } = opTargets(op);
    const hit = findInProject(editor, id ?? anchor ?? '');
    const page = hit ? (names.get(hit.page.getId()) ?? '') : '';
    const c = hit?.component;
    const push = (what: string, before: string, after: string) => out.push({ what, before, after, page });
    const img = (key = String(index)) => {
      const ch = choices.get(key);
      const src = imageSourcesOf(op, index).find((s) => s.key === key)?.source;
      return ch ? ORIGIN_LABEL[ch.origin] : src?.kind === 'generate' ? `gerar: «${src.prompt}»` : 'por escolher';
    };
    switch (op.op) {
      case 'setText':
        if (c) push(`Texto · ${displayName(c)}`, plainText(c), op.text);
        break;
      case 'setLink':
        if (c) {
          const a = c.getAttributes();
          if (op.href !== undefined) push(`Destino da ligação · ${displayName(c)}`, String(a.href ?? '—'), op.href || '—');
          if (op.newTab !== undefined) push(`Abrir num novo separador · ${displayName(c)}`, a.target === '_blank' ? 'sim' : 'não', op.newTab ? 'sim' : 'não');
        }
        break;
      case 'setTextTag':
        if (c) push(`Tipo de texto · ${displayName(c)}`, TAG_LABEL[textTag(c) ?? ''] ?? '—', TAG_LABEL[op.tag] ?? op.tag);
        break;
      case 'setOwnStyle':
        if (c) {
          const own = getOwnStyle(editor, c, op.device);
          const dev = deviceById(op.device).label;
          for (const [p, v] of Object.entries(styleOf(op))) push(`${propLabel(p)} (${dev}) · ${displayName(c)}`, (isEditable(p) ? own[p] : undefined) ?? 'herdado', v || 'herdado');
        }
        break;
      case 'replaceImage':
        if (c) push(`Imagem · ${displayName(c)}`, String(c.getAttributes().alt ?? '') || 'imagem atual', `${img()}${op.alt ? ` («${op.alt}»)` : ''}`);
        break;
      case 'setBackgroundImage':
        if (c) push(`Imagem de fundo (${deviceById(op.device).label}) · ${displayName(c)}`, getOwnStyle(editor, c, op.device)['background-image'] ? 'imagem atual' : 'sem imagem própria', img());
        break;
      case 'insertBlock':
        newNames.set(op.newId, BLOCK_LABEL[op.block] ?? op.block);
        push(`Inserir ${BLOCK_LABEL[op.block] ?? op.block}`, '—', `${POSITION_LABEL[op.position]} «${label(op.anchor)}»${op.text ? `: ${op.text}` : ''}${op.block === 'image' ? ` (${img()})` : ''}`);
        break;
      case 'insertSection': {
        newNames.set(op.newId, 'Secção nova');
        const parts = op.items.map((it, i) => {
          newNames.set(it.newId, ITEM_LABEL[it.block]);
          if (it.block === 'image') return `imagem (${img(`${index}.${i}`)})`;
          return `${ITEM_LABEL[it.block].toLowerCase()} «${it.text ?? ''}»${it.block === 'button' && it.href ? ` → ${it.href}` : ''}`;
        });
        push('Inserir secção', '—', `${POSITION_LABEL[op.position]} «${label(op.anchor)}»: ${parts.join(', ')}`);
        break;
      }
      case 'move':
        push(`Mover · ${label(op.id)}`, 'posição atual', `${POSITION_LABEL[op.position]} «${label(op.anchor)}»`);
        break;
      case 'duplicate':
        push(`Duplicar · ${label(op.id)}`, '—', 'cópia logo a seguir');
        break;
      case 'remove':
        push(`Eliminar · ${label(op.id)}`, c && plainText(c) ? plainText(c).slice(0, 80) : 'elemento atual', '—');
        break;
    }
  });
  return out;
}

/** Páginas que a proposta altera (ids, pela ordem das páginas). */
export function affectedPageIds(editor: Editor, ops: readonly AiOperation[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    const { id, anchor } = opTargets(op);
    for (const x of [id, anchor]) {
      const hit = x ? findInProject(editor, x) : undefined;
      if (hit) ids.add(hit.page.getId());
    }
  }
  return editor.Pages.getAll().map((p) => p.getId()).filter((id) => ids.has(id));
}

// ---------------------------------------------------------------- pré-visualização numa cópia

/** Aplica as operações numa CÓPIA headless do documento (o editor real não muda). */
export function previewAfter(editor: Editor, ops: readonly AiOperation[], choices: ImageChoices): GrapesProjectData {
  const copy = createBoltEditor({ projectData: getProjectData(editor) });
  try {
    const page = editor.Pages.getSelected();
    const same = page ? copy.Pages.get(page.getId()) : undefined;
    if (same) copy.Pages.select(same);
    runAll(copy, ops, choices);
    return getProjectData(copy);
  } finally {
    copy.destroy();
  }
}

// ---------------------------------------------------------------- aplicação atómica

/** Estado de um componente que uma operação pode mudar (filhos, texto próprio, atributos, etiqueta). */
interface NodeState {
  component: Component;
  children: ComponentDefinition[];
  json: string;
  content: string;
  attributes: Record<string, unknown>;
  tagName: string;
  /** Imagens: o endereço é uma propriedade própria (além do atributo). */
  src: string | null;
}

interface Snapshot {
  nodes: NodeState[];
  rules: Map<CssRule, Record<string, unknown>>;
  selectedId: string | null;
}

/**
 * Menores subárvores que as operações podem mudar: o próprio elemento (texto, ligação, nível,
 * imagem) ou o pai (inserir, mover, duplicar, eliminar). Estilos e fundos vivem nas regras CSS.
 * Raízes dentro de outras raízes são descartadas. Só estas subárvores são repostas: o resto do
 * canvas não é recriado.
 */
function restoreRoots(editor: Editor, ops: readonly AiOperation[]): Component[] {
  const roots = new Set<Component>();
  const add = (c: Component | undefined) => {
    if (c) roots.add(c);
  };
  const find = (id: string) => findInProject(editor, id)?.component;
  for (const op of ops) {
    switch (op.op) {
      case 'setText':
      case 'setLink':
      case 'setTextTag':
      case 'replaceImage':
        add(find(op.id));
        break;
      case 'insertBlock':
      case 'insertSection': {
        const a = find(op.anchor);
        add(op.position === 'inside' ? a : a?.parent());
        break;
      }
      case 'move': {
        add(find(op.id)?.parent());
        const a = find(op.anchor);
        add(op.position === 'inside' ? a : a?.parent());
        break;
      }
      case 'duplicate':
      case 'remove':
        add(find(op.id)?.parent());
        break;
      case 'setOwnStyle':
      case 'setBackgroundImage':
        break;
    }
  }
  return [...roots].filter((r) => !r.parents().some((p) => roots.has(p)));
}

function snapshot(editor: Editor, ops: readonly AiOperation[]): Snapshot {
  const nodes = restoreRoots(editor, ops).map((c) => {
    const json = JSON.stringify(c.components().toJSON());
    const children: ComponentDefinition[] = JSON.parse(json);
    return {
      component: c,
      children,
      json,
      content: String(c.get('content') ?? ''),
      attributes: { ...c.getAttributes() },
      tagName: String(c.get('tagName') ?? ''),
      src: c.is('image') ? String(c.get('src') ?? '') : null,
    };
  });
  const rules = new Map(editor.Css.getAll().models.map((r) => [r, { ...r.getStyle({ skipResolve: true }) }] as const));
  return { nodes, rules, selectedId: editor.getSelected()?.getId() ?? null };
}

/** Repõe as subárvores e as regras CSS do instantâneo (sem histórico: o chamador pára-o). */
function restore(editor: Editor, s: Snapshot): void {
  for (const n of s.nodes) {
    const c = n.component;
    if (JSON.stringify(c.components().toJSON()) !== n.json) c.components(n.children);
    if (String(c.get('content') ?? '') !== n.content) c.set('content', n.content);
    if (JSON.stringify(c.getAttributes()) !== JSON.stringify(n.attributes)) c.setAttributes(n.attributes);
    if (String(c.get('tagName') ?? '') !== n.tagName) c.set('tagName', n.tagName);
    if (n.src !== null && String(c.get('src') ?? '') !== n.src) c.set('src', n.src);
  }
  for (const rule of [...editor.Css.getAll().models]) {
    const saved = s.rules.get(rule);
    if (!saved) editor.Css.remove(rule);
    else if (JSON.stringify(rule.getStyle({ skipResolve: true })) !== JSON.stringify(saved)) rule.setStyle(saved);
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
 * Aplica as operações ao editor real, de forma atómica, em qualquer número de páginas:
 *  1. ensaio SEM histórico, com cópia das páginas tocadas e das regras CSS; qualquer falha repõe o
 *     estado e sai sem tocar no histórico (o anterior, incluindo «Refazer», fica intacto);
 *  2. reposição e aplicação COM histórico, tudo na mesma volta do ciclo de eventos: um único
 *     passo de desfazer reverte o lote inteiro, em todas as páginas.
 * Tudo é síncrono: a gravação automática (temporizada) nunca vê um estado intermédio. As imagens
 * têm de estar já resolvidas (carregadas) em `choices`.
 */
export function applyOperations(editor: Editor, ops: readonly AiOperation[], choices: ImageChoices, opts: ApplyOptions = {}): void {
  for (const s of imageSlots(ops)) {
    const ch = choices.get(s.key);
    if (!ch || ch.pending) throw new Error('Há imagens da proposta por escolher ou por carregar.');
  }
  const failAfter = opts.failAfter ?? (import.meta.env.DEV && typeof window !== 'undefined' ? window.__boltAiFailAfter : undefined);
  const before = snapshot(editor, ops);
  const um = editor.UndoManager;
  um.stop();
  try {
    runAll(editor, ops, choices, failAfter);
  } catch (e) {
    restore(editor, before);
    reselect(editor, before.selectedId);
    um.start();
    throw e;
  }
  restore(editor, before);
  um.start();
  runAll(editor, ops, choices);
  reselect(editor, before.selectedId);
}

/** A reposição recria componentes: volta a selecionar o mesmo elemento (pelo id), se existir na página. */
function reselect(editor: Editor, id: string | null): void {
  if (!id) return;
  const hit = findInProject(editor, id);
  if (hit && hit.page === editor.Pages.getSelected() && editor.getSelected() !== hit.component) {
    const um = editor.UndoManager;
    um.stop();
    try {
      editor.select(hit.component);
    } finally {
      um.start();
    }
  }
}

/** Capacidades para mostrar no painel (elemento selecionado). */
export function capsLabel(caps: AiCapabilities): string[] {
  return [caps.text ? 'texto' : '', caps.link ? 'ligação' : '', caps.tag ? 'nível' : '', caps.image ? 'imagem' : '', caps.container ? 'conteúdo e fundo' : ''].filter(Boolean);
}

export type { AiProposal, DeviceId };
