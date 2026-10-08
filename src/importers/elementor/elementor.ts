import { freeRule, parseCss, type StyleJson } from '../css';
import { sanitizeHtml, type ComponentJson } from '../sanitize';
import { ReportBuilder, type AdapterResult, type RawProjectData } from '../types';
import {
  background,
  commonWidgetStyles,
  DeviceStyles,
  dims,
  elementorDocumentSchema,
  rec,
  size,
  str,
  typography,
  visibility,
  type EElement,
} from './settings';

/**
 * Adaptador Elementor (JSON de página/modelo, containers flexbox). Cada widget suportado é
 * convertido em componentes Bolt editáveis, com as definições traduzidas para regras `#id` por
 * dispositivo. O reconhecimento é pelo tipo de elemento e pelas definições: nunca por textos.
 */

export function isElementorDocument(value: unknown): boolean {
  const o = rec(value);
  if (!o || !Array.isArray(o.content)) return false;
  return o.content.some((el) => {
    const e = rec(el);
    return !!e && (e.elType === 'container' || e.elType === 'section' || e.elType === 'widget');
  });
}

interface Ctx {
  report: ReportBuilder;
  rules: StyleJson[];
  fonts: Map<string, Set<string>>;
  images: Map<string, Set<string>>;
  usedIds: Set<string>;
  thirdPartySettings: Map<string, number>;
  kitDefaults: Set<string>;
}

const THIRD_PARTY = /^(eael_|premium_|pa_|jet_|ha_|ae_|uael_)/;

function note3rd(ctx: Ctx, s: Record<string, unknown>): void {
  for (const k of Object.keys(s)) {
    const m = THIRD_PARTY.exec(k);
    if (!m) continue;
    const v = s[k];
    if (v === '' || v === null || (Array.isArray(v) && !v.length)) continue;
    ctx.thirdPartySettings.set(m[1] ?? k, (ctx.thirdPartySettings.get(m[1] ?? k) ?? 0) + 1);
  }
}

function registerImage(ctx: Ctx, url: string | undefined, by: string): string | undefined {
  if (!url) return undefined;
  const set = ctx.images.get(url) ?? new Set<string>();
  set.add(by);
  ctx.images.set(url, set);
  return url;
}

function makeId(ctx: Ctx, el: EElement, suffix = ''): string {
  const custom = str(el.settings._element_id) ?? str(el.settings.button_css_id);
  let base = suffix ? `el-${el.id ?? 'x'}-${suffix}` : custom && !ctx.usedIds.has(custom) ? custom : `el-${el.id ?? Math.random().toString(36).slice(2, 9)}`;
  while (ctx.usedIds.has(base)) base = `${base}-2`;
  ctx.usedIds.add(base);
  return base;
}

function classesOf(s: Record<string, unknown>): string[] {
  return (str(s.css_classes) ?? '').split(/\s+/).filter(Boolean);
}

/** CSS personalizado do Elementor Pro: «selector» passa a ser o id do elemento no Bolt. */
function customCss(ctx: Ctx, s: Record<string, unknown>, rootId: string): void {
  const css = str(s.custom_css);
  if (!css) return;
  const { rules, ignored } = parseCss(css.replace(/\bselector\b/g, `#${rootId}`));
  ctx.rules.push(...rules);
  for (const i of ignored) ctx.report.note(`CSS personalizado: «${i}» não é suportado e foi ignorado.`);
}

function htmlComponents(html: string, ctx: Ctx): string {
  const clean = sanitizeHtml(html);
  for (const r of clean.removed) ctx.report.remove(r);
  for (const css of clean.css) ctx.rules.push(...parseCss(css).rules);
  return clean.html;
}

const flexDir = (v: unknown): string | undefined => {
  const d = str(v);
  return d === 'row' || d === 'column' || d === 'row-reverse' || d === 'column-reverse' ? d : undefined;
};

// ------------------------------------------------------------------ containers

function container(el: EElement, ctx: Ctx, parentRow: boolean): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  const boxed = (str(s.content_width) ?? (el.isInner ? 'full' : 'boxed')) === 'boxed';
  const dir = flexDir(s.flex_direction) ?? 'column';
  const flex = (target: DeviceStyles) => {
    target.set('desktop', { display: 'flex', 'flex-direction': dir, 'flex-wrap': str(s.flex_wrap) ?? 'nowrap', gap: '20px' });
    target.responsive(s, 'flex_direction', (v) => ({ 'flex-direction': flexDir(v) }));
    target.responsive(s, 'flex_wrap', (v) => ({ 'flex-wrap': str(v) }));
    target.responsive(s, 'flex_justify_content', (v) => ({ 'justify-content': str(v) }));
    target.responsive(s, 'flex_align_items', (v) => ({ 'align-items': str(v) }));
    target.responsive(s, 'flex_gap', (v) => {
      const o = rec(v);
      const unit = str(o?.unit) ?? 'px';
      const col = str(o?.column) ?? str(o?.size);
      const row = str(o?.row) ?? col;
      return col === undefined ? {} : { gap: `${row}${unit} ${col}${unit}` };
    });
  };

  // Caixa exterior: fundo, bordas, espaçamento interior, altura mínima.
  ds.set('desktop', { padding: '10px', position: 'relative' });
  ds.responsive(s, 'padding', (v) => dims(v, 'padding'));
  ds.responsive(s, 'margin', (v) => dims(v, 'margin'));
  ds.responsive(s, 'min_height', (v) => ({ 'min-height': size(v) }));
  for (const url of background(ds, s)) registerImage(ctx, url, 'container (fundo)');
  if (s.background_overlay_background === 'classic' || s.background_overlay_background === 'gradient') {
    const overlay = new DeviceStyles(id);
    const imgs = background(overlay, s, 'background_overlay_');
    imgs.forEach((u) => registerImage(ctx, u, 'container (sobreposição)'));
    const opacity = size(s.background_overlay_opacity)?.replace(/px$/, '');
    for (const r of overlay.rules()) ctx.rules.push({ ...r, state: '::before', style: { ...r.style, content: '""', position: 'absolute', inset: '0', 'z-index': '-1', 'pointer-events': 'none', ...(opacity ? { opacity } : {}) } });
    ds.set('desktop', { isolation: 'isolate' });
  }
  ds.responsive(s, 'border_radius', (v) => dims(v, 'border-radius'));
  if (str(s.border_border)) {
    ds.set('desktop', { 'border-style': str(s.border_border), 'border-color': str(s.border_color) });
    ds.responsive(s, 'border_width', (v) => dims(v, 'border-width'));
  }
  // Tamanho dentro do pai.
  if (parentRow) ds.set('desktop', { flex: '1 1 0', 'min-width': '0' });
  // No Elementor, «Largura» só existe com conteúdo em largura total; num container «boxed» o valor
  // guardado fica inativo (manda a «Largura do conteúdo», boxed_width, aplicada à caixa interior).
  if (!boxed) ds.responsive(s, 'width', (v) => ({ width: size(v), flex: size(v) ? '0 1 auto' : undefined }));
  else if (size(s.width)) ctx.report.note('Containers em modo «boxed» com uma «Largura» guardada: o valor foi ignorado, como no Elementor (só se aplica com conteúdo em largura total).');
  ds.responsive(s, '_flex_align_self', (v) => ({ 'align-self': str(v) }));
  ds.responsive(s, '_flex_order', (v) => ({ order: str(v) === 'start' ? '-99999' : str(v) === 'end' ? '99999' : str(v) }));
  visibility(ds, s);
  note3rd(ctx, s);

  let inner: ComponentJson | undefined;
  if (boxed) {
    const innerDs = new DeviceStyles(`${id}-inner`);
    flex(innerDs);
    innerDs.set('desktop', { width: '100%', 'max-width': size(s.boxed_width) ?? '1140px', margin: '0 auto' });
    innerDs.responsive(s, 'boxed_width', (v) => ({ 'max-width': size(v) }));
    ctx.rules.push(...innerDs.rules());
    ds.set('desktop', { display: 'flex', 'flex-direction': 'column' });
    inner = { type: 'bolt-container', classes: ['e-con-inner'], attributes: { id: `${id}-inner` }, components: [] };
  } else {
    flex(ds);
  }
  ctx.rules.push(...ds.rules());
  customCss(ctx, s, id);

  const isRow = dir === 'row' || dir === 'row-reverse';
  const children = el.elements.map((child) => element(child, ctx, isRow)).filter((c): c is ComponentJson => !!c);
  ctx.report.add('convertido', 'container', 'Contentor flex', boxed ? 'caixa com largura máxima (boxed); direção, espaçamentos e fundo convertidos' : 'direção, espaçamentos e fundo convertidos');
  const root: ComponentJson = { type: 'bolt-container', classes: ['e-con', ...classesOf(s)], attributes: { id }, components: inner ? [{ ...inner, components: children }] : children };
  return root;
}

