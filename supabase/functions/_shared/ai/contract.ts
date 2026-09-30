import { z } from 'zod';
import { IMAGE_ASPECTS } from './images.ts';

/**
 * Contrato do Assistente IA, partilhado pelo editor (browser) e pelas funções `ai-propose`
 * (servidor). O assistente nunca devolve HTML nem texto livre para aplicar: devolve uma lista de
 * OPERAÇÕES sobre o modelo do editor, num esquema fixo, validada aqui (forma e âmbito) e depois no
 * editor (contra o documento atual).
 *
 * Versão 2: âmbito escolhido explicitamente (elemento, secção, página, site inteiro); operações de
 * texto, ligação, nível, estilos próprios, imagens e fundos (escolher, carregar ou gerar) e
 * estrutura (inserir blocos, mover, duplicar, eliminar). O modelo pode pedir esclarecimento em vez
 * de adivinhar, e propor mudar de âmbito quando o pedido o exige.
 * Sem dependências do browser nem do Deno (importável pelos dois lados).
 */
export const AI_CONTRACT_VERSION = 2 as const;

export const AI_DEVICES = ['desktop', 'tablet', 'mobile'] as const;
export type AiDevice = (typeof AI_DEVICES)[number];

export const AI_TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;
export type AiTextTag = (typeof AI_TEXT_TAGS)[number];

export const AI_SCOPE_KINDS = ['element', 'section', 'page', 'site'] as const;
export type AiScopeKind = (typeof AI_SCOPE_KINDS)[number];

/** Blocos que o assistente pode inserir (os mesmos do painel «Adicionar»). */
export const AI_BLOCKS = ['section', 'columns', 'heading', 'text', 'button', 'image'] as const;
export type AiBlock = (typeof AI_BLOCKS)[number];

export const AI_POSITIONS = ['before', 'after', 'inside'] as const;

/**
 * Propriedades de estilo que o assistente pode alterar (subconjunto explícito das editáveis no
 * inspetor; um teste garante que nenhuma fica fora dessa lista). A imagem de fundo tem operação
 * própria (setBackgroundImage), nunca um valor CSS livre.
 */
export const AI_STYLE_PROPS = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'max-width',
  'opacity',
  'background-size',
  'background-position',
] as const;
export type AiStyleProp = (typeof AI_STYLE_PROPS)[number];

/** Limites rígidos do contrato (os limites configuráveis do servidor ficam abaixo destes). */
export const HARD_LIMITS = {
  instructionChars: 1000,
  textChars: 2000,
  hrefChars: 2000,
  styleValueChars: 200,
  operations: 200,
  variables: 60,
  pages: 40,
  nodesPerPage: 1500,
  nodeTextChars: 300,
} as const;

const Id = z.string().min(1).max(120);
/** Identificador proposto para um elemento NOVO (inserido nesta proposta): referível pelas operações seguintes. */
export const NEW_ID = /^ai-[a-z0-9-]{1,40}$/;

export const AiScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('element'), id: Id, pageId: Id }).strict(),
  z.object({ kind: z.literal('section'), id: Id, pageId: Id }).strict(),
  z.object({ kind: z.literal('page'), pageId: Id }).strict(),
  z.object({ kind: z.literal('site') }).strict(),
]);
export type AiScope = z.infer<typeof AiScope>;

/** Origem de uma imagem numa proposta: o utilizador escolhe/carrega, ou uma geração (com custo, confirmada). */
export const AiImageSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choose'), hint: z.string().max(200).optional() }).strict(),
  z.object({ kind: z.literal('generate'), prompt: z.string().trim().min(3).max(1000), aspect: z.enum(IMAGE_ASPECTS) }).strict(),
]);
export type AiImageSource = z.infer<typeof AiImageSource>;

export const SetTextOp = z.object({ op: z.literal('setText'), id: Id, text: z.string().max(HARD_LIMITS.textChars) }).strict();
export const SetLinkOp = z
  .object({ op: z.literal('setLink'), id: Id, href: z.string().max(HARD_LIMITS.hrefChars).optional(), newTab: z.boolean().optional() })
  .strict();
