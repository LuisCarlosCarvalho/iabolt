import { z } from 'zod';
import { compactStyle, freeRule, idRule, type StyleJson } from '../css';

/** Estrutura de um elemento Elementor (container ou widget), validada sem assumir widgets específicos. */
export interface EElement {
  id?: string;
  elType?: string;
  widgetType?: string;
  isInner?: boolean;
  settings: Record<string, unknown>;
  elements: EElement[];
}

/**
 * Exportações do Elementor variam entre versões: `isInner` chega como booleano, `""`, `"1"`/`"0"`,
 * `"true"`/`"false"` ou número (ex.: «3 Página de venda MKT.json», formato 0.4 com secções e
 * colunas clássicas, com `isInner: ""`, que era recusado inteiro a 08/10/2026); `id` pode ser
 * numérico; `elements` pode vir nulo.
 */
/**
 * Proteção para exportações que tragam os valores compostos como TEXTO JSON
 * (`"width": "{\"unit\":\"%\",\"size\":\"11\"}"`, `"tabs": "[{…}]"`): passam a objetos/listas.
 * (Não era o caso de «3 Página de venda MKT.json», que traz objetos normais.)
 * Texto normal (incluindo «[shortcode]» ou HTML) fica tal como está: só muda se for JSON válido
 * de um objeto ou lista.
 */
export function normalizeSettings(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          const parsed: unknown = JSON.parse(t);
          if (parsed && typeof parsed === 'object') {
            out[k] = parsed;
            continue;
          }
        } catch {
          // não é JSON: é texto
        }
      }
    }
    out[k] = v;
  }
  return out;
}

const looseBool = z.preprocess((v) => (v === undefined || v === null ? undefined : v === true || v === 1 || v === '1' || v === 'true' || v === 'yes'), z.boolean().optional());
const looseId = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().optional());

const elementSchema: z.ZodType<EElement> = z.lazy(() =>
  z
    .object({
      id: looseId,
      elType: z.string().optional(),
      widgetType: z.string().optional(),
      isInner: looseBool,
      settings: z.union([z.record(z.string(), z.unknown()).transform(normalizeSettings), z.array(z.unknown()).transform(() => ({}))]).default({}),
      elements: z.preprocess((v) => (v === null ? [] : v), z.array(elementSchema).default([])),
    })
    .passthrough(),
);

export const elementorDocumentSchema = z
  .object({
    version: z.string().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
    content: z.array(elementSchema),
    // Também pode vir como texto JSON (formato antigo); texto que não seja um objeto é ignorado.
    page_settings: z.preprocess(
      (v) => (typeof v === 'string' ? (normalizeSettings({ v }).v ?? {}) : v),
      z.union([z.record(z.string(), z.unknown()).transform(normalizeSettings), z.array(z.unknown()).transform(() => ({})), z.string().transform(() => ({}))]).optional(),
    ),
  })
  .passthrough();

export type ElementorDocument = z.infer<typeof elementorDocumentSchema>;

/** Breakpoints predefinidos do Elementor (limites máximos). */
export const BREAKPOINTS = { laptop: '1366px', tablet: '1024px', mobile: '767px' } as const;
export type Device = 'desktop' | keyof typeof BREAKPOINTS;
export const DEVICES: Device[] = ['desktop', 'laptop', 'tablet', 'mobile'];
const suffix = (d: Device) => (d === 'desktop' ? '' : `_${d}`);

export const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : typeof v === 'number' ? String(v) : undefined);

/** `{unit, size}` → «16px». Tamanho vazio → indefinido. */
export function size(v: unknown): string | undefined {
  const o = rec(v);
  if (!o) return undefined;
  const s = str(o.size);
  if (s === undefined) return undefined;
  return `${s}${str(o.unit) ?? 'px'}`;
}