// ------------------------------------------------------------------ widgets

function textWidget(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  commonWidgetStyles(ds, s);
  typography(ds, s, '', ctx.fonts);
  ds.responsive(s, 'align', (v) => ({ 'text-align': str(v) }));
  ds.set('desktop', { color: str(s.text_color) });
  ctx.rules.push(...ds.rules(), freeRule(`#${id} p`, { margin: '0 0 0.9rem' }), freeRule(`#${id} p:last-child`, { 'margin-bottom': '0' }));
  const sp = new DeviceStyles(`${id} p`);
  sp.responsive(s, 'paragraph_spacing', (v) => ({ 'margin-bottom': size(v) }));
  for (const r of sp.rules()) ctx.rules.push({ selectors: [], selectorsAdd: `#${id} p`, style: r.style, ...(r.mediaText ? { mediaText: r.mediaText, atRuleType: 'media' } : {}) });
  customCss(ctx, s, id);
  if (!str(s.text_color)) ctx.kitDefaults.add('cor do texto');
  ctx.report.add('convertido', 'text-editor', 'Texto (editável no canvas)', 'HTML sanitizado; tipografia e alinhamento convertidos');
  return { type: 'text', tagName: 'div', classes: ['elementor-text', ...classesOf(s)], attributes: { id }, components: htmlComponents(str(s.editor) ?? '', ctx) };
}

function heading(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const tag = /^h[1-6]$/.test(str(s.header_size) ?? '') ? String(s.header_size) : /^(p|div|span)$/.test(str(s.header_size) ?? '') ? String(s.header_size) : 'h2';
  const ds = new DeviceStyles(id);
  ds.set('desktop', { margin: '0', padding: '0', 'line-height': '1' });
  commonWidgetStyles(ds, s);
  typography(ds, s, '', ctx.fonts);
  ds.responsive(s, 'align', (v) => ({ 'text-align': str(v) }));
  ds.set('desktop', { color: str(s.title_color) });
  if (!str(s.title_color)) ctx.kitDefaults.add('cor dos títulos');
  ctx.rules.push(...ds.rules());
  customCss(ctx, s, id);
  const html = htmlComponents(str(s.title) ?? '', ctx);
  const link = str(rec(s.link)?.url);
  ctx.report.add('convertido', 'heading', `Título (<${tag}>)`, 'nível, texto e tipografia preservados');
  return {
    type: 'text',
    tagName: tag,
    classes: ['elementor-heading-title', ...classesOf(s)],
    attributes: { id },
    components: link ? [{ type: 'link', attributes: { href: link }, components: html }] : html,
  };
}

function imageWidget(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const img = rec(s.image);
  const src = registerImage(ctx, str(img?.url), 'image');
  const ds = new DeviceStyles(id);
  commonWidgetStyles(ds, s);
  ds.responsive(s, 'align', (v) => ({ 'text-align': str(v) }));
  ctx.rules.push(...ds.rules());
  const imgId = `${id}-img`;
  const ids = new DeviceStyles(imgId);
  ids.set('desktop', { display: 'inline-block', 'max-width': '100%', height: 'auto', 'vertical-align': 'middle' });
  ids.responsive(s, 'width', (v) => ({ width: size(v) }));
  ids.responsive(s, 'space', (v) => ({ 'max-width': size(v) }));
  ids.responsive(s, 'height', (v) => ({ height: size(v) }));
  ids.responsive(s, 'object-fit', (v) => ({ 'object-fit': str(v) }));
  ids.responsive(s, 'image_border_radius', (v) => dims(v, 'border-radius'));
  ctx.rules.push(...ids.rules());
  customCss(ctx, s, id);
  const imageDef: ComponentJson = { type: 'image', attributes: { id: imgId, src: src ?? '', alt: str(img?.alt) ?? '' } };
  const linkTo = str(s.link_to);
  const href = linkTo === 'custom' ? str(rec(s.link)?.url) : linkTo === 'file' ? src : undefined;
  ctx.report.add('convertido', 'image', 'Imagem', 'largura, alinhamento e texto alternativo preservados');
  if (!src) ctx.report.add('nao-suportado', 'image', 'Imagem', 'sem endereço de imagem no ficheiro');
  return { type: 'bolt-container', classes: ['elementor-image', ...classesOf(s)], attributes: { id }, components: [href ? { type: 'bolt-link-box', tagName: 'a', attributes: { href }, components: [imageDef] } : imageDef] };
}

