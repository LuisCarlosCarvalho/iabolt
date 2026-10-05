import type { CssRule, DataRecord, Editor } from 'grapesjs';

/**
 * Estilos globais do site: variáveis de cor e de fonte, e regras globais de elementos (corpo,
 * títulos, parágrafos, ligações, botões). Só se editam valores que já têm uma associação global
 * identificável no documento:
 *
 *  - uma variável CSS (`--nome`) declarada em `:root`, `html` ou `body`, sem media query;
 *  - uma propriedade de uma regra global de elemento (lista fechada de seletores, abaixo);
 *  - quando essa propriedade está ligada a um registo de uma fonte de dados (variáveis de tema do
 *    GrapesJS Studio), edita-se o REGISTO: a ligação, o nome e o âmbito ficam como estão.
 *
 * Nada aqui procura cores iguais nem converte valores fixos em variáveis. As regras com media
 * query (tablet, telemóvel) e as regras próprias dos elementos (`#id`) nunca são tocadas.
 * Ler (`readGlobalStyles`) não escreve no documento.
 */
export type GlobalGroup = 'colors' | 'typography' | 'elements';
export type SlotKind = 'color' | 'font' | 'other';

export interface GlobalSlot {
  /** Identificador estável: `rule|<seletor>|<propriedade>`. */
  key: string;
  group: GlobalGroup;
  /** Secção dentro de «Elementos» (ex.: «Títulos»); vazio nos outros grupos. */
  section: string;
  /** Nome amigável (o que o campo mostra em primeiro lugar). */
  label: string;
  /** Informação secundária: variável ou propriedade, seletor e nome original do ficheiro. */
  technical: string;
  /** Nome técnico (variável ou propriedade). */
  name: string;
  /** Onde está declarado (seletor), para mostrar o âmbito. */
  scope: string;
  kind: SlotKind;
  prop: string;
  /** Valor atual tal como está declarado (pode ser `var(--x)`); vazio se não tiver valor. */
  value: string;
  /** Valor usado quando o campo não tem valor (predefinição do registo ligado). */
  fallback: string;
  /** Registo de dados a que a propriedade está ligada (Studio), se houver. */
  record: { source: string; id: string } | null;
}

export interface GlobalStyles {
  slots: GlobalSlot[];
  /** Valores das variáveis (nome → valor declarado), para resolver `var(--x)` ao mostrar. */
  variables: Map<string, string>;
  /** Famílias declaradas por @font-face no projeto (fontes já carregadas pelo documento). */
  projectFonts: string[];
  /** Há pelo menos uma variável de cor ou de fonte. */
  hasVariables: boolean;
}

const VARIABLE_SCOPES = [':root', 'html', 'body'];

/** Regras globais de elementos → secção de «Elementos». Lista fechada, por ordem de apresentação. */
const ELEMENT_SECTIONS: ReadonlyArray<[RegExp, string]> = [
  [/^(body|html|\.gjs-t-body)$/, 'Corpo da página'],
  [/^(h[1-6])(\s*,\s*h[1-6])*$/, 'Títulos'],
  [/^\.gjs-t-h([1-6])$/, 'Título H$1'],
  [/^p$/, 'Parágrafos'],
  [/^(a|\.gjs-t-link)$/, 'Ligações'],
  [/^(button|\.bolt-btn|\.gjs-t-button)$/, 'Botões'],
  [/^\.gjs-t-border$/, 'Bordas'],
];

const ELEMENT_PROPS: ReadonlyArray<[string, string]> = [
  ['font-family', 'Fonte'],
  ['color', 'Cor do texto'],
  ['background-color', 'Cor de fundo'],
  ['font-size', 'Tamanho da letra'],
  ['font-weight', 'Peso'],
  ['line-height', 'Altura de linha'],
  ['letter-spacing', 'Espaçamento entre letras'],
  ['text-transform', 'Maiúsculas'],
  ['text-decoration', 'Sublinhado'],
  ['border-radius', 'Raio dos cantos'],
  ['border-color', 'Cor da borda'],
];

/**
 * Nomes amigáveis de variáveis conhecidas: as do Bolt IA (templates nativos e configuração criada
 * pelo painel) e as do tema do GrapesJS Studio. Só muda o que se mostra; o nome no documento fica.
 */
const KNOWN_VARIABLES: Record<string, string> = {
  '--gjs-t-color-primary': 'Cor principal',
  '--gjs-t-color-secondary': 'Cor secundária',
  '--gjs-t-color-accent': 'Cor de destaque',
  '--gjs-t-color-success': 'Cor de sucesso',
  '--gjs-t-color-warning': 'Cor de aviso',
  '--gjs-t-color-error': 'Cor de erro',
  '--bolt-primary': 'Cor principal',
  '--bolt-on-primary': 'Texto sobre a cor principal',
  '--bolt-text': 'Texto',
  '--bolt-heading': 'Títulos',
  '--bolt-bg': 'Fundo da página',
  '--bolt-radius': 'Raio dos cantos',
  '--bolt-font-body': 'Fonte do texto',
  '--bolt-font-heading': 'Fonte dos títulos',
};