/** `{unit, top, right, bottom, left}` → propriedades com prefixo (padding/margin/border-width). */
export function dims(v: unknown, prop: 'padding' | 'margin' | 'border-width' | 'border-radius'): Record<string, string> {
  const o = rec(v);
  if (!o) return {};
  const unit = str(o.unit) ?? 'px';
  const sides = prop === 'border-radius' ? ['top-left', 'top-right', 'bottom-right', 'bottom-left'] : ['top', 'right', 'bottom', 'left'];
  const keys = ['top', 'right', 'bottom', 'left'];
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    const val = str(o[k]);
    if (val === undefined) return;
    const name = prop === 'border-radius' ? `border-${sides[i]}-radius` : prop === 'border-width' ? `border-${keys[i]}-width` : `${prop}-${keys[i]}`;
    out[name] = `${val}${unit}`;
  });
  return out;
}

/** Estilos por dispositivo de um elemento, convertidos em regras `#id` (desktop + media max-width). */
export class DeviceStyles {
  private readonly byDevice: Record<Device, Record<string, string>> = { desktop: {}, laptop: {}, tablet: {}, mobile: {} };
  private readonly extra: StyleJson[] = [];

  constructor(readonly id: string) {}

  set(device: Device, style: Record<string, string | undefined | null | false>): void {
    Object.assign(this.byDevice[device], compactStyle(style));
  }

  /** Aplica `fn(valor)` a cada dispositivo onde a definição `key` existe. */
  responsive(settings: Record<string, unknown>, key: string, fn: (value: unknown) => Record<string, string | undefined | null | false>): void {
    for (const d of DEVICES) {
      const v = settings[`${key}${suffix(d)}`];
      if (v === undefined || v === null || v === '') continue;
      this.set(d, fn(v));
    }
  }

  add(rule: StyleJson): void {
    this.extra.push(rule);
  }

  rules(): StyleJson[] {
    const out: StyleJson[] = [];
    for (const d of DEVICES) {
      const style = this.byDevice[d];
      if (!Object.keys(style).length) continue;
      out.push(d === 'desktop' ? idRule(this.id, style) : idRule(this.id, style, BREAKPOINTS[d]));
    }
    return [...out, ...this.extra];
  }
}

/** Tipografia «custom» do Elementor com prefixo (ex.: `title_`, `icon_`). */
export function typography(ds: DeviceStyles, s: Record<string, unknown>, prefix = '', fonts?: Map<string, Set<string>>): void {
  if (s[`${prefix}typography_typography`] !== 'custom') return;
  const family = str(s[`${prefix}typography_font_family`]);
  const weight = str(s[`${prefix}typography_font_weight`]);
  if (family) {
    ds.set('desktop', { 'font-family': `"${family}", sans-serif` });
    if (fonts) {
      const set = fonts.get(family) ?? new Set<string>();
      set.add(weight && /^\d+$/.test(weight) ? weight : '400');
      fonts.set(family, set);
    }
  }
  if (weight) ds.set('desktop', { 'font-weight': weight === 'normal' ? '400' : weight === 'bold' ? '700' : weight });
  ds.responsive(s, `${prefix}typography_font_size`, (v) => ({ 'font-size': size(v) }));
  ds.responsive(s, `${prefix}typography_line_height`, (v) => ({ 'line-height': size(v) }));
  ds.responsive(s, `${prefix}typography_letter_spacing`, (v) => ({ 'letter-spacing': size(v) }));
  ds.responsive(s, `${prefix}typography_word_spacing`, (v) => ({ 'word-spacing': size(v) }));
  const transform = str(s[`${prefix}typography_text_transform`]);
  if (transform) ds.set('desktop', { 'text-transform': transform });
  const style = str(s[`${prefix}typography_font_style`]);
  if (style) ds.set('desktop', { 'font-style': style });
  const decoration = str(s[`${prefix}typography_text_decoration`]);
  if (decoration) ds.set('desktop', { 'text-decoration': decoration });
}