export const SetTextTagOp = z.object({ op: z.literal('setTextTag'), id: Id, tag: z.enum(AI_TEXT_TAGS) }).strict();
export const SetOwnStyleOp = z
  .object({
    op: z.literal('setOwnStyle'),
    id: Id,
    device: z.enum(AI_DEVICES),
    style: z.partialRecord(z.enum(AI_STYLE_PROPS), z.string().max(HARD_LIMITS.styleValueChars)),
  })
  .strict();
export const ReplaceImageOp = z.object({ op: z.literal('replaceImage'), id: Id, alt: z.string().max(300).optional(), image: AiImageSource }).strict();
export const SetBackgroundImageOp = z.object({ op: z.literal('setBackgroundImage'), id: Id, device: z.enum(AI_DEVICES), image: AiImageSource }).strict();
export const InsertBlockOp = z
  .object({
    op: z.literal('insertBlock'),
    block: z.enum(AI_BLOCKS),
    anchor: Id,
    position: z.enum(AI_POSITIONS),
    newId: z.string().regex(NEW_ID),
    text: z.string().max(HARD_LIMITS.textChars).optional(),
    href: z.string().max(HARD_LIMITS.hrefChars).optional(),
    image: AiImageSource.optional(),
  })
  .strict();
/** Elemento de uma secção nova (`insertSection`), com conteúdo concreto e referência própria. */
export const AiSectionItem = z
  .object({
    block: z.enum(['heading', 'text', 'button', 'image']),
    newId: z.string().regex(NEW_ID),
    text: z.string().trim().min(1).max(HARD_LIMITS.textChars).optional(),
    tag: z.enum(AI_TEXT_TAGS).optional(),
    href: z.string().max(HARD_LIMITS.hrefChars).optional(),
    alt: z.string().max(300).optional(),
    image: AiImageSource.optional(),
  })
  .strict();
export type AiSectionItem = z.infer<typeof AiSectionItem>;

/**
 * Secção nova COMPLETA numa só operação: a secção e os seus elementos, pela ordem, com o conteúdo
 * pedido (sem textos genéricos do bloco). Cada elemento tem um `newId` que as operações seguintes
 * podem usar (ex.: estilos).
 */
export const InsertSectionOp = z
  .object({
    op: z.literal('insertSection'),
    anchor: Id,
    position: z.enum(AI_POSITIONS),
    newId: z.string().regex(NEW_ID),
    items: z.array(AiSectionItem).min(1).max(12),
  })
  .strict();
export const MoveOp = z.object({ op: z.literal('move'), id: Id, anchor: Id, position: z.enum(AI_POSITIONS) }).strict();
export const DuplicateOp = z.object({ op: z.literal('duplicate'), id: Id }).strict();
export const RemoveOp = z.object({ op: z.literal('remove'), id: Id }).strict();

export const AiOperation = z.discriminatedUnion('op', [SetTextOp, SetLinkOp, SetTextTagOp, SetOwnStyleOp, ReplaceImageOp, SetBackgroundImageOp, InsertBlockOp, InsertSectionOp, MoveOp, DuplicateOp, RemoveOp]);
export type AiOperation = z.infer<typeof AiOperation>;

/** Opção de um esclarecimento: pode propor outro âmbito (o utilizador escolhe; nada muda sozinho). */
export const AiClarifyOption = z
  .object({
    label: z.string().min(1).max(200),
    scope: z.object({ kind: z.enum(AI_SCOPE_KINDS), id: Id.optional() }).strict().optional(),
  })
  .strict();

/** O que o modelo devolve (entrada da ferramenta «propor_operacoes»). */
export const AiProposal = z
  .object({
    summary: z.string().max(1000),
    operations: z.array(AiOperation).max(HARD_LIMITS.operations),
    /** Pergunta em vez de adivinhar (ambiguidade, ou pedido fora do âmbito); sem operações. */
    clarification: z.object({ question: z.string().min(1).max(500), options: z.array(AiClarifyOption).max(4) }).strict().optional(),
  })
  .strict();