/** «Fonte usada …» por secção (o resto usa «em <secção>»). */
const FONT_WHERE: Record<string, string> = {
  'Corpo da página': 'no corpo da página',
  Títulos: 'nos títulos',
  Parágrafos: 'nos parágrafos',
  Ligações: 'nas ligações',
  Botões: 'nos botões',
};

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$|currentcolor$|(white|black|red|green|blue|gray|grey|silver|navy|teal|orange|purple|yellow)$)/i;

export function sectionOf(selector: string): string | null {
  for (const [re, label] of ELEMENT_SECTIONS) {
    const m = re.exec(selector.trim());
    if (m) return label.replace('$1', m[1] ?? '');
  }
  return null;
}

/** O seletor é de uma regra global (variáveis ou elementos)? Usado pelo inspetor. */
export function isGlobalSelector(selector: string): boolean {
  return VARIABLE_SCOPES.includes(selector.trim()) || sectionOf(selector) !== null;
}

const isPlainRule = (r: CssRule) => !r.get('mediaText') && !r.get('state') && !r.get('atRuleType');

function globalRules(editor: Editor): CssRule[] {
  return editor.Css.getRules().filter((r) => isPlainRule(r) && isGlobalSelector(r.selectorsToString()));
}

function findRule(editor: Editor, selector: string): CssRule | undefined {
  return editor.Css.getRules().find((r) => isPlainRule(r) && r.selectorsToString() === selector);
}

/** Estilo declarado SEM resolver as ligações a dados (mantém `{type:'data-variable'}`). */
function rawStyle(rule: CssRule): Record<string, unknown> {
  return { ...rule.getStyle({ skipResolve: true }) };
}

function bindingOf(value: unknown): { source: string; id: string } | null {
  if (!value || typeof value !== 'object') return null;
  if (Reflect.get(value, 'type') !== 'data-variable') return null;
  const path = Reflect.get(value, 'path');
  if (typeof path !== 'string') return null;
  const [source, id, field] = path.split('.');
  return source && id && field === 'value' ? { source, id } : null;
}

function recordOf(editor: Editor, ref: { source: string; id: string }): DataRecord | undefined {
  return editor.DataSources.get(ref.source)?.getRecord(ref.id);
}

