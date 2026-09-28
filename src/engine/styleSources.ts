import type { Component, CssRule, Editor } from 'grapesjs';
import { DEVICES, deviceById, EDITABLE_PROPS, setOwnStyle, type DeviceId, type EditableProp, type StylePatch } from './styles';

/**
 * De onde vem o valor de cada propriedade do elemento selecionado, no dispositivo em edição.
 * Só LÊ: nunca cria regras nem escreve no documento (abrir o inspetor não altera o projeto).
 *
 *  - `own`: regra própria do elemento (`#id`) neste dispositivo — é o que o inspetor edita;
 *  - `device`: regra própria do elemento noutro dispositivo mais largo (ex.: Computador), que
 *    continua a aplicar-se aqui;
 *  - `rule`: outra regra do site que se aplica ao elemento (classe, seletor, breakpoint próprio
 *    de um projeto importado);
 *  - `computed`: só o valor calculado pelo browser (predefinição ou herança).
 */
export type SourceKind = 'own' | 'device' | 'rule' | 'computed';

export interface ValueSource {
  kind: SourceKind;
  /** Texto curto para mostrar (ex.: «Computador», «.gjs-section», «@media (max-width: 767px)»). */
  label: string;
  /** Valor declarado nessa origem (para `computed`, o calculado). */
  value: string;
}

/** Propriedade abreviada que também define cada propriedade (ex.: `padding` → `padding-top`). */
function shorthandsOf(prop: string): string[] {
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(prop);
  if (m?.[1]) return [m[1]];
  if (/^border-(width|style|color)$/.test(prop)) return ['border'];
  if (prop.startsWith('background-')) return ['background'];
  if (prop === 'row-gap' || prop === 'column-gap') return ['gap'];
  if (prop === 'flex-direction' || prop === 'flex-wrap') return ['flex-flow'];
  if (['top', 'right', 'bottom', 'left'].includes(prop)) return ['inset'];
  return [];
}

function declared(style: Record<string, unknown>, prop: string): { value: string; via: string } | null {
  const direct = style[prop];
  if (typeof direct === 'string' && direct !== '') return { value: direct, via: prop };
  for (const s of shorthandsOf(prop)) {
    const v = style[s];
    if (typeof v === 'string' && v !== '') return { value: v, via: s };
  }
  return null;
}

/** Media query de um dispositivo tal como o motor a escreve. */
const mediaOf = (id: DeviceId) => {
  const m = deviceById(id).media;
  return m ? `(max-width: ${m})` : '';
};

/** Dispositivos mais largos do que `device` (as suas regras também se aplicam a `device`). */
function widerDevices(device: DeviceId): DeviceId[] {
  const idx = DEVICES.findIndex((d) => d.id === device);
  return DEVICES.slice(0, Math.max(0, idx))
    .map((d) => d.id)
    .reverse();
}

function ruleMedia(rule: CssRule): string {
  return String(rule.get('mediaText') ?? '');
}

/** Regras do site que se aplicam ao elemento na moldura atual (excluindo as próprias `#id`). */
function matchingRules(editor: Editor, component: Component): Array<{ rule: CssRule; selector: string; media: string }> {
  const el = component.getEl();
  const win = el?.ownerDocument?.defaultView;
  if (!el || !win) return [];
  const own = `#${component.getId()}`;
  const out: Array<{ rule: CssRule; selector: string; media: string }> = [];
  for (const rule of editor.Css.getRules()) {
    if (rule.get('state')) continue; // :hover, ::before… não são o estado normal
    const atType = rule.get('atRuleType');
    if (atType && atType !== 'media') continue;
    const media = ruleMedia(rule);
    const selector = rule.selectorsToString();
    if (!selector || (selector === own && ['', ...DEVICES.map((d) => mediaOf(d.id))].includes(media))) continue;
    if (media && !win.matchMedia(media).matches) continue;
    try {
      if (!el.matches(selector)) continue;
    } catch {
      continue; // seletor que o browser não entende isoladamente
    }
    out.push({ rule, selector, media });
  }
  return out;
}

/** Origem do valor de todas as propriedades editáveis. */
export function styleSources(editor: Editor, component: Component, device: DeviceId): Map<EditableProp, ValueSource> {
  const opts = (id: DeviceId) => (mediaOf(id) ? { atRuleType: 'media', atRuleParams: mediaOf(id) } : {});
  const ownStyle = (id: DeviceId) => editor.Css.getRule(`#${component.getId()}`, opts(id))?.getStyle() ?? {};
  const here = ownStyle(device);
  const wider = widerDevices(device).map((id) => ({ id, style: ownStyle(id) }));
  const rules = matchingRules(editor, component);
  const el = component.getEl();
  const computed = el?.ownerDocument?.defaultView?.getComputedStyle(el);

  const out = new Map<EditableProp, ValueSource>();
  for (const prop of EDITABLE_PROPS) {
    const mine = declared(here, prop);
    if (mine) {
      out.set(prop, { kind: 'own', label: mine.via === prop ? 'Neste dispositivo' : `Neste dispositivo (${mine.via})`, value: mine.value });
      continue;
    }
    const fromDevice = wider.map((w) => ({ id: w.id, d: declared(w.style, prop) })).find((w) => w.d);
    if (fromDevice?.d) {
      out.set(prop, { kind: 'device', label: deviceById(fromDevice.id).label, value: fromDevice.d.value });
      continue;
    }
    // Última regra aplicável que declara a propriedade (aproximação da cascata por ordem).
    let hit: { selector: string; media: string; value: string } | null = null;
    for (const r of rules) {
      const d = declared(r.rule.getStyle(), prop);
      if (d) hit = { selector: r.selector, media: r.media, value: d.value };
    }
    if (hit) {
      out.set(prop, { kind: 'rule', label: hit.media ? `${hit.selector} · ${hit.media}` : hit.selector, value: hit.value });
      continue;
    }
    out.set(prop, { kind: 'computed', label: 'Calculado', value: computed?.getPropertyValue(prop) ?? '' });
  }
  return out;
}

/**
 * Interação contínua (seletor de cor, controlo deslizante): mostra o valor em tempo real SEM
 * registar histórico e, no fim, deixa um único passo de desfazer do valor inicial para o final.
 */
export function createContinuousEdit(editor: Editor, component: Component, device: DeviceId, prop: EditableProp) {
  const opts = mediaOf(device) ? { atRuleType: 'media', atRuleParams: mediaOf(device) } : {};
  const initialStyle = editor.Css.getRule(`#${component.getId()}`, opts)?.getStyle() ?? {};
  const initialRaw = initialStyle[prop];
  const initial = typeof initialRaw === 'string' ? initialRaw : '';
  const um = editor.UndoManager;
  const untracked = (patch: StylePatch) => {
    um.stop();
    try {
      setOwnStyle(editor, component, device, patch);
    } finally {
      um.start();
    }
  };
  let last: string | null = null;
  return {
    preview(value: string) {
      last = value;
      untracked({ [prop]: value });
    },
    /** Grava o valor final como um só passo. */
    commit(value: string = last ?? initial) {
      untracked({ [prop]: initial });
      if (value !== initial) setOwnStyle(editor, component, device, { [prop]: value });
      last = null;
    },
    cancel() {
      untracked({ [prop]: initial });
      last = null;
    },
  };
}