export type AiProposal = z.infer<typeof AiProposal>;

export const AiStyleInfo = z
  .object({
    /** Valor efetivo (declarado) neste dispositivo. */
    value: z.string().max(300),
    /** own: próprio neste dispositivo; device: próprio noutro dispositivo mais largo; rule: regra do site; computed: herdado/calculado. */
    source: z.enum(['own', 'device', 'rule', 'computed']),
    /** De onde vem (ex.: «Computador», «.nb-title», «Calculado»). */
    from: z.string().max(200),
    /** Variável global a que o valor está ligado (ex.: `--bolt-heading`), se houver. */
    variable: z.string().max(80).optional(),
    variableLabel: z.string().max(80).optional(),
  })
  .strict();

export const AiVariable = z
  .object({ name: z.string().max(80), label: z.string().max(80), value: z.string().max(300), kind: z.enum(['color', 'font', 'other']) })
  .strict();
export type AiVariable = z.infer<typeof AiVariable>;

export const AiCapabilities = z.object({ text: z.boolean(), link: z.boolean(), tag: z.boolean(), image: z.boolean(), container: z.boolean() }).strict();
export type AiCapabilities = z.infer<typeof AiCapabilities>;

/** Detalhe do elemento principal do âmbito (elemento ou secção). */
export const AiElementContext = z
  .object({
    id: Id,
    /** Nome amigável do tipo (ex.: «Título», «Botão»). */
    kind: z.string().max(60),
    tagName: z.string().max(20),
    capabilities: AiCapabilities,
    content: z
      .object({
        text: z.string().max(4000).optional(),
        /** O texto tem formatação (negrito, ligações internas…) que um setText substituiria. */
        richText: z.boolean().optional(),
        href: z.string().max(HARD_LIMITS.hrefChars).optional(),
        newTab: z.boolean().optional(),
        tag: z.enum(AI_TEXT_TAGS).optional(),
        /** Descrição (texto alternativo) da imagem, se for uma imagem. */
        imageAlt: z.string().max(300).optional(),
      })
      .strict(),
    styles: z.partialRecord(z.enum(AI_STYLE_PROPS), AiStyleInfo),
  })
  .strict();
export type AiElementContext = z.infer<typeof AiElementContext>;

/**
 * Nó da árvore enviada ao modelo (forma reduzida). `inScope`: pode ser alterado nesta proposta.
 * Nós fora do âmbito (ex.: antepassados do elemento) só servem para perceber o contexto e
 * detetar ambiguidades (ex.: a imagem de fundo pertence à secção, não ao elemento).
 */
export const AiNode = z
  .object({
    id: Id,
    parent: Id.nullable(),
    kind: z.string().max(60),
    tag: z.string().max(20),
    inScope: z.boolean(),
    caps: AiCapabilities,
    text: z.string().max(HARD_LIMITS.nodeTextChars).optional(),
    href: z.string().max(300).optional(),
    imageAlt: z.string().max(300).optional(),
    /** Nome do ficheiro da imagem, quando é descritivo (ex.: «estacionamento.jpg»); nunca o endereço. */
    imageFile: z.string().max(120).optional(),
    /** Tem imagem de fundo própria (neste dispositivo ou herdada de um mais largo). */
    backgroundImage: z.boolean().optional(),
    /** Nome do ficheiro da imagem de fundo, quando é descritivo. */
    backgroundFile: z.string().max(120).optional(),
    /** Estilos próprios no dispositivo do pedido. */
    own: z.partialRecord(z.enum(AI_STYLE_PROPS), z.string().max(200)).optional(),
  })
  .strict();
export type AiNode = z.infer<typeof AiNode>;

export const AiPageContext = z
  .object({
    id: Id,
    name: z.string().max(120),
    slug: z.string().max(80),
    current: z.boolean(),
    nodes: z.array(AiNode).max(HARD_LIMITS.nodesPerPage),
  })
  .strict();