/** Definições comuns a todos os widgets («Avançado» no Elementor). */
export function commonWidgetStyles(ds: DeviceStyles, s: Record<string, unknown>): void {
  ds.responsive(s, '_margin', (v) => dims(v, 'margin'));
  ds.responsive(s, '_padding', (v) => dims(v, 'padding'));
  for (const d of DEVICES) {
    const mode = str(s[`_element_width${suffix(d)}`]);
    if (mode === 'initial') {
      const w = size(s[`_element_custom_width${suffix(d)}`]) ?? size(s._element_custom_width);
      ds.set(d, { width: w, 'max-width': w ? '100%' : undefined });
    } else if (mode === 'auto') ds.set(d, { width: 'auto', 'max-width': '100%' });
    else if (mode === 'inherit' && d !== 'desktop') ds.set(d, { width: '100%' });
  }
  ds.responsive(s, '_flex_align_self', (v) => ({ 'align-self': str(v) }));
  ds.responsive(s, '_flex_order', (v) => ({ order: str(v) === 'start' ? '-99999' : str(v) === 'end' ? '99999' : str(v) }));
  ds.responsive(s, '_z_index', (v) => ({ 'z-index': str(v), position: 'relative' }));
  if (s._background_background === 'classic') ds.set('desktop', { 'background-color': str(s._background_color) });
  ds.responsive(s, '_border_radius', (v) => dims(v, 'border-radius'));
  if (str(s._border_border)) {
    ds.set('desktop', { 'border-style': str(s._border_border), 'border-color': str(s._border_color) });
    ds.responsive(s, '_border_width', (v) => dims(v, 'border-width'));
  }
  visibility(ds, s);
}

/** «Ocultar em» do Elementor → display:none no intervalo de cada dispositivo. */
export function visibility(ds: DeviceStyles, s: Record<string, unknown>): void {
  const ranges: Array<[string, string]> = [
    ['hide_desktop', '(min-width: 1025px)'],
    ['hide_tablet', '(min-width: 768px) and (max-width: 1024px)'],
    ['hide_mobile', '(max-width: 767px)'],
  ];
  // Valores conhecidos: «hidden-desktop», «hidden-tablet», «hidden-mobile», «yes» e a forma antiga
  // «hidden-phone» (modelos 0.4, ex.: «3 Página de venda MKT.json», 08/10/2026).
  const on = (v: unknown) => typeof v === 'string' && /^(hidden-(desktop|tablet|mobile|phone)|yes)$/.test(v);
  for (const [key, media] of ranges) if (on(s[key])) ds.add(freeRule(`#${ds.id}`, { display: 'none' }, media));
}

export function background(ds: DeviceStyles, s: Record<string, unknown>, prefix = 'background_'): string[] {
  const images: string[] = [];
  const kind = s[`${prefix}background`];
  if (kind === 'classic') {
    ds.set('desktop', { 'background-color': str(s[`${prefix}color`]) });
    for (const d of DEVICES) {
      const img = rec(s[`${prefix}image${suffix(d)}`]);
      const url = str(img?.url);
      if (url) {
        images.push(url);
        ds.set(d, { 'background-image': `url("${url}")` });
      }
    }
    ds.responsive(s, `${prefix}position`, (v) => ({ 'background-position': str(v)?.replace('initial', 'center') }));
    ds.responsive(s, `${prefix}size`, (v) => ({ 'background-size': str(v)?.replace('initial', 'auto') }));
    ds.responsive(s, `${prefix}repeat`, (v) => ({ 'background-repeat': str(v) }));
    ds.responsive(s, `${prefix}attachment`, (v) => ({ 'background-attachment': str(v) }));
  } else if (kind === 'gradient') {
    const a = str(s[`${prefix}color`]) ?? 'transparent';
    const b = str(s[`${prefix}color_b`]) ?? '#f2295b';
    const stopA = size(s[`${prefix}color_stop`]) ?? '0%';
    const stopB = size(s[`${prefix}color_b_stop`]) ?? '100%';
    const angle = size(s[`${prefix}gradient_angle`]) ?? '180deg';
    ds.set('desktop', { 'background-image': `linear-gradient(${angle}, ${a} ${stopA}, ${b} ${stopB})` });
  }
  return images;
}
