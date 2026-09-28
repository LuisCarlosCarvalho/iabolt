import postcss, { type AtRule, type ChildNode, type Rule } from 'postcss';

/**
 * Regra de estilo no formato JSON do GrapesJS (o mesmo de `projectData.styles`).
 * Gerar este formato diretamente evita o parser do browser, que em alguns ambientes
 * descarta propriedades que não conhece (ex.: `src` de @font-face).
 */
export interface StyleJson {
  selectors: string[];
  selectorsAdd?: string;
  style: Record<string, string>;
  mediaText?: string;
  atRuleType?: string;
  singleAtRule?: boolean;
  state?: string;
}

export const idRule = (id: string, style: Record<string, string>, maxWidth?: string, state?: string): StyleJson => ({
  selectors: [`#${id}`],
  style,
  ...(maxWidth ? { mediaText: `(max-width: ${maxWidth})`, atRuleType: 'media' } : {}),
  ...(state ? { state } : {}),
});

export const freeRule = (selector: string, style: Record<string, string>, mediaText?: string): StyleJson => ({
  selectors: [],
  selectorsAdd: selector,
  style,
  ...(mediaText ? { mediaText, atRuleType: 'media' } : {}),
});

export const fontFaceRule = (style: Record<string, string>): StyleJson => ({ selectors: [], style, atRuleType: 'font-face', singleAtRule: true });

/** Remove entradas vazias; o motor não precisa de propriedades sem valor. */
export function compactStyle(style: Record<string, string | undefined | null | false>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  return out;
}

const UNSAFE_VALUE = /expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i;

function declarations(node: Rule | AtRule): Record<string, string> {
  const style: Record<string, string> = {};
  node.each((child) => {
    if (child.type !== 'decl') return;
    if (UNSAFE_VALUE.test(child.value)) return;
    style[child.prop] = child.important ? `${child.value} !important` : child.value;
  });
  return style;
}

/**
 * Converte CSS em texto para regras do motor. Suporta regras simples, @media, @font-face e
 * @keyframes; outras at-rules (@import, @supports…) são devolvidas em `ignored` para o relatório.
 */
export function parseCss(css: string, transformSelector: (s: string) => string = (s) => s): { rules: StyleJson[]; ignored: string[] } {
  const rules: StyleJson[] = [];
  const ignored: string[] = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch (e) {
    return { rules, ignored: [`CSS inválido: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const visit = (node: ChildNode, mediaText?: string) => {
    if (node.type === 'rule') {
      const style = declarations(node);
      if (Object.keys(style).length) rules.push(freeRule(transformSelector(node.selector), style, mediaText));
      return;
    }
    if (node.type !== 'atrule') return;
    const name = node.name.toLowerCase();
    if (name === 'media') {
      node.each((child) => visit(child, node.params));
    } else if (name === 'font-face') {
      rules.push(fontFaceRule(declarations(node)));
    } else if (name === 'keyframes' || name === '-webkit-keyframes') {
      node.each((frame) => {
        if (frame.type === 'rule') rules.push({ selectors: [], selectorsAdd: frame.selector, style: declarations(frame), mediaText: node.params, atRuleType: 'keyframes' });
      });
    } else {
      ignored.push(`@${node.name} ${node.params}`.trim());
    }
  };
  root.each((node) => visit(node));
  return { rules, ignored };
}