export type AiPageContext = z.infer<typeof AiPageContext>;

/** Contexto enviado ao modelo. Textos e atributos são DADOS do projeto, nunca instruções. */
export const AiContext = z
  .object({
    target: AiElementContext.optional(),
    pages: z.array(AiPageContext).min(1).max(HARD_LIMITS.pages),
    variables: z.array(AiVariable).max(HARD_LIMITS.variables),
    /** Pedido grande dividido em partes: esta é a parte `index` de `total` (a proposta é consolidada no editor). */
    part: z.object({ index: z.number().int().min(1), total: z.number().int().min(1), label: z.string().max(200) }).strict().optional(),
  })
  .strict();
export type AiContext = z.infer<typeof AiContext>;

export const AiProposeRequest = z
  .object({
    contract: z.literal(AI_CONTRACT_VERSION),
    projectId: z.string().min(1).max(80),
    /** Versão LOCAL do documento no momento do pedido (inclui alterações por gravar). */
    documentVersion: z.string().min(1).max(80),
    /** Identificador único do pedido (gerado no editor a cada «Propor»): um reenvio é recusado. */
    requestId: z.uuid(),
    scope: AiScope,
    device: z.enum(AI_DEVICES),
    instruction: z.string().trim().min(1).max(HARD_LIMITS.instructionChars),
    /** O editor tem geração de imagens disponível (o servidor volta a confirmar). */
    imageGeneration: z.boolean(),
    context: AiContext,
  })
  .strict();
export type AiProposeRequest = z.infer<typeof AiProposeRequest>;

export const AiUsage = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    attempts: z.number().int().positive(),
    latencyMs: z.number().int().nonnegative(),
    /** Parte do custo é o máximo reservado, porque o consumo de alguma tentativa ficou desconhecido. */
    estimated: z.boolean(),
  })
  .strict();
export type AiUsage = z.infer<typeof AiUsage>;

export const AiProposeResponse = z
  .object({
    contract: z.literal(AI_CONTRACT_VERSION),
    documentVersion: z.string().min(1).max(80),
    proposal: AiProposal,
    model: z.string().max(80),
    /** Resposta de um simulador (sem IA): identificada como tal na interface e nos testes. */
    simulated: z.boolean(),
    usage: AiUsage.optional(),
  })
  .strict();
export type AiProposeResponse = z.infer<typeof AiProposeResponse>;

/** Destinos aceites: âncora, caminho interno, http(s), mailto e tel. Tudo o resto é recusado. */
export function isSafeHref(href: string): boolean {
  const v = [...href].filter((ch) => ch.charCodeAt(0) > 32).join('');
  if (v === '') return true;
  if (v.startsWith('#')) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d][\d\s().-]*)$/i.test(v);
}

