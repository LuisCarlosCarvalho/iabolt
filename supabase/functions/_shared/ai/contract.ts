import { z } from 'zod';

/**
 * Contrato do Assistente IA, partilhado pelo editor (browser) e pela função `ai-propose`
 * (servidor). O assistente nunca devolve HTML nem texto livre para aplicar: devolve uma lista de
 * OPERAÇÕES sobre o modelo do editor, num esquema fixo, validada aqui (forma) e depois no editor
 * (contra o documento atual).
 *
 * Versão 1: âmbito = elemento selecionado; operações setText, setLink, setTextTag, setOwnStyle.
 * Sem dependências do browser nem do Deno (importável pelos dois lados).
 */
export const AI_CONTRACT_VERSION = 1 as const;

export const AI_DEVICES = ['desktop', 'tablet', 'mobile'] as const;
export type AiDevice = (typeof AI_DEVICES)[number];

export const AI_TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;
export type AiTextTag = (typeof AI_TEXT_TAGS)[number];

/**
 * Propriedades de estilo que o assistente pode alterar (subconjunto explícito das editáveis no
 * inspetor; um teste garante que nenhuma fica fora dessa lista).
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
] as const;
export type AiStyleProp = (typeof AI_STYLE_PROPS)[number];

/** Limites rígidos do contrato (os limites configuráveis do servidor ficam abaixo destes). */
export const HARD_LIMITS = {
  instructionChars: 1000,
  textChars: 2000,
  hrefChars: 2000,
  styleValueChars: 200,
  operations: 20,
  variables: 60,
} as const;

const Id = z.string().min(1).max(120);

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

export const AiOperation = z.discriminatedUnion('op', [SetTextOp, SetLinkOp, SetTextTagOp, SetOwnStyleOp]);
export type AiOperation = z.infer<typeof AiOperation>;

/** O que o modelo devolve (entrada da ferramenta «propor_operacoes»). */
export const AiProposal = z
  .object({
    summary: z.string().max(500),
    operations: z.array(AiOperation).max(HARD_LIMITS.operations),
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

/** Contexto do elemento enviado ao modelo. Texto e atributos são DADOS do projeto, nunca instruções. */
export const AiElementContext = z
  .object({
    id: Id,
    /** Nome amigável do tipo (ex.: «Título», «Botão»). */
    kind: z.string().max(60),
    tagName: z.string().max(20),
    capabilities: z.object({ text: z.boolean(), link: z.boolean(), tag: z.boolean() }).strict(),
    content: z
      .object({
        text: z.string().max(4000).optional(),
        /** O texto tem formatação (negrito, ligações internas…) que um setText substituiria. */
        richText: z.boolean().optional(),
        href: z.string().max(HARD_LIMITS.hrefChars).optional(),
        newTab: z.boolean().optional(),
        tag: z.enum(AI_TEXT_TAGS).optional(),
      })
      .strict(),
    styles: z.partialRecord(z.enum(AI_STYLE_PROPS), AiStyleInfo),
    variables: z.array(AiVariable).max(HARD_LIMITS.variables),
    page: z.object({ name: z.string().max(120) }).strict(),
  })
  .strict();
export type AiElementContext = z.infer<typeof AiElementContext>;

export const AiProposeRequest = z
  .object({
    contract: z.literal(AI_CONTRACT_VERSION),
    projectId: z.string().min(1).max(80),
    /** Versão LOCAL do documento no momento do pedido (inclui alterações por gravar). */
    documentVersion: z.string().min(1).max(80),
    /** Identificador único do pedido (gerado no editor a cada «Propor»): um reenvio é recusado. */
    requestId: z.uuid(),
    scope: z.object({ kind: z.literal('element'), id: Id }).strict(),
    device: z.enum(AI_DEVICES),
    instruction: z.string().trim().min(1).max(HARD_LIMITS.instructionChars),
    context: AiElementContext,
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

/**
 * Validação de FORMA de uma proposta face ao pedido (servidor e editor): âmbito, capacidades
 * declaradas, dispositivo, propriedades, valores, destinos e variáveis conhecidas.
 * Devolve a lista de problemas (vazia = válida). A validação contra o documento real é feita
 * depois, no editor.
 */
export function checkProposalShape(req: AiProposeRequest, proposal: AiProposal, maxOperations: number = HARD_LIMITS.operations): string[] {
  const errors: string[] = [];
  if (proposal.operations.length > maxOperations) errors.push(`Demasiadas operações (${proposal.operations.length}; máximo ${maxOperations}).`);
  const known = new Set(req.context.variables.map((v) => v.name));
  proposal.operations.forEach((op, i) => {
    const n = `Operação ${i + 1} (${op.op})`;
    if (op.id !== req.scope.id) {
      errors.push(`${n}: refere um elemento fora do âmbito.`);
      return;
    }
    switch (op.op) {
      case 'setText':
        if (!req.context.capabilities.text) errors.push(`${n}: este elemento não tem texto editável.`);
        break;
      case 'setLink':
        if (!req.context.capabilities.link) errors.push(`${n}: este elemento não é uma ligação.`);
        if (op.href === undefined && op.newTab === undefined) errors.push(`${n}: não altera nada.`);
        if (op.href !== undefined && !isSafeHref(op.href)) errors.push(`${n}: destino não permitido.`);
        break;
      case 'setTextTag':
        if (!req.context.capabilities.tag) errors.push(`${n}: o nível só se altera em títulos e parágrafos.`);
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
    }
  });
  return errors;
}
