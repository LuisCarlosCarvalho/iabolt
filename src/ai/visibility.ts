import type { Editor } from 'grapesjs';
import type { AiOperation } from '../../supabase/functions/_shared/ai/contract.ts';
import { displayName } from '../engine/labels';
import { findInProject } from '../engine/operations';
import type { DeviceId } from '../engine/styles';

/**
 * Depois de aplicar estilos próprios, confirma no CANVAS que o valor pedido é o que aparece.
 * Num site importado, uma regra da folha original com `!important` (ex.: os utilitários do
 * Bootstrap, `.text-muted`, `.mb-1`) ou mais específica prevalece sobre a regra `#id` do Bolt:
 * a alteração fica gravada mas não se vê. Nesses casos o editor tem de o dizer, em vez de mostrar
 * a alteração como feita.
 */
export interface HiddenChange {
  id: string;
  name: string;
  prop: string;
  wanted: string;
  shown: string;
  /** Regra que prevalece, quando identificada (ex.: «.text-muted» com !important). */
  cause: string;
}

/**
 * O motor cria os elementos do canvas com o documento da APLICAÇÃO e só depois os põe no iframe:
 * `instanceof` com as classes da janela do canvas falha. As verificações são por forma.
 */
const isStyled = (n: unknown): n is HTMLElement => typeof n === 'object' && n !== null && 'style' in n && 'matches' in n && 'nodeType' in n && n.nodeType === 1;
const isStyleRule = (r: CSSRule): r is CSSStyleRule => 'selectorText' in r && 'style' in r;
const isGroupRule = (r: CSSRule): r is CSSGroupingRule => 'cssRules' in r;
const isMediaRule = (r: CSSRule): r is CSSMediaRule => 'media' in r && 'cssRules' in r;

/** Valor calculado que o pedido produziria no mesmo contexto (elemento-sonda com o valor forçado). */
function expectedValue(el: HTMLElement, prop: string, value: string): string | null {
  const parent = el.parentElement;
  const view = el.ownerDocument.defaultView;
  if (!parent || !view) return null;
  const probe = el.cloneNode(false);
  if (!isStyled(probe)) return null;
  probe.removeAttribute('id');
  probe.style.setProperty(prop, value, 'important');
  probe.style.setProperty('visibility', 'hidden', 'important');
  parent.insertBefore(probe, el);
  try {
    return view.getComputedStyle(probe).getPropertyValue(prop);
  } finally {
    probe.remove();
  }
}

/** Primeira regra que aplica a propriedade ao elemento com !important (folhas legíveis do canvas). */
function importantRule(el: HTMLElement, prop: string): string | null {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const visit = (rules: CSSRuleList): string | null => {
    for (const rule of [...rules]) {
      // Regra de estilo primeiro: com CSS aninhado, também tem `cssRules`.
      if (!isStyleRule(rule)) {
        if (isMediaRule(rule) && view && !view.matchMedia(rule.conditionText).matches) continue;
        if (isGroupRule(rule)) {
          const inner = visit(rule.cssRules);
          if (inner) return inner;
        }
      } else {
        if (rule.style.getPropertyPriority(prop) !== 'important') continue;
        try {
          if (el.matches(rule.selectorText)) return rule.selectorText;
        } catch {
          // Seletor que o browser não sabe avaliar: ignorado.
        }
      }
    }
    return null;
  };
  for (const sheet of [...doc.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // folha de outra origem (CDN): não legível
    }
    const found = visit(rules);
    if (found) return found;
  }
  return null;
}

export function hiddenStyleChanges(editor: Editor, ops: readonly AiOperation[], device: DeviceId): HiddenChange[] {
  const out: HiddenChange[] = [];
  for (const op of ops) {
    if (op.op !== 'setOwnStyle' || op.device !== device) continue;
    const c = findInProject(editor, op.id)?.component;
    const el = c?.getEl();
    const view = el?.ownerDocument.defaultView;
    if (!c || !isStyled(el) || !view || !el.isConnected) continue;
    for (const [prop, value] of Object.entries(op.style)) {
      if (typeof value !== 'string' || value.trim() === '') continue;
      const wanted = expectedValue(el, prop, value);
      if (wanted === null) continue;
      const shown = view.getComputedStyle(el).getPropertyValue(prop);
      if (shown === wanted) continue;
      const rule = importantRule(el, prop);
      out.push({
        id: op.id,
        name: displayName(c),
        prop,
        wanted: value,
        shown,
        cause: rule ? `a regra «${rule}» do site tem !important` : 'uma regra do site com mais prioridade (seletor mais específico)',
      });
    }
  }
  return out;
}

/** Espera que o canvas desenhe as regras novas (dois fotogramas da janela do canvas). */
export function canvasSettled(editor: Editor): Promise<void> {
  const win = editor.Canvas.getWindow();
  if (!win) return Promise.resolve();
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
}

export function describeHidden(h: HiddenChange): string {
  return `${h.name}: «${h.prop}: ${h.wanted}» foi gravado, mas não se vê — ${h.cause}. Valor visível: ${h.shown || '—'}.`;
}