/** Valor de estilo sem capacidade de sair da declaração nem carregar recursos. */
export function isSafeStyleValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return true;
  if (/[;{}<>\\@]/.test(v)) return false;
  if (/url\s*\(|expression\s*\(|javascript:|!important/.test(v)) return false;
  return true;
}

/** Operações que referem um elemento existente (id) e, nas estruturais, uma âncora. */
export function opTargets(op: AiOperation): { id?: string; anchor?: string } {
  switch (op.op) {
    case 'insertBlock':
    case 'insertSection':
      return { anchor: op.anchor };
    case 'move':
      return { id: op.id, anchor: op.anchor };
    default:
      return { id: op.id };
  }
}

/**
 * Imagens de uma operação, cada uma com a sua chave: «N» (a operação N) ou «N.i» (o elemento i de
 * uma secção nova). O editor pede uma imagem por chave antes de aplicar.
 */
export function imageSourcesOf(op: AiOperation, index: number): Array<{ key: string; source: AiImageSource }> {
  if (op.op === 'replaceImage' || op.op === 'setBackgroundImage') return [{ key: String(index), source: op.image }];
  if (op.op === 'insertBlock' && op.block === 'image' && op.image) return [{ key: String(index), source: op.image }];
  if (op.op === 'insertSection') return op.items.flatMap((it, i) => (it.image ? [{ key: `${index}.${i}`, source: it.image }] : []));
  return [];
}

/** Raiz do âmbito (elemento ou secção); null para página e site. */
export const scopeRoot = (s: AiScope): string | null => (s.kind === 'element' || s.kind === 'section' ? s.id : null);

/** Capacidades de um bloco novo (inserido na proposta). */
export const BLOCK_CAPS: Record<AiBlock, AiCapabilities> = {
  section: { text: false, link: false, tag: false, image: false, container: true },
  columns: { text: false, link: false, tag: false, image: false, container: true },
  heading: { text: true, link: false, tag: true, image: false, container: false },
  text: { text: true, link: false, tag: true, image: false, container: false },
  button: { text: true, link: true, tag: false, image: false, container: false },
  image: { text: false, link: false, tag: false, image: true, container: false },
};

/**
 * Validação de FORMA e ÂMBITO de uma proposta face ao pedido (servidor e editor): só elementos do
 * âmbito (ou criados pela própria proposta), capacidades declaradas, dispositivo, propriedades,
 * valores, destinos, variáveis conhecidas e geração de imagens só se disponível.
 * Devolve a lista de problemas (vazia = válida). A validação contra o documento real é feita
 * depois, no editor.
 */
export function checkProposalShape(req: AiProposeRequest, proposal: AiProposal, maxOperations: number = HARD_LIMITS.operations): string[] {
  const errors: string[] = [];
  if (proposal.clarification && proposal.operations.length) errors.push('Um pedido de esclarecimento não pode trazer operações.');
  if (proposal.operations.length > maxOperations) errors.push(`Demasiadas operações (${proposal.operations.length}; máximo ${maxOperations}).`);
  const known = new Set(req.context.variables.map((v) => v.name));
  const caps = new Map<string, AiCapabilities>();
  for (const p of req.context.pages) for (const n of p.nodes) if (n.inScope) caps.set(n.id, n.caps);
  const root = scopeRoot(req.scope);
  if (req.context.target && root && req.context.target.id === root) caps.set(root, req.context.target.capabilities);
  const created = new Set<string>();
  const removed = new Set<string>();

  proposal.operations.forEach((op, i) => {
    const n = `Operação ${i + 1} (${op.op})`;
    const { id, anchor } = opTargets(op);
    const reach = (x: string) => caps.has(x) && !removed.has(x);
    if (id !== undefined && !reach(id)) {
      errors.push(`${n}: refere um elemento fora do âmbito.`);
      return;
    }
    if (anchor !== undefined && !reach(anchor)) {
      errors.push(`${n}: a posição fica fora do âmbito.`);
      return;
    }
    const c = id !== undefined ? caps.get(id) : undefined;
    if (imageSourcesOf(op, i).some((s) => s.source.kind === 'generate') && !req.imageGeneration) errors.push(`${n}: a geração de imagens não está disponível.`);
    switch (op.op) {
      case 'setText':
        if (!c?.text) errors.push(`${n}: este elemento não tem texto editável.`);
        break;
      case 'setLink':
        if (!c?.link) errors.push(`${n}: este elemento não é uma ligação.`);
        if (op.href === undefined && op.newTab === undefined) errors.push(`${n}: não altera nada.`);
        if (op.href !== undefined && !isSafeHref(op.href)) errors.push(`${n}: destino não permitido.`);
        break;
      case 'setTextTag':
        if (!c?.tag) errors.push(`${n}: o nível só se altera em títulos e parágrafos.`);
        break;
      case 'setOwnStyle': {
        if (op.device !== req.device) errors.push(`${n}: dispositivo diferente do escolhido.`);
        const entries = Object.entries(op.style);
        if (entries.length === 0) errors.push(`${n}: sem propriedades.`);
        for (const [prop, value] of entries) {
          if (typeof value !== 'string' || !isSafeStyleValue(value)) {
            errors.push(`${n}: valor não permitido em ${prop}.`);
            continue;
          }
          for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
            if (m[1] && !known.has(m[1])) errors.push(`${n}: variável desconhecida ${m[1]}.`);
          }
        }
        break;
      }
      case 'replaceImage':
        if (!c?.image) errors.push(`${n}: este elemento não é uma imagem (use setBackgroundImage para fundos).`);
        break;
      case 'setBackgroundImage':
        if (op.device !== req.device) errors.push(`${n}: dispositivo diferente do escolhido.`);
        if (c?.image || c?.text) errors.push(`${n}: fundos só em secções e contentores.`);
        break;
      case 'insertBlock': {
        const a = caps.get(op.anchor);
        if (op.position === 'inside' && !a?.container) errors.push(`${n}: só se insere dentro de secções e contentores.`);
        if (op.position !== 'inside' && op.anchor === root) errors.push(`${n}: inserir fora do elemento do âmbito exige um âmbito maior.`);
        if (caps.has(op.newId) || created.has(op.newId)) errors.push(`${n}: identificador novo repetido.`);
        if (op.block === 'image' && !op.image) errors.push(`${n}: uma imagem nova precisa de origem (escolher ou gerar).`);
        if (op.block !== 'image' && op.image) errors.push(`${n}: só o bloco de imagem leva imagem.`);
        if (op.text !== undefined && !BLOCK_CAPS[op.block].text) errors.push(`${n}: este bloco não tem texto próprio.`);
        if (op.href !== undefined && (op.block !== 'button' || !isSafeHref(op.href))) errors.push(`${n}: destino não permitido.`);
        caps.set(op.newId, BLOCK_CAPS[op.block]);
        created.add(op.newId);
        break;
      }
      case 'insertSection': {
        const a = caps.get(op.anchor);
        if (op.position === 'inside' && !a?.container) errors.push(`${n}: só se insere dentro de secções e contentores.`);
        if (op.position !== 'inside' && op.anchor === root) errors.push(`${n}: inserir fora do elemento do âmbito exige um âmbito maior.`);
        const ids = [op.newId, ...op.items.map((it) => it.newId)];
        if (new Set(ids).size !== ids.length || ids.some((x) => caps.has(x) || created.has(x))) errors.push(`${n}: identificador novo repetido.`);
        op.items.forEach((it, k) => {
          const m = `${n}, elemento ${k + 1} (${it.block})`;
          if (it.block !== 'image' && !it.text) errors.push(`${m}: falta o texto pedido.`);
          if (it.block === 'image' && !it.image) errors.push(`${m}: uma imagem precisa de origem (escolher ou gerar).`);
          if (it.block !== 'image' && (it.image || it.alt !== undefined)) errors.push(`${m}: só a imagem leva imagem e texto alternativo.`);
          if (it.href !== undefined && (it.block !== 'button' || !isSafeHref(it.href))) errors.push(`${m}: destino não permitido.`);
          if (it.tag !== undefined && it.block !== 'heading' && it.block !== 'text') errors.push(`${m}: o nível só se aplica a títulos e textos.`);
          caps.set(it.newId, BLOCK_CAPS[it.block]);
          created.add(it.newId);
        });
        caps.set(op.newId, BLOCK_CAPS.section);
        created.add(op.newId);
        break;
      }
      case 'move':
        if (op.id === root) errors.push(`${n}: mover o próprio elemento do âmbito exige um âmbito maior.`);
        if (op.position === 'inside' && !caps.get(op.anchor)?.container) errors.push(`${n}: só se move para dentro de secções e contentores.`);
        if (op.position !== 'inside' && op.anchor === root) errors.push(`${n}: mover para fora do âmbito exige um âmbito maior.`);
        if (op.id === op.anchor) errors.push(`${n}: destino inválido.`);
        break;
      case 'duplicate':
        break;
      case 'remove':
        removed.add(op.id);
        break;
    }
  });
  return errors;
}