const BUTTON_SIZES: Record<string, Record<string, string>> = {
  xs: { 'font-size': '13px', padding: '10px 20px', 'border-radius': '2px' },
  sm: { 'font-size': '15px', padding: '12px 24px', 'border-radius': '3px' },
  md: { 'font-size': '16px', padding: '15px 30px', 'border-radius': '4px' },
  lg: { 'font-size': '18px', padding: '20px 40px', 'border-radius': '5px' },
  xl: { 'font-size': '20px', padding: '25px 50px', 'border-radius': '6px' },
};

function button(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const wrapperId = makeId(ctx, { ...el, settings: { ...s, _element_id: s._element_id, button_css_id: undefined } });
  const aId = str(s.button_css_id) && !ctx.usedIds.has(String(s.button_css_id)) ? String(s.button_css_id) : `${wrapperId}-btn`;
  ctx.usedIds.add(aId);
  const ds = new DeviceStyles(wrapperId);
  commonWidgetStyles(ds, s);
  ds.responsive(s, 'align', (v) => (str(v) === 'justify' ? {} : { 'text-align': str(v) }));
  ctx.rules.push(...ds.rules());
  const bs = new DeviceStyles(aId);
  bs.set('desktop', {
    display: str(s.align) === 'justify' ? 'block' : 'inline-block',
    'line-height': '1',
    'text-align': 'center',
    'text-decoration': 'none',
    'background-color': str(s.background_color) ?? '#69727d',
    color: str(s.button_text_color) ?? '#ffffff',
    transition: 'all .3s',
    ...BUTTON_SIZES[str(s.size) ?? 'sm'],
  });
  if (!str(s.background_color)) ctx.kitDefaults.add('cores dos botões');
  typography(bs, s, '', ctx.fonts);
  bs.responsive(s, 'text_padding', (v) => dims(v, 'padding'));
  bs.responsive(s, 'border_radius', (v) => dims(v, 'border-radius'));
  if (str(s.button_background_hover_color) || str(s.hover_color)) {
    bs.add({ selectors: [`#${aId}`], state: 'hover', style: { 'background-color': str(s.button_background_hover_color) ?? '', color: str(s.hover_color) ?? '' } });
  }
  ctx.rules.push(...bs.rules());
  customCss(ctx, s, wrapperId);
  const link = rec(s.link);
  const attrs: Record<string, string> = { id: aId, href: str(link?.url) ?? '#' };
  if (link?.is_external === 'on') Object.assign(attrs, { target: '_blank', rel: 'noopener noreferrer' });
  if (link?.nofollow === 'on') attrs.rel = `${attrs.rel ?? ''} nofollow`.trim();
  ctx.report.add('convertido', 'button', 'Botão', str(s.custom_css) ? 'texto, destino e CSS personalizado preservados' : 'texto e destino preservados');
  return {
    type: 'bolt-container',
    classes: ['elementor-button-wrapper', ...classesOf(s)],
    attributes: { id: wrapperId },
    components: [{ type: 'bolt-button', classes: ['elementor-button'], attributes: attrs, components: [{ type: 'textnode', content: str(s.text) ?? 'Clique aqui' }] }],
  };
}

function iconOf(ctx: Ctx, icon: unknown, by: string): { def?: ComponentJson; partial?: string } {
  const o = rec(icon);
  const library = str(o?.library);
  const value = o?.value;
  if (library === 'svg') {
    const url = registerImage(ctx, str(rec(value)?.url), by);
    if (!url) return {};
    return { def: { type: 'image', classes: ['elementor-icon'], attributes: { src: url, alt: '' } } };
  }
  if (str(value)) return { partial: `ícone de biblioteca de fonte («${String(value)}») não incluído: a biblioteca não vem no ficheiro` };
  return {};
}

function iconList(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const inline = str(s.view) === 'inline';
  const ds = new DeviceStyles(id);
  ds.set('desktop', { 'list-style': 'none', margin: '0', padding: '0', display: 'flex', 'flex-direction': inline ? 'row' : 'column', 'flex-wrap': inline ? 'wrap' : undefined });
  commonWidgetStyles(ds, s);
  ds.responsive(s, 'space_between', (v) => ({ gap: size(v) }));
  ctx.rules.push(...ds.rules());
  const li = `#${id} > li`;
  const text = new DeviceStyles(id);
  typography(text, s, 'icon_', ctx.fonts);
  ctx.rules.push(freeRule(li, { display: 'flex', 'align-items': 'center', gap: size(s.icon_spacing) ?? '8px', color: str(s.text_color) ?? 'inherit' }));
  for (const r of text.rules()) ctx.rules.push({ selectors: [], selectorsAdd: `${li} .elementor-icon-list-text`, style: r.style, ...(r.mediaText ? { mediaText: r.mediaText, atRuleType: 'media' } : {}) });
  const iconSize = size(s.icon_size) ?? '14px';
  ctx.rules.push(freeRule(`${li} .elementor-icon`, { width: iconSize, height: iconSize, 'flex-shrink': '0' }));
  let partial = false;
  const list = Array.isArray(s.icon_list) ? s.icon_list : [];
  const items = list.map((raw, i) => {
    const item = rec(raw) ?? {};
    const icon = iconOf(ctx, item.selected_icon, 'icon-list');
    if (icon.partial) {
      partial = true;
      ctx.report.note(`Lista de ícones: ${icon.partial}.`);
    }
    const textDef: ComponentJson = { type: 'text', tagName: 'span', classes: ['elementor-icon-list-text'], components: htmlComponents(str(item.text) ?? '', ctx) };
    const inner = [...(icon.def ? [icon.def] : []), textDef];
    const href = str(rec(item.link)?.url);
    return { type: 'bolt-list-item', attributes: { id: `${id}-i${i}` }, components: href ? [{ type: 'bolt-link-box', tagName: 'a', attributes: { href }, components: inner }] : inner } satisfies ComponentJson;
  });
  if (str(s.icon_color) && list.some((it) => str(rec(rec(it)?.selected_icon)?.library) === 'svg')) {
    ctx.report.note('Lista de ícones: ícones SVG externos são mostrados como imagem; a cor definida no Elementor não se aplica a eles.');
    partial = true;
  }
  customCss(ctx, s, id);
  ctx.report.add(partial ? 'parcial' : 'convertido', 'icon-list', 'Lista (<ul>)', partial ? 'itens e texto preservados; ícones com limitações (ver notas)' : 'itens, ícones e texto preservados');
  return { type: 'bolt-list', classes: ['elementor-icon-list', ...classesOf(s)], attributes: { id }, components: items };
}