function recordValue(record: DataRecord | undefined): string {
  const v: unknown = record?.get('value');
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function recordLabel(record: DataRecord | undefined): string | null {
  const l: unknown = record?.get('label');
  return typeof l === 'string' && l ? l : null;
}

function recordType(record: DataRecord | undefined): string | null {
  const field: unknown = record?.get('field');
  const t = field && typeof field === 'object' ? Reflect.get(field, 'type') : null;
  return typeof t === 'string' ? t : null;
}

function humanize(name: string): string {
  const s = name.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

/** Primeira família de uma lista CSS, sem aspas (ex.: `'Inter', sans-serif` → `Inter`). */
export function firstFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
}

/** Famílias com @font-face no projeto (importadas ou escolhidas no Google Fonts). */
export function projectFontFamilies(editor: Editor): string[] {
  const out = new Set<string>();
  for (const r of editor.Css.getRules()) {
    if (r.get('atRuleType') !== 'font-face') continue;
    const fam = r.getStyle()['font-family'];
    if (typeof fam === 'string' && fam.trim()) out.add(firstFamily(fam));
  }
  return [...out];
}

export function readGlobalStyles(editor: Editor): GlobalStyles {
  const slots: GlobalSlot[] = [];
  const variables = new Map<string, string>();
  for (const rule of globalRules(editor)) {
    const selector = rule.selectorsToString();
    const style = rawStyle(rule);
    const section = sectionOf(selector);
    for (const [prop, raw] of Object.entries(style)) {
      const record = bindingOf(raw);
      const rec = record ? recordOf(editor, record) : undefined;
      const value = record ? recordValue(rec) : typeof raw === 'string' ? raw : '';
      if (!record && typeof raw !== 'string') continue;
      const key = `rule|${selector}|${prop}`;
      const def: unknown = rec?.get('defaultValue');
      const fallback = typeof def === 'string' ? def : '';
      if (prop.startsWith('--') && VARIABLE_SCOPES.includes(selector)) {
        variables.set(prop, value || fallback);
        const type = recordType(rec);
        const font = /font/i.test(prop) || type === 'selectFont';
        const color = !font && (type === 'color' || COLOR_RE.test(value.trim()));
        const original = recordLabel(rec);
        const label = KNOWN_VARIABLES[prop] ?? original ?? humanize(prop);
        const technical = [original && original !== label ? `«${original}» no ficheiro` : '', `${prop} em ${selector}`].filter(Boolean).join(' · ');
        slots.push({
          key,
          group: font ? 'typography' : color ? 'colors' : 'elements',
          section: font || color ? '' : 'Outras variáveis',
          label,
          technical,
          name: prop,
          scope: selector,
          kind: font ? 'font' : color ? 'color' : 'other',
          prop,
          value,
          fallback,
          record,
        });
        continue;
      }
      if (!section) continue;
      const known = ELEMENT_PROPS.find(([p]) => p === prop);
      if (!known) continue;
      const isFont = prop === 'font-family';
      slots.push({
        key,
        group: isFont ? 'typography' : 'elements',
        section: isFont ? '' : section,
        label: isFont ? `Fonte usada ${FONT_WHERE[section] ?? `em ${section}`}` : known[1],
        technical: `${prop} em ${selector}`,
        name: prop,
        scope: selector,
        kind: isFont ? 'font' : /color/.test(prop) ? 'color' : 'other',
        prop,
        value,
        fallback,
        record,
      });
    }
  }
  const GROUPS: GlobalGroup[] = ['colors', 'typography', 'elements'];
  const secIdx = (x: GlobalSlot) => {
    const i = ELEMENT_SECTIONS.findIndex(([, l]) => x.section.startsWith(l.replace('$1', '')));
    return i < 0 ? 99 : i;
  };
  const propIdx = (x: GlobalSlot) => ELEMENT_PROPS.findIndex(([p]) => p === x.prop);
  const pos = new Map(slots.map((x, i) => [x, i]));
  slots.sort(
    (a, b) =>
      GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) ||
      (a.group === 'elements' ? secIdx(a) - secIdx(b) || a.section.localeCompare(b.section) || propIdx(a) - propIdx(b) : 0) ||
      (pos.get(a) ?? 0) - (pos.get(b) ?? 0),
  );
  const hasVariables = slots.some((s) => s.name.startsWith('--') && (s.kind === 'color' || s.kind === 'font'));
  return { slots, variables, projectFonts: projectFontFamilies(editor), hasVariables };
}

/** Resolve `var(--x[, fallback])` com as variáveis globais (até 5 níveis), só para mostrar. */
export function resolveValue(value: string, variables: ReadonlyMap<string, string>, depth = 0): string {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m?.[1] || depth > 5) return value;
  const v = variables.get(m[1]) ?? m[2] ?? '';
  return resolveValue(v, variables, depth + 1);
}

/** Variável referida por um valor `var(--x)`, se for só isso. */
export function variableOf(value: string): string | null {
  return /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim())?.[1] ?? null;
}

function parseKey(key: string): { selector: string; prop: string } | null {
  const [kind, selector, prop] = key.split('|');
  return kind === 'rule' && selector && prop ? { selector, prop } : null;
}

