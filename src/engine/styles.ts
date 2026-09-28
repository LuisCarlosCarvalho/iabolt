import type { Component, Editor } from 'grapesjs';

/** Regra de estilo declarada como objeto (sem parse de CSS, igual em browser e jsdom). */
export interface StyleRule {
  selector: string;
  style: Record<string, string>;
  /** Largura máxima do media query, ex.: '480px'. */
  maxWidth?: string;
}

export type DeviceId = 'desktop' | 'tablet' | 'mobile';

export interface DeviceDef {
  id: DeviceId;
  label: string;
  /** Largura da moldura no canvas (o editor ajusta o zoom para caber). */
  width: string;
  /** Limite do media query onde os estilos deste dispositivo são gravados. */
  media: string;
}

export const DEVICES: readonly DeviceDef[] = [
  { id: 'desktop', label: 'Computador', width: '1280px', media: '' },
  { id: 'tablet', label: 'Tablet', width: '768px', media: '992px' },
  { id: 'mobile', label: 'Telemóvel', width: '375px', media: '480px' },
];

export function deviceById(id: DeviceId): DeviceDef {
  return DEVICES.find((d) => d.id === id) ?? { id: 'desktop', label: 'Computador', width: '1280px', media: '' };
}

/** Configuração de dispositivos do motor, derivada de DEVICES. */
export function deviceManagerConfig() {
  return {
    default: 'desktop',
    devices: DEVICES.map((d) => ({ id: d.id, name: d.label, width: d.width, ...(d.media ? { widthMedia: d.media } : {}) })),
  };
}

/** Folha base comum a todos os projetos. Os temas só mudam as variáveis em `body`. */
export const BASE_RULES: readonly StyleRule[] = [
  { selector: '*', style: { 'box-sizing': 'border-box' } },
  {
    selector: 'body',
    style: {
      margin: '0',
      'font-family': 'var(--bolt-font-body)',
      color: 'var(--bolt-text)',
      'background-color': 'var(--bolt-bg)',
      'line-height': '1.6',
    },
  },
  { selector: 'h1, h2, h3, h4', style: { 'font-family': 'var(--bolt-font-heading)', 'line-height': '1.15', margin: '0 0 16px', color: 'var(--bolt-heading)' } },
  { selector: 'p', style: { margin: '0 0 16px' } },
  { selector: 'a', style: { color: 'var(--bolt-primary)' } },
  { selector: '.bolt-section', style: { padding: '88px 24px' } },
  { selector: '.bolt-container', style: { 'max-width': '1120px', margin: '0 auto' } },
  { selector: '.bolt-columns', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(240px, 1fr))', gap: '32px', 'align-items': 'start' } },
  { selector: '.bolt-column', style: { 'min-height': '48px' } },
  {
    selector: '.bolt-btn',
    style: {
      display: 'inline-block',
      padding: '14px 26px',
      'border-radius': 'var(--bolt-radius)',
      'background-color': 'var(--bolt-primary)',
      color: 'var(--bolt-on-primary)',
      'text-decoration': 'none',
      'font-weight': '600',
      'line-height': '1.2',
    },
  },
  { selector: '.bolt-image', style: { display: 'block', 'max-width': '100%', height: 'auto', 'border-radius': 'var(--bolt-radius)' } },
  { selector: '.bolt-section', style: { padding: '56px 20px' }, maxWidth: '480px' },
];

export const DEFAULT_THEME: Record<string, string> = {
  '--bolt-primary': '#2563eb',
  '--bolt-on-primary': '#ffffff',
  '--bolt-text': '#334155',
  '--bolt-heading': '#0f172a',
  '--bolt-bg': '#ffffff',
  '--bolt-radius': '10px',
  '--bolt-font-body': "'Inter', 'Segoe UI', system-ui, sans-serif",
  '--bolt-font-heading': "'Inter', 'Segoe UI', system-ui, sans-serif",
};

function mediaOpts(maxWidth?: string) {
  return maxWidth ? { atRuleType: 'media', atRuleParams: `(max-width: ${maxWidth})` } : {};
}

export function applyRules(editor: Editor, rules: readonly StyleRule[]): void {
  for (const r of rules) {
    const existing = editor.Css.getRule(r.selector, mediaOpts(r.maxWidth))?.getStyle() ?? {};
    editor.Css.setRule(r.selector, { ...existing, ...r.style }, mediaOpts(r.maxWidth));
  }
}

/** Propriedades editáveis no painel. Lista fechada: o painel não é um editor de CSS livre. */
export const EDITABLE_PROPS = [
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
  'margin-bottom',
  'border-radius',
  'width',
  'max-width',
] as const;

export type EditableProp = (typeof EDITABLE_PROPS)[number];
export type StylePatch = Partial<Record<EditableProp, string>>;

function ruleFor(editor: Editor, component: Component, device: DeviceId) {
  return editor.Css.getRule(`#${component.getId()}`, mediaOpts(deviceById(device).media || undefined));
}

/** Estilos próprios do componente (regra `#id`) no dispositivo indicado. */
export function getOwnStyle(editor: Editor, component: Component, device: DeviceId): StylePatch {
  const style = ruleFor(editor, component, device)?.getStyle() ?? {};
  const out: StylePatch = {};
  for (const p of EDITABLE_PROPS) {
    const v = style[p];
    if (typeof v === 'string' && v !== '') out[p] = v;
  }
  return out;
}

/**
 * Grava estilos na regra `#id` do dispositivo atual. Valores vazios removem a propriedade.
 * A regra fica no JSON do projeto (styles), por isso sobrevive a guardar e reabrir.
 */
export function setOwnStyle(editor: Editor, component: Component, device: DeviceId, patch: StylePatch): void {
  const opts = mediaOpts(deviceById(device).media || undefined);
  const selector = `#${component.getId()}`;
  const current = editor.Css.getRule(selector, opts)?.getStyle() ?? {};
  const merged: Record<string, unknown> = { ...current, ...patch };
  // Valores vazios removem a propriedade.
  const next = Object.fromEntries(Object.entries(merged).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  editor.Css.setRule(selector, next, opts);
}