function imageBox(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const pos = str(s.position) ?? 'top';
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'flex-direction': pos === 'left' ? 'row' : pos === 'right' ? 'row-reverse' : 'column', 'align-items': pos === 'top' ? 'center' : { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[str(s.content_vertical_alignment) ?? 'top'] ?? 'flex-start', 'text-align': pos === 'top' ? 'center' : 'left' });
  ds.responsive(s, 'image_space', (v) => ({ gap: size(v) }));
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const figId = `${id}-fig`;
  const fs = new DeviceStyles(figId);
  fs.set('desktop', { margin: '0', 'flex-shrink': '0' });
  fs.responsive(s, 'image_size', (v) => ({ width: size(v) }));
  ctx.rules.push(...fs.rules(), freeRule(`#${figId} img`, { width: '100%', height: 'auto', display: 'block' }));
  const title = new DeviceStyles(`${id}-t`);
  title.set('desktop', { margin: '0', color: str(s.title_color) });
  title.responsive(s, 'title_bottom_space', (v) => ({ 'margin-bottom': size(v) }));
  typography(title, s, 'title_', ctx.fonts);
  const desc = new DeviceStyles(`${id}-d`);
  desc.set('desktop', { margin: '0', color: str(s.description_color) });
  typography(desc, s, 'description_', ctx.fonts);
  ctx.rules.push(...title.rules(), ...desc.rules());
  if (str(s.hover_title_color)) ctx.rules.push(freeRule(`#${id}:hover #${id}-t`, { color: String(s.hover_title_color) }));
  const img = rec(s.image);
  const src = registerImage(ctx, str(img?.url), 'image-box');
  const titleTag = /^h[1-6]$|^(div|span|p)$/.test(str(s.title_size) ?? '') ? String(s.title_size) : 'h3';
  customCss(ctx, s, id);
  ctx.report.add('convertido', 'image-box', 'Imagem com título e texto', 'posição, espaçamentos e tipografia convertidos');
  return {
    type: 'bolt-container',
    classes: ['elementor-image-box', ...classesOf(s)],
    attributes: { id },
    components: [
      { type: 'bolt-container', attributes: { id: figId }, components: [{ type: 'image', attributes: { src: src ?? '', alt: str(img?.alt) ?? '' } }] },
      {
        type: 'bolt-container',
        attributes: { id: `${id}-c` },
        components: [
          { type: 'text', tagName: titleTag, attributes: { id: `${id}-t` }, components: htmlComponents(str(s.title_text) ?? '', ctx) },
          { type: 'text', tagName: 'p', attributes: { id: `${id}-d` }, components: htmlComponents(str(s.description_text) ?? '', ctx) },
        ],
      },
    ],
  };
}