/** Valor atual de um campo (registo ligado ou regra). */
export function slotValue(editor: Editor, key: string): string | undefined {
  const k = parseKey(key);
  const rule = k ? findRule(editor, k.selector) : undefined;
  if (!k || !rule) return undefined;
  const raw = rawStyle(rule)[k.prop];
  const record = bindingOf(raw);
  if (record) return recordValue(recordOf(editor, record));
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Escreve o valor de um campo global. Se a propriedade estiver ligada a um registo, muda o registo
 * (a ligação mantém-se); senão muda só essa propriedade da regra, preservando as restantes e as
 * suas ligações (`addStyle` estende o estilo sem o resolver). Valor vazio remove a propriedade da
 * regra (nunca apaga a regra). Devolve false se nada mudou.
 */
export function writeSlot(editor: Editor, key: string, value: string | undefined): boolean {
  const k = parseKey(key);
  const rule = k ? findRule(editor, k.selector) : undefined;
  if (!k || !rule) return false;
  const raw = rawStyle(rule)[k.prop];
  const binding = bindingOf(raw);
  if (binding) {
    const rec = recordOf(editor, binding);
    if (!rec || rec.get('value') === value) return false;
    rec.set('value', value);
    editor.trigger(GLOBAL_EVENT);
    return true;
  }
  const next = value ?? '';
  if ((typeof raw === 'string' ? raw : '') === next) return false;
  rule.addStyle({ [k.prop]: next });
  editor.trigger(GLOBAL_EVENT);
  return true;
}

/** Evento emitido a cada alteração de estilos globais (inclui desfazer/refazer de registos). */
export const GLOBAL_EVENT = 'bolt:global-styles';

const baselines = new WeakMap<Editor, Map<string, string | undefined>>();

/**
 * Chamado quando o documento acaba de abrir: regista no histórico os registos de dados (as
 * variáveis do Studio não entram no histórico por omissão) e guarda em memória os valores de
 * partida, para «Repor». Não altera o documento.
 */
export function trackGlobalStyles(editor: Editor): void {
  const um = editor.UndoManager;
  for (const ds of editor.DataSources.getAll()) {
    for (const rec of ds.getRecords()) {
      um.add(rec);
      rec.on('change:value', () => editor.trigger(GLOBAL_EVENT));
    }
  }
  baselines.set(editor, new Map(readGlobalStyles(editor).slots.map((s) => [s.key, slotValue(editor, s.key)])));
}

/** Valor de partida (ao abrir o projeto nesta sessão). `null` = campo criado depois. */
export function baselineOf(editor: Editor, key: string): string | undefined | null {
  const b = baselines.get(editor);
  return b && b.has(key) ? b.get(key) : null;
}

/** Repõe um campo no valor de partida. Nunca apaga regras. */
export function resetSlot(editor: Editor, key: string): boolean {
  const base = baselineOf(editor, key);
  if (base === null) return false;
  return writeSlot(editor, key, base);
}

/** Repõe todos os campos alterados num só passo de histórico (mesma volta do ciclo). */
export function resetAll(editor: Editor): number {
  let n = 0;
  for (const s of readGlobalStyles(editor).slots) if (resetSlot(editor, s.key)) n += 1;
  return n;
}

export function isChanged(editor: Editor, key: string): boolean {
  const base = baselineOf(editor, key);
  return base !== null && (base ?? '') !== (slotValue(editor, key) ?? '');
}

/**
 * Interação contínua (seletor de cor): pré-visualiza sem histórico e grava um único passo no fim.
 */
export function continuousSlotEdit(editor: Editor, key: string) {
  const initial = slotValue(editor, key);
  const um = editor.UndoManager;
  const untracked = (v: string | undefined) => {
    um.stop();
    try {
      writeSlot(editor, key, v);
    } finally {
      um.start();
    }
  };
  let last: string | null = null;
  return {
    preview(value: string) {
      last = value;
      untracked(value);
    },
    commit(value: string | undefined = last ?? initial) {
      untracked(initial);
      if (value !== initial) writeSlot(editor, key, value);
      last = null;
    },
    cancel() {
      untracked(initial);
      last = null;
    },
  };
}

/** Elementos com cor ou fonte próprias (`#id`), que os estilos globais não alteram. */
export function ownOverrides(editor: Editor, props: readonly string[] = ['color', 'font-family']): number {
  let n = 0;
  for (const r of editor.Css.getRules()) {
    if (!/^#[\w-]+$/.test(r.selectorsToString())) continue;
    const st = r.getStyle();
    if (props.some((p) => typeof st[p] === 'string' && st[p] !== '')) n += 1;
  }
  return n;
}

export interface CreatePlan {
  text: string;
  font: string;
  background: string | null;
  overrides: number;
}

/** O que «Criar estilos globais» vai associar (só lê). */
export function planGlobalSetup(editor: Editor): CreatePlan {
  const body = findRule(editor, 'body');
  const st = body ? rawStyle(body) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() && !variableOf(v) ? v : null);
  return {
    text: str(st.color) ?? '#333333',
    font: str(st['font-family']) ?? "'Inter', 'Segoe UI', system-ui, sans-serif",
    background: str(st['background-color']),
    overrides: ownOverrides(editor),
  };
}

/**
 * Cria a configuração global mínima num projeto que não tem variáveis: declara em `body` as
 * variáveis da cor do texto, da fonte do texto e do fundo (se o corpo já o declarar), com os
 * valores ATUAIS, e liga o corpo a elas. O aspeto não muda. Não cria regras de títulos nem toca
 * em regras próprias dos elementos. Um só passo de histórico.
 */
export function createGlobalSetup(editor: Editor): void {
  const plan = planGlobalSetup(editor);
  const vars: Record<string, string> = {
    '--bolt-text': plan.text,
    '--bolt-font-body': plan.font,
  };
  const bind: Record<string, string> = { color: 'var(--bolt-text)', 'font-family': 'var(--bolt-font-body)' };
  if (plan.background) {
    vars['--bolt-bg'] = plan.background;
    bind['background-color'] = 'var(--bolt-bg)';
  }
  const body = findRule(editor, 'body');
  if (body) body.addStyle({ ...vars, ...bind });
  else editor.Css.setRule('body', { ...vars, ...bind });
  editor.trigger(GLOBAL_EVENT);
}
