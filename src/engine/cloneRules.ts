import type { Component, CssRule, Editor } from 'grapesjs';
import { remapSelectorIds } from './cssText';

const SELECTOR_REF = ['data-bolt-toggle', 'data-bs-target', 'data-target'];

/**
 * Ao clonar, o motor copia as regras cujo seletor é exatamente `#id` do componente (com
 * breakpoints e estados). As regras compostas que referem o id — p. ex. o menu móvel
 * `#menu[data-bolt-menu-open] #itens`, sobreposições `::before` do Elementor ou CSS personalizado
 * importado `#el .swiper-wrapper` — ficariam a apontar para os ids ORIGINAIS e a cópia perdia
 * esse comportamento ou aspeto. Esta função copia-as com os ids trocados pelos da cópia,
 * mantendo media query e estado. Não altera nem apaga as regras originais.
 */

/** Pares id original → id da cópia, percorrendo as duas árvores em paralelo. */
export function idMapOf(source: Component, clone: Component, out = new Map<string, string>()): Map<string, string> {
  const a = source.getId();
  const b = clone.getId();
  if (a && b && a !== b && source.get('type') !== 'textnode') out.set(a, b);
  const sa = source.components().models;
  const sb = clone.components().models;
  sa.forEach((child, i) => {
    const other = sb[i];
    if (other) idMapOf(child, other, out);
  });
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function freeSelector(rule: CssRule): string {
  const v: unknown = rule.get('selectorsAdd');
  return typeof v === 'string' ? v : '';
}

const sameRule = (r: CssRule, selector: string, media: string, state: string) =>
  freeSelector(r) === selector && String(r.get('mediaText') ?? '') === media && String(r.get('state') ?? '') === state;

export function cloneScopedRules(editor: Editor, ids: Map<string, string>): number {
  if (ids.size === 0) return 0;
  const pattern = new RegExp(`#(${[...ids.keys()].map(escape).join('|')})(?![\\w-])`, 'g');
  const rules = editor.Css.getAll();
  let copied = 0;
  for (const rule of [...rules.models]) {
    const selector = freeSelector(rule);
    if (!selector) continue;
    pattern.lastIndex = 0;
    if (!pattern.test(selector)) continue;
    const next = selector.replace(pattern, (_m, id: string) => `#${ids.get(id) ?? id}`);
    if (next === selector) continue;
    const media = String(rule.get('mediaText') ?? '');
    const state = String(rule.get('state') ?? '');
    if (rules.models.some((r) => sameRule(r, next, media, state))) continue;
    // Cópia do próprio modelo: mantém media query, estado (::before, :hover), estilos e restantes
    // propriedades; só o seletor muda. (setRule não aceita estado.)
    const copy = rule.clone();
    copy.set('selectorsAdd', next);
    rules.add(copy);
    copied += 1;
  }
  return copied;
}

/** Atributos que referem ids de outros elementos: um id, ou uma lista separada por espaços. */
const SINGLE_REF = ['for', 'form', 'list', 'aria-activedescendant'] as const;
const LIST_REF = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'aria-details', 'aria-errormessage', 'headers'] as const;

/**
 * Referências internas da cópia: atributos que apontam para elementos DENTRO da parte copiada
 * passam a apontar para os ids novos da cópia (ex.: `href="#secao"`, `<label for>`,
 * `aria-labelledby`). As que apontam para fora mantêm-se. Só troca identificadores inteiros,
 * atributo a atributo — nunca substitui texto no documento nem no CSS.
 */
export function remapReferences(root: Component, ids: Map<string, string>): number {
  let changed = 0;
  const walk = (c: Component) => {
    const attrs = c.getAttributes();
    const patch: Record<string, string> = {};
    const href = attrs.href;
    if (typeof href === 'string' && href.startsWith('#')) {
      const next = ids.get(href.slice(1));
      if (next) patch.href = `#${next}`;
    }
    for (const name of SINGLE_REF) {
      const v = attrs[name];
      const next = typeof v === 'string' ? ids.get(v.trim()) : undefined;
      if (next) patch[name] = next;
    }
    for (const name of LIST_REF) {
      const v = attrs[name];
      if (typeof v !== 'string' || !v.trim()) continue;
      const tokens = v.trim().split(/\s+/);
      const mapped = tokens.map((t) => ids.get(t) ?? t);
      if (mapped.some((t, i) => t !== tokens[i])) patch[name] = mapped.join(' ');
    }
    // Atributos com seletores (comportamentos de sites importados: menu lateral, colapsos).
    for (const name of SELECTOR_REF) {
      const v = attrs[name];
      if (typeof v !== 'string' || !v) continue;
      const next = remapSelectorIds(v, ids);
      if (next !== v) patch[name] = next;
    }
    if (Object.keys(patch).length) {
      c.addAttributes(patch);
      changed += 1;
    }
    c.components().models.forEach(walk);
  };
  walk(root);
  return changed;
}