function carousel(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  // O widget ocupa a largura do container (o Elementor só a muda com «largura personalizada»).
  // Sem isto, num container em coluna com alinhamento ao centro, o carrossel teria largura 0.
  ds.set('desktop', { width: '100%' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const shows = (k: string) => {
    const n = parseInt(str(s[k]) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const desktop = shows('slides_to_show') ?? 3;
  const laptop = shows('slides_to_show_laptop');
  const breakpoints = [
    { min: 0, perView: shows('slides_to_show_mobile') ?? 1, gap: 0 },
    { min: 768, perView: shows('slides_to_show_tablet') ?? Math.min(2, desktop), gap: 0 },
    { min: 1025, perView: laptop ?? desktop, gap: 0 },
    ...(laptop ? [{ min: 1367, perView: desktop, gap: 0 }] : []),
  ];
  const spacing = str(s.image_spacing) === 'custom' ? parseFloat(size(s.image_spacing_custom) ?? '20') : 0;
  breakpoints.forEach((b) => (b.gap = spacing));
  const nav = str(s.navigation) ?? 'both';
  const autoplay = str(s.autoplay) !== 'no';
  const delay = parseFloat(str(s.autoplay_speed) ?? '5000');
  const css = str(s.custom_css) ?? '';
  const config = {
    breakpoints,
    loop: str(s.infinite) !== 'no',
    speed: parseFloat(str(s.speed) ?? '500'),
    easing: /transition-timing-function\s*:\s*linear/i.test(css) ? 'linear' : 'ease',
    pagination: nav === 'both' || nav === 'dots',
    pauseOnHover: str(s.pause_on_hover) !== 'no',
    // «Direção: direita para a esquerda» inverte o sentido do movimento.
    ...(str(s.direction) === 'rtl' ? { reverse: true } : {}),
    ...(autoplay ? { autoplay: { delay: Number.isFinite(delay) ? delay : 5000 } } : {}),
  };
  const images = Array.isArray(s.carousel) ? s.carousel.map((i) => rec(i)).filter((i): i is Record<string, unknown> => !!i) : [];
  const slides: ComponentJson[] = images.map((img, i) => ({
    type: 'bolt-slide',
    classes: ['swiper-slide'],
    attributes: { id: `${id}-s${i}` },
    components: [{ type: 'image', classes: ['swiper-slide-image'], attributes: { src: registerImage(ctx, str(img.url), 'image-carousel') ?? '', alt: str(img.alt) ?? '' } }],
  }));
  ctx.rules.push(freeRule(`#${id} .swiper-slide-image`, { display: 'block', 'max-width': '100%', height: 'auto', margin: '0 auto' }));
  customCss(ctx, s, id);
  const arrows = nav === 'both' || nav === 'arrows';
  const svg = (d: string): ComponentJson => ({ type: 'svg', attributes: { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 27 44' }, components: [{ type: 'svg-in', tagName: 'path', attributes: { d } }] });
  const summary = `${breakpoints.map((b) => `${b.perView}${b.min ? ` a partir de ${b.min}px` : ''}`).join(', ')} por vista${config.autoplay ? config.autoplay.delay === 0 ? ', movimento contínuo' : `, avança a cada ${config.autoplay.delay} ms` : ''}`;
  ctx.report.add('convertido', 'image-carousel', 'Carrossel do Bolt', `funcional (${summary})`);
  return {
    type: 'bolt-carousel',
    classes: ['swiper', 'elementor-image-carousel', ...classesOf(s)],
    attributes: { id, 'data-bolt-carousel': JSON.stringify(config), 'aria-label': str(s.carousel_name) ?? 'Carrossel de imagens' },
    components: [
      { type: 'bolt-carousel-track', classes: ['swiper-wrapper'], components: slides },
      ...(config.pagination ? [{ type: 'bolt-carousel-pagination', classes: ['swiper-pagination'] } satisfies ComponentJson] : []),
      ...(arrows
        ? [
            { type: 'bolt-carousel-prev', attributes: { role: 'button', tabindex: '0', 'aria-label': 'Slide anterior' }, components: [svg('M0,22L22,0l2.1,2.1L4.2,22l19.9,19.9L22,44L0,22L0,22L0,22z')] } satisfies ComponentJson,
            { type: 'bolt-carousel-next', attributes: { role: 'button', tabindex: '0', 'aria-label': 'Slide seguinte' }, components: [svg('M27,22L27,22L5,44l-2.1-2.1L22.8,22L2.9,2.1L5,0L27,22L27,22z')] } satisfies ComponentJson,
          ]
        : []),
    ],
  };
}

function accordion(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'flex-direction': 'column' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const items = Array.isArray(s.items) ? s.items.map((i) => rec(i) ?? {}) : [];
  const border = str(s.accordion_border_normal_border);
  const itemSel = `#${id} > details`;
  ctx.rules.push(
    freeRule(itemSel, compactStyleRecord({ 'border-style': border, 'border-color': str(s.accordion_border_normal_color), ...dims(s.accordion_border_normal_width, 'border-width') })),
    freeRule(`${itemSel} > summary`, compactStyleRecord({ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: size(s.icon_spacing) ?? '10px', cursor: 'pointer', 'list-style': 'none', color: str(s.normal_title_color), ...dims(s.accordion_padding, 'padding') })),
    freeRule(`${itemSel} > summary::-webkit-details-marker`, { display: 'none' }),
  );
  const titleTypo = new DeviceStyles(id);
  typography(titleTypo, s, 'title_', ctx.fonts);
  for (const r of titleTypo.rules()) ctx.rules.push({ selectors: [], selectorsAdd: `${itemSel} > summary`, style: r.style, ...(r.mediaText ? { mediaText: r.mediaText, atRuleType: 'media' } : {}) });
  if (str(s.hover_title_color)) ctx.rules.push(freeRule(`${itemSel} > summary:hover`, { color: String(s.hover_title_color) }));
  if (str(s.active_title_color)) ctx.rules.push(freeRule(`${itemSel}[open] > summary`, { color: String(s.active_title_color) }));
  ctx.rules.push(freeRule(`${itemSel}[open] > summary .bolt-icon-closed`, { display: 'none' }), freeRule(`${itemSel}:not([open]) > summary .bolt-icon-opened`, { display: 'none' }));
  const closed = iconOf(ctx, s.accordion_item_title_icon, 'nested-accordion (ícone)');
  const opened = iconOf(ctx, s.accordion_item_title_icon_active, 'nested-accordion (ícone)');
  const expandFirst = str(s.default_state) === 'expanded';
  const children = el.elements;
  const details: ComponentJson[] = items.map((item, i) => {
    const content = children[i] ? element(children[i], ctx, false) : undefined;
    const icons = [
      ...(closed.def ? [{ ...closed.def, classes: ['bolt-icon-closed'] }] : []),
      ...(opened.def ? [{ ...opened.def, classes: ['bolt-icon-opened'] }] : []),
    ];
    return {
      type: 'bolt-accordion-item',
      attributes: { id: `${id}-i${i}`, ...(expandFirst && i === 0 ? { open: '' } : {}) },
      components: [
        { type: 'bolt-accordion-title', tagName: 'summary', attributes: { id: `${id}-t${i}` }, components: [{ type: 'text', tagName: 'span', components: htmlComponents(str(item.item_title) ?? '', ctx) }, ...icons] },
        ...(content ? [content] : []),
      ],
    };
  });
  customCss(ctx, s, id);
  ctx.report.add('convertido', 'nested-accordion', 'Acordeão (<details>/<summary>)', 'abre e fecha sem JavaScript; títulos e conteúdos editáveis');
  return { type: 'bolt-accordion', classes: ['elementor-accordion', ...classesOf(s)], attributes: { id }, components: details };
}

function compactStyleRecord(style: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) if (v) out[k] = v;
  return out;
}

function htmlWidget(el: EElement, ctx: Ctx): ComponentJson | undefined {
  const s = el.settings;
  const id = makeId(ctx, el);
  const html = htmlComponents(str(s.html) ?? '', ctx).trim();
  if (!html) {
    ctx.report.add('parcial', 'html', 'CSS global', 'só continha <style>: aplicado como CSS da página; nenhum elemento visível');
    return undefined;
  }
  ctx.report.add('parcial', 'html', 'Bloco HTML (sanitizado)', 'HTML preservado sem scripts nem manipuladores de eventos; editável como conteúdo');
  return { type: 'bolt-container', classes: ['elementor-html'], attributes: { id }, components: html };
}

/** Regras de um DeviceStyles para um seletor descendente (`#id …`). */
function pushScoped(ctx: Ctx, ds: DeviceStyles, selector: string): void {
  for (const r of ds.rules()) ctx.rules.push({ selectors: [], selectorsAdd: selector, style: r.style, ...(r.mediaText ? { mediaText: r.mediaText, atRuleType: 'media' } : {}) });
}

/** Tipografia com chaves «typography_<parte>_…» (ex.: contador) no formato «<prefixo>typography_…». */
function remapTypography(s: Record<string, unknown>, part: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const from = `typography_${part}_`;
  for (const [k, v] of Object.entries(s)) if (k.startsWith(from)) out[`${part}_typography_${k.slice(from.length)}`] = v;
  return out;
}

/** Divisor: linha com cor, espessura, largura e alinhamento; o espaço vertical vem de «gap». */
function divider(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'padding-top': size(s.gap) ?? '15px', 'padding-bottom': size(s.gap) ?? '15px' });
  commonWidgetStyles(ds, s);
  const align = str(s.align);
  ds.set('desktop', { 'justify-content': align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' });
  ctx.rules.push(...ds.rules());
  const sep = new DeviceStyles(`${id}-sep`);
  sep.set('desktop', { 'border-top-style': str(s.style) ?? 'solid', 'border-top-width': size(s.weight) ?? '1px', 'border-top-color': str(s.color) ?? '#000000', width: '100%' });
  sep.responsive(s, 'width', (v) => ({ width: size(v) }));
  ctx.rules.push(...sep.rules());
  customCss(ctx, s, id);
  ctx.report.add('convertido', 'divider', 'Divisor (linha)', 'cor, espessura, largura, alinhamento e espaço preservados');
  return { type: 'bolt-container', classes: ['elementor-divider', ...classesOf(s)], attributes: { id }, components: [{ type: 'bolt-container', classes: ['elementor-divider-separator'], attributes: { id: `${id}-sep` } }] };
}

/** Espaçador: bloco vazio com a altura indicada (por omissão 50px, como no Elementor). */
function spacer(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.set('desktop', { height: size(s.space) ?? '50px' });
  ds.responsive(s, 'space', (v) => ({ height: size(v) }));
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  ctx.report.add('convertido', 'spacer', 'Espaço vertical', 'altura preservada (por dispositivo)');
  return { type: 'bolt-container', classes: ['elementor-spacer', ...classesOf(s)], attributes: { id } };
}

/** Testemunho: texto, imagem, nome e cargo, com tipografia e cores. */
function testimonial(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const align = str(s.testimonial_alignment) ?? 'center';
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'flex-direction': 'column', gap: '16px', 'text-align': align, 'align-items': align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const content = new DeviceStyles(id);
  content.set('desktop', { color: str(s.content_content_color) });
  typography(content, s, 'content_', ctx.fonts);
  pushScoped(ctx, content, `#${id} .elementor-testimonial-content`);
  const name = new DeviceStyles(id);
  name.set('desktop', { color: str(s.name_text_color), 'font-weight': '700' });
  typography(name, s, 'name_', ctx.fonts);
  pushScoped(ctx, name, `#${id} .elementor-testimonial-name`);
  const job = new DeviceStyles(id);
  job.set('desktop', { color: str(s.job_text_color) });
  typography(job, s, 'job_', ctx.fonts);
  pushScoped(ctx, job, `#${id} .elementor-testimonial-job`);
  const img = rec(s.testimonial_image);
  const src = registerImage(ctx, str(img?.url), 'testimonial');
  const imgSize = size(s.image_size) ?? '60px';
  ctx.rules.push(
    freeRule(`#${id} .elementor-testimonial-image`, compactStyleRecord({ width: imgSize, height: imgSize, 'border-radius': '50%', 'object-fit': 'cover', 'border-style': str(s.image_border_border), 'border-color': str(s.image_border_color), ...dims(s.image_border_width, 'border-width') })),
    freeRule(`#${id} .elementor-testimonial-meta`, { display: 'flex', 'align-items': 'center', gap: '12px' }),
    freeRule(`#${id} .elementor-testimonial-details`, { display: 'flex', 'flex-direction': 'column', 'text-align': 'left' }),
  );
  customCss(ctx, s, id);
  const details: ComponentJson[] = [
    ...(str(s.testimonial_name) ? [{ type: 'text', tagName: 'div', classes: ['elementor-testimonial-name'], components: htmlComponents(str(s.testimonial_name) ?? '', ctx) }] : []),
    ...(str(s.testimonial_job) ? [{ type: 'text', tagName: 'div', classes: ['elementor-testimonial-job'], components: htmlComponents(str(s.testimonial_job) ?? '', ctx) }] : []),
  ];
  ctx.report.add('convertido', 'testimonial', 'Testemunho (texto, imagem, nome e cargo)', 'conteúdo, tipografia e cores preservados');
  return {
    type: 'bolt-container',
    classes: ['elementor-testimonial', ...classesOf(s)],
    attributes: { id },
    components: [
      { type: 'text', tagName: 'div', classes: ['elementor-testimonial-content'], components: htmlComponents(str(s.testimonial_content) ?? '', ctx) },
      {
        type: 'bolt-container',
        classes: ['elementor-testimonial-meta'],
        components: [
          ...(src ? [{ type: 'image', classes: ['elementor-testimonial-image'], attributes: { src, alt: str(s.testimonial_name) ?? '' } }] : []),
          { type: 'bolt-container', classes: ['elementor-testimonial-details'], components: details },
        ],
      },
    ],
  };
}

/** Contador: número final (sem animação), prefixo, sufixo e título. */
function counter(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'text-align': 'center' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const num = new DeviceStyles(id);
  num.set('desktop', { color: str(s.number_color), 'line-height': '1' });
  typography(num, remapTypography(s, 'number'), 'number_', ctx.fonts);
  pushScoped(ctx, num, `#${id} .elementor-counter-number`);
  const title = new DeviceStyles(id);
  title.set('desktop', { color: str(s.title_color) });
  typography(title, remapTypography(s, 'title'), 'title_', ctx.fonts);
  pushScoped(ctx, title, `#${id} .elementor-counter-title`);
  customCss(ctx, s, id);
  const value = `${str(s.prefix) ?? ''}${str(s.ending_number) ?? '100'}${str(s.suffix) ?? ''}`;
  ctx.report.add('parcial', 'counter', 'Número (texto)', 'número final, prefixo, sufixo e título preservados; sem a animação de contagem');
  return {
    type: 'bolt-container',
    classes: ['elementor-counter', ...classesOf(s)],
    attributes: { id },
    components: [
      { type: 'text', tagName: 'div', classes: ['elementor-counter-number'], components: [{ type: 'textnode', content: value }] },
      ...(str(s.title) ? [{ type: 'text', tagName: 'div', classes: ['elementor-counter-title'], components: htmlComponents(str(s.title) ?? '', ctx) }] : []),
    ],
  };
}

/**
 * Vídeo: a imagem de capa (ou um bloco escuro) com o botão ▶ e uma ligação para o vídeo. Sem
 * iframe de terceiros (a política de segurança das páginas só permite mapas incorporados).
 */
function video(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const type = str(s.video_type) ?? 'youtube';
  const url = str(type === 'vimeo' ? s.vimeo_url : type === 'dailymotion' ? s.dailymotion_url : type === 'hosted' ? rec(s.hosted_url)?.url : s.youtube_url);
  const cover = registerImage(ctx, str(rec(s.image_overlay)?.url), 'video (capa)');
  const ds = new DeviceStyles(id);
  ds.set('desktop', { position: 'relative', 'aspect-ratio': '16 / 9', overflow: 'hidden', 'background-color': '#000000' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  ctx.rules.push(
    freeRule(`#${id} .elementor-video-cover`, { width: '100%', height: '100%', 'object-fit': 'cover', display: 'block' }),
    freeRule(`#${id} .elementor-video-play`, compactStyleRecord({ position: 'absolute', inset: '0', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: str(s.play_icon_color) ?? '#ffffff', 'font-size': size(s.play_icon_size) ?? '72px', 'text-decoration': 'none', 'text-shadow': '0 2px 12px rgba(0,0,0,.5)' })),
  );
  customCss(ctx, s, id);
  ctx.report.add('parcial', 'video', 'Vídeo (capa com ligação)', url ? `capa e ligação para o vídeo (${type}) preservadas; o vídeo abre no site de origem` : 'sem endereço de vídeo no ficheiro');
  const play: ComponentJson = { type: 'link', classes: ['elementor-video-play'], attributes: { href: url ?? '#', target: '_blank', rel: 'noopener noreferrer', title: 'Ver o vídeo' }, components: [{ type: 'textnode', content: '▶' }] };
  return {
    type: 'bolt-container',
    classes: ['elementor-video', ...classesOf(s)],
    attributes: { id },
    components: [...(cover ? [{ type: 'image', classes: ['elementor-video-cover'], attributes: { src: cover, alt: 'Capa do vídeo' } }] : []), play],
  };
}

/** Ícone: SVG externo como imagem; ícones de biblioteca de fonte não vêm no ficheiro. */
function iconWidget(el: EElement, ctx: Ctx): ComponentJson | undefined {
  const s = el.settings;
  const icon = iconOf(ctx, s.selected_icon, 'icon');
  if (!icon.def) {
    ctx.report.add('parcial', 'icon', '—', icon.partial ?? 'ícone sem ficheiro: não importado');
    return undefined;
  }
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.responsive(s, 'align', (v) => ({ 'text-align': str(v) }));
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules(), freeRule(`#${id} .elementor-icon`, { width: size(s.size) ?? '50px', height: size(s.size) ?? '50px' }));
  customCss(ctx, s, id);
  ctx.report.add('convertido', 'icon', 'Ícone (imagem SVG)', 'ícone SVG preservado como imagem');
  return { type: 'bolt-container', classes: ['elementor-icon-wrapper', ...classesOf(s)], attributes: { id }, components: [icon.def] };
}

/** Acordeão clássico («accordion»: separadores com título e HTML) → <details>/<summary>. */
function classicAccordion(el: EElement, ctx: Ctx): ComponentJson {
  const s = el.settings;
  const id = makeId(ctx, el);
  const ds = new DeviceStyles(id);
  ds.set('desktop', { display: 'flex', 'flex-direction': 'column' });
  commonWidgetStyles(ds, s);
  ctx.rules.push(...ds.rules());
  const itemSel = `#${id} > details`;
  ctx.rules.push(
    freeRule(itemSel, compactStyleRecord({ 'border-style': size(s.border_width) ? 'solid' : undefined, 'border-width': size(s.border_width), 'border-color': str(s.border_color) })),
    freeRule(`${itemSel} > summary`, compactStyleRecord({ cursor: 'pointer', 'list-style': 'none', margin: '0', 'background-color': str(s.title_background), color: str(s.title_color), ...dims(s.title_padding, 'padding') })),
    freeRule(`${itemSel} > summary::-webkit-details-marker`, { display: 'none' }),
    freeRule(`${itemSel} > summary > *`, { margin: '0', font: 'inherit', color: 'inherit' }),
    freeRule(`${itemSel} > .elementor-tab-content`, compactStyleRecord({ color: str(s.content_color), ...dims(s.content_padding, 'padding') })),
  );
  if (str(s.tab_active_color)) ctx.rules.push(freeRule(`${itemSel}[open] > summary`, { color: String(s.tab_active_color) }));
  const title = new DeviceStyles(id);
  typography(title, s, 'title_', ctx.fonts);
  pushScoped(ctx, title, `${itemSel} > summary`);
  const content = new DeviceStyles(id);
  typography(content, s, 'content_', ctx.fonts);
  pushScoped(ctx, content, `${itemSel} > .elementor-tab-content`);
  customCss(ctx, s, id);
  const tag = /^(h[1-6]|div|span|p)$/.test(str(s.title_html_tag) ?? '') ? String(s.title_html_tag) : 'div';
  const tabs = Array.isArray(s.tabs) ? s.tabs.map((t) => rec(t) ?? {}) : [];
  ctx.report.add('convertido', 'accordion', 'Acordeão (<details>/<summary>)', `${tabs.length} separadores; abre e fecha sem JavaScript`);
  return {
    type: 'bolt-accordion',
    classes: ['elementor-accordion', ...classesOf(s)],
    attributes: { id },
    components: tabs.map((t, i) => ({
      type: 'bolt-accordion-item',
      attributes: { id: `${id}-i${i}` },
      components: [
        { type: 'bolt-accordion-title', tagName: 'summary', attributes: { id: `${id}-t${i}` }, components: [{ type: 'text', tagName: tag, components: htmlComponents(str(t.tab_title) ?? '', ctx) }] },
        { type: 'text', tagName: 'div', classes: ['elementor-tab-content'], components: htmlComponents(str(t.tab_content) ?? '', ctx) },
      ],
    })),
  };
}

const VERTICAL: Record<string, string> = { top: 'flex-start', middle: 'center', center: 'center', bottom: 'flex-end' };

/**
 * Secções e colunas CLÁSSICAS do Elementor nas chaves dos containers (08/10/2026, «3 Página de
 * venda MKT.json»: sem isto, o topo «altura do ecrã» ficava baixo e um botão com margem −180px de
 * uma secção seguinte sobrepunha-se ao conteúdo).
 *  - secção: `height` full → min-height 100vh; `min-height` + `custom_height` (e `height_inner` +
 *    `custom_height_inner` nas interiores) → min-height; `content_position` → alinhamento vertical
 *    das colunas; `layout` full_width/boxed e `content_width` (largura da caixa); no telemóvel as
 *    colunas empilham (como no Elementor);
 *  - coluna: largura `_inline_size` (ou `_column_size`) em %, `content_position` → alinhamento
 *    vertical do conteúdo; 100% no telemóvel.
 */
function classicSettings(el: EElement): Record<string, unknown> {
  const s = el.settings;
  if (el.elType === 'column') {
    const width = str(s._inline_size) ?? str(s._column_size);
    const vertical = VERTICAL[str(s.content_position) ?? ''];
    return {
      ...s,
      flex_direction: 'column',
      content_width: 'full',
      ...(width ? { width: { unit: '%', size: width }, width_mobile: { unit: '%', size: '100' } } : {}),
      ...(vertical && !s.flex_justify_content ? { flex_justify_content: vertical } : {}),
      // «Widgets Space» por omissão do Elementor clássico: 20px entre widgets de uma coluna.
      flex_gap: s.flex_gap ?? { unit: 'px', size: '20', column: '20', row: '20' },
    };
  }
  const height = str(s.height) ?? str(s.height_inner);
  const custom = s.custom_height ?? s.custom_height_inner;
  const minHeight = height === 'full' ? { unit: 'vh', size: '100' } : height === 'min-height' && custom ? custom : undefined;
  const vertical = VERTICAL[str(s.content_position) ?? ''];
  return {
    ...s,
    flex_direction: 'row',
    flex_direction_mobile: s.flex_direction_mobile ?? 'column',
    content_width: str(s.layout) === 'full_width' ? 'full' : 'boxed',
    ...(rec(s.content_width) ? { boxed_width: s.content_width } : {}),
    ...(minHeight && !s.min_height ? { min_height: minHeight } : {}),
    ...(vertical && !s.flex_align_items ? { flex_align_items: vertical } : {}),
    flex_gap: s.flex_gap ?? { unit: 'px', size: '0', column: '0', row: '0' },
  };
}

function element(el: EElement, ctx: Ctx, parentRow: boolean): ComponentJson | undefined {
  note3rd(ctx, el.settings);
  if (el.elType === 'container') return container(el, ctx, parentRow);
  if (el.elType === 'section' || el.elType === 'column') {
    ctx.report.add('convertido', el.elType, 'Contentor', el.elType === 'section' ? 'secção clássica: altura, posição do conteúdo e largura convertidas; colunas empilham no telemóvel' : 'coluna clássica: largura e alinhamento convertidos; 100% no telemóvel');
    return container({ ...el, settings: classicSettings(el) }, ctx, parentRow);
  }
  if (el.elType !== 'widget') {
    ctx.report.add('nao-suportado', el.elType ?? 'desconhecido', '—', 'tipo de elemento desconhecido: ignorado');
    return undefined;
  }
  switch (el.widgetType) {
    case 'heading':
      return heading(el, ctx);
    case 'text-editor':
      return textWidget(el, ctx);
    case 'image':
      return imageWidget(el, ctx);
    case 'button':
      return button(el, ctx);
    case 'icon-list':
      return iconList(el, ctx);
    case 'image-box':
      return imageBox(el, ctx);
    case 'image-carousel':
      return carousel(el, ctx);
    case 'nested-accordion':
      return accordion(el, ctx);
    case 'html':
      return htmlWidget(el, ctx);
    case 'divider':
      return divider(el, ctx);
    case 'spacer':
      return spacer(el, ctx);
    case 'testimonial':
      return testimonial(el, ctx);
    case 'counter':
      return counter(el, ctx);
    case 'video':
      return video(el, ctx);
    case 'icon':
      return iconWidget(el, ctx);
    case 'accordion':
      return classicAccordion(el, ctx);
    default: {
      ctx.report.add('nao-suportado', `widget:${el.widgetType ?? '?'}`, '—', 'widget sem adaptador: não importado');
      return undefined;
    }
  }
}

export interface ElementorFontRequest {
  family: string;
  weights: string[];
}

export interface ElementorResult extends AdapterResult {
  /** Fontes usadas (sem ficheiros no JSON): resolvidas pelo pipeline no Google Fonts. */
  fontRequests: ElementorFontRequest[];
}

export function convertElementor(raw: unknown, fileName: string, fileSize: number): ElementorResult {
  const parsed = elementorDocumentSchema.safeParse(raw);
  if (!parsed.success) throw new Error('O ficheiro não tem a estrutura de um modelo Elementor (content › elementos).');
  const doc = parsed.data;
  const report = new ReportBuilder();
  const ctx: Ctx = { report, rules: [], fonts: new Map(), images: new Map(), usedIds: new Set(), thirdPartySettings: new Map(), kitDefaults: new Set() };

  // Página: definições de página aplicadas a um contentor raiz.
  const ps = rec(doc.page_settings) ?? {};
  const pageId = 'elementor-page';
  ctx.usedIds.add(pageId);
  const pds = new DeviceStyles(pageId);
  pds.responsive(ps, 'padding', (v) => dims(v, 'padding'));
  for (const url of background(pds, ps)) registerImage(ctx, url, 'página (fundo)');
  ctx.rules.push(...pds.rules());

  const content = doc.content.map((el) => element(el, ctx, false)).filter((c): c is ComponentJson => !!c);
  const wrapper: ComponentJson = {
    type: 'wrapper',
    attributes: { id: 'elementor-body' },
    components: [{ type: 'bolt-container', classes: ['elementor-page'], attributes: { id: pageId }, components: content }],
  };

  // Base do Elementor/tema que o ficheiro não inclui mas de que a página depende.
  const base: StyleJson[] = [
    freeRule('*', { 'box-sizing': 'border-box' }),
    freeRule('body', { margin: '0', 'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', 'line-height': '1.5', color: '#333333' }),
    freeRule('img', { 'max-width': '100%', height: 'auto' }),
    freeRule('a', { color: 'inherit' }),
  ];

  if (ctx.kitDefaults.size) {
    report.note(`O ficheiro não inclui o «kit» de estilos globais do site Elementor. Onde o modelo não define ${[...ctx.kitDefaults].join(', ')}, usam-se as predefinições do Elementor (ex.: botões cinzentos), que podem diferir do site original.`);
  }
  if (ctx.thirdPartySettings.size) {
    report.note(`Definições de extensões de terceiros ignoradas (sem equivalente no Bolt): ${[...ctx.thirdPartySettings.entries()].map(([k, n]) => `${k}* (${n})`).join(', ')}.`);
  }
  report.note('Breakpoints do Elementor preservados (portátil ≤1366px, tablet ≤1024px, telemóvel ≤767px). No editor do Bolt, as edições feitas em «tablet»/«telemóvel» usam os breakpoints do Bolt (992px/480px).');

  const projectData: RawProjectData = {
    assets: [],
    styles: [...base, ...ctx.rules],
    pages: [{ id: 'elementor', frames: [{ component: wrapper }] }],
    symbols: [],
    dataSources: [],
  };

  return {
    projectData,
    suggestedName: (doc.title ?? fileName).replace(/^\[[^\]]*\]\s*/g, '').replace(/\.[^.]+$/, '') || 'Página Elementor',
    fontRequests: [...ctx.fonts.entries()].map(([family, weights]) => ({ family, weights: [...weights].sort() })),
    report: {
      format: 'elementor',
      formatLabel: `Elementor (modelo JSON, versão ${doc.version ?? '?'})`,
      fileName,
      fileSize,
      items: report.items(),
      assets: [...ctx.images.entries()].map(([url, by]) => ({ url, status: 'pendente', usedBy: [...by] })),
      fonts: [],
      notes: report.notes,
      removed: report.removed,
      totals: report.totals(),
    },
  };
}
