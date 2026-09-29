import type { GrapesProjectData } from '../../contract/boltDocument';
import { fontFaceRule, freeRule, type StyleJson } from '../css';
import { sanitizeComponent, type ComponentJson } from '../sanitize';
import { ReportBuilder, type AdapterResult, type FontEntry, type RawProjectData } from '../types';

/**
 * Adaptador GrapesJS (Core e Studio). O documento já é JSON do motor: os tipos do Core
 * mantêm-se; os tipos do Studio que o Core não conhece são convertidos para tipos Bolt com o
 * elemento HTML adequado, preservando classes, atributos, ordem e filhos (e portanto o CSS e o
 * layout flex originais). O reconhecimento é estrutural: nunca depende de textos ou ids.
 */

interface StudioFontVariant {
  family?: string;
  variant?: string;
  source?: string;
}
interface StudioFont {
  family?: string;
  variants?: Record<string, StudioFontVariant>;
}

const CORE_TYPES = new Set(['wrapper', 'text', 'textnode', 'image', 'link', 'svg', 'svg-in', 'default', 'video', 'map', 'label', 'table', 'row', 'cell', 'thead', 'tbody', 'tfoot', 'comment', 'iframe', 'head']);
const DROPPED_PROPS = ['onActive', 'snap', 'snap-divisions', 'collectionId', 'iconId'];

/** Predefinições do carrossel do Studio (plugin swiperComponent 1.0.30). */
const SWIPER_DEFAULTS = { slidesPerView: 1, spaceBetween: 0, mobileBreakpoint: 460, tabletBreakpoint: 991, speed: 300, autoplayDelay: 3000 };

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const classNames = (c: ComponentJson): string[] =>
  (c.classes ?? []).map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : '')).filter(Boolean);

const idOf = (c: ComponentJson): string | undefined => (typeof c.attributes?.id === 'string' ? c.attributes.id : undefined);

export function isGrapesJsProject(value: unknown): value is GrapesProjectData {
  if (!value || typeof value !== 'object') return false;
  const pages = (value as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.some((p) => p && typeof p === 'object' && Array.isArray((p as { frames?: unknown }).frames));
}

export function isStudioProject(value: unknown): boolean {
  if (!isGrapesJsProject(value)) return false;
  const custom = (value as { custom?: Record<string, unknown> }).custom;
  return !!custom && ('projectType' in custom || 'plugins' in custom || 'globalPageSettings' in custom);
}

/** Converte variantes de fontes do Studio («700italic», «regular») em @font-face. */
function fontFaces(fonts: Record<string, StudioFont>, report: FontEntry[]): StyleJson[] {
  const rules: StyleJson[] = [];
  for (const [key, font] of Object.entries(fonts)) {
    const family = font.family ?? key;
    let count = 0;
    for (const [name, v] of Object.entries(font.variants ?? {})) {
      if (!v.source || !/^https:\/\//.test(v.source)) continue;
      const italic = /italic/.test(name);
      const weight = name === 'regular' || name === 'italic' ? '400' : name.replace('italic', '') || '400';
      rules.push(fontFaceRule({ 'font-family': `"${family}"`, 'font-style': italic ? 'italic' : 'normal', 'font-weight': weight, 'font-display': 'swap', src: `url(${v.source}) format("woff2")` }));
      count += 1;
    }
    const host = Object.values(font.variants ?? {}).map((v) => v.source ?? '').find(Boolean) ?? '';
    const google = host.includes('fonts.gstatic.com');
    report.push({
      family,
      source: google ? 'Google Fonts (fonts.gstatic.com)' : host ? new URL(host).host : 'desconhecida',
      license: google ? 'Licença aberta do Google Fonts (SIL OFL 1.1 ou Apache 2.0)' : 'Por verificar',
      status: count ? 'carregada' : 'nao-carregada',
      detail: count ? `${count} variantes declaradas como @font-face` : 'sem ficheiros de fonte no projeto',
    });
  }
  return rules;
}

interface Ctx {
  report: ReportBuilder;
  styles: StyleJson[];
  sourceStyles: StyleJson[];
  headingsWithoutTag: string[];
  menus: number;
  carousels: number;
}

function carouselConfig(c: ComponentJson, hasPagination: boolean): { config: Record<string, unknown>; summary: string } {
  const p = c as Record<string, unknown>;
  const breakpoints: Array<{ min: number; perView: number; gap: number }> = [
    { min: 0, perView: num(p.slidesPerView, SWIPER_DEFAULTS.slidesPerView), gap: num(p.spaceBetween, SWIPER_DEFAULTS.spaceBetween) },
  ];
  if (p.mobile) breakpoints.push({ min: num(p.mobileBreakpoint, SWIPER_DEFAULTS.mobileBreakpoint), perView: num(p.mobileSlidesPerView, 1), gap: num(p.mobileSpaceBetween, 0) });
  if (p.tablet) breakpoints.push({ min: num(p.tabletBreakpoint, SWIPER_DEFAULTS.tabletBreakpoint), perView: num(p.tabletSlidesPerView, 1), gap: num(p.tabletSpaceBetween, 0) });
  const config = {
    breakpoints,
    loop: !!p.loop,
    speed: num(p.speed, SWIPER_DEFAULTS.speed),
    pagination: hasPagination,
    ...(p.autoplay ? { autoplay: { delay: num(p.autoplayDelay, SWIPER_DEFAULTS.autoplayDelay) } } : {}),
  };
  const summary = breakpoints.map((b) => `${b.perView} por vista${b.min ? ` a partir de ${b.min}px` : ''}`).join(', ') + (p.loop ? ', em ciclo' : '');
  return { config, summary };
}

function strip(c: ComponentJson, props: string[]): ComponentJson {
  return Object.fromEntries(Object.entries(c).filter(([k]) => !props.includes(k)));
}

function withType(c: ComponentJson, type: string, extra: Partial<ComponentJson> = {}): ComponentJson {
  const attrs = { ...(c.attributes ?? {}) };
  return { ...strip(c, DROPPED_PROPS), type, ...extra, attributes: { ...attrs, ...(extra.attributes ?? {}) } };
}

/** Regras de origem que escondem um elemento (display:none) dentro de um media query. */
function hiddenIn(sourceStyles: StyleJson[], el: ComponentJson): string | undefined {
  const id = idOf(el);
  const cls = classNames(el);
  const hit = sourceStyles.find(
    (s) => s.mediaText && s.style?.display === 'none' && (s.selectors ?? []).some((sel) => (id && sel === `#${id}`) || cls.includes(String(sel))),
  );
  return hit?.mediaText;
}

function convert(c: ComponentJson, ctx: Ctx, parents: ComponentJson[]): ComponentJson {
  const type = c.type ?? 'default';
  const kids = (list: ComponentJson[] | string | undefined, self: ComponentJson): ComponentJson[] | string | undefined =>
    Array.isArray(list) ? list.map((ch) => convert(ch, ctx, [...parents, self])) : list;
  const r = ctx.report;
  let out: ComponentJson;

  switch (type) {
    case 'heading': {
      const tag = typeof c.tagName === 'string' && /^h[1-6]$/i.test(c.tagName) ? c.tagName.toLowerCase() : undefined;
      if (tag) r.add('convertido', 'heading', `Título (<${tag}>)`, 'nível preservado');
      else {
        ctx.headingsWithoutTag.push(parents.map((p) => p.type ?? 'bloco').slice(-3).join(' › '));
        r.add('parcial', 'heading', 'Título (<h1>)', 'sem nível no ficheiro: aplicado o padrão do tipo «heading» do Studio (h1); revisto no relatório');
      }
      out = withType(c, 'text', { tagName: tag ?? 'h1' });
      break;
    }
    case 'section':
      r.add('convertido', 'section', 'Secção (<section>)', 'elemento semântico; classes e estilos preservados');
      out = withType(c, 'bolt-section', { tagName: 'section' });
      break;
    case 'container':
      r.add('convertido', 'container', 'Contentor (<div>)', 'classes e estilos preservados');
      out = withType(c, 'bolt-container');
      break;
    case 'flex-row':
      r.add('convertido', 'flex-row', 'Linha (<div>, flex original)', 'layout flex e divisões preservados; nenhum estilo acrescentado');
      out = withType(c, 'bolt-row');
      break;
    case 'flex-column':
      r.add('convertido', 'flex-column', 'Coluna (<div>, flex original)', 'layout flex preservado; nenhum estilo acrescentado');
      out = withType(c, 'bolt-col');
      break;
    case 'linkBox':
      r.add('convertido', 'linkBox', 'Bloco de ligação (<a>)', 'destino e conteúdo preservados; a ligação volta a funcionar');
      out = withType(c, 'bolt-link-box', { tagName: 'a' });
      break;
    case 'icon':
      r.add('convertido', 'icon', 'Ícone (SVG embutido)', 'SVG preservado; a ligação ao catálogo de ícones do Studio não é mantida');
      out = withType(c, 'bolt-icon');
      break;
    case 'navbar': {
      ctx.menus += 1;
      r.add('convertido', 'navbar', 'Menu (<nav>)', 'versão móvel funcional pelo runtime do Bolt');
      out = withType(c, 'bolt-menu', { tagName: 'nav' });
      break;
    }
    case 'navbar-container':
      r.add('convertido', 'navbar-container', 'Contentor do menu', 'classes preservadas');
      out = withType(c, 'bolt-container');
      break;
    case 'navbar-burger-menu':
      r.add('convertido', 'navbar-burger-menu', 'Botão do menu', 'abre e fecha o menu móvel (clique, Enter ou Espaço)');
      out = withType(c, 'bolt-menu-toggle', { attributes: { role: 'button', tabindex: '0', 'aria-label': 'Abrir menu', 'aria-expanded': 'false' } });
      break;
    case 'navbar-nav-menu':
      r.add('convertido', 'navbar-nav-menu', 'Lista de ligações do menu', 'ligações preservadas');
      out = withType(c, 'bolt-container');
      break;
    case 'swiper': {
      ctx.carousels += 1;
      const children = Array.isArray(c.components) ? c.components : [];
      const { config, summary } = carouselConfig(c, children.some((ch) => ch.type === 'swiper-pagination'));
      r.add('convertido', 'swiper', 'Carrossel do Bolt', `funcional sem o script do Studio (${summary})`);
      const clean = strip(c, ['mobile', 'tablet', 'mobileSlidesPerView', 'tabletSlidesPerView', 'mobileSpaceBetween', 'tabletSpaceBetween', 'slidesPerView', 'spaceBetween', 'loop', 'speed', 'autoplay', 'autoplayDelay', 'mobileBreakpoint', 'tabletBreakpoint']);
      out = withType(clean, 'bolt-carousel', { attributes: { 'data-bolt-carousel': JSON.stringify(config) } });
      break;
    }
    case 'swiper-wrapper':
      out = withType(c, 'bolt-carousel-track');
      r.add('convertido', 'swiper-wrapper', 'Faixa de slides', 'ordem dos slides preservada');
      break;
    case 'swiper-slide':
      out = withType(c, 'bolt-slide');
      r.add('convertido', 'swiper-slide', 'Slide', 'conteúdo editável');
      break;
    case 'swiper-pagination':
      out = withType(c, 'bolt-carousel-pagination');
      r.add('convertido', 'swiper-pagination', 'Paginação do carrossel', 'pontos clicáveis');
      break;
    case 'swiper-nav-prev':
    case 'swiper-nav-next':
      out = withType(c, type === 'swiper-nav-prev' ? 'bolt-carousel-prev' : 'bolt-carousel-next', {
        attributes: { role: 'button', tabindex: '0', 'aria-label': type === 'swiper-nav-prev' ? 'Slide anterior' : 'Slide seguinte' },
      });
      r.add('convertido', type, type === 'swiper-nav-prev' ? 'Seta anterior' : 'Seta seguinte', 'navegação funcional');
      break;
    case 'input':
      r.add('parcial', 'input', 'Campo de formulário', 'estrutura e atributos editáveis; sem integração de envio configurada');
      out = withType(c, 'bolt-input', { tagName: 'input' });
      break;
    default: {
      // Contentor dos itens do menu: o elemento que agrupa a lista de ligações dentro do navbar.
      const inMenu = parents.some((p) => p.type === 'navbar');
      const holdsNav = Array.isArray(c.components) && c.components.some((ch) => ch.type === 'navbar-nav-menu');
      if (inMenu && holdsNav) {
        r.add('convertido', type === 'default' ? '(sem tipo)' : type, 'Itens do menu', 'mostrados ao abrir o menu móvel');
        out = withType(c, 'bolt-menu-items');
      } else if (CORE_TYPES.has(type)) {
        if (type !== 'textnode') r.add('preservado', type, type === 'wrapper' ? 'Página' : `${type} (tipo do motor)`, 'sem alterações');
        out = strip(c, DROPPED_PROPS);
      } else {
        r.add('nao-suportado', type, 'Bloco genérico (<div>)', 'tipo desconhecido: conteúdo, classes e estilos preservados, sem comportamento próprio');
        out = strip(c, DROPPED_PROPS);
      }
    }
  }
  out.components = kids(out.components, c);
  return out;
}

/** Depois da conversão: regras de abertura do menu móvel, no mesmo breakpoint em que a origem o esconde. */
function menuRules(root: ComponentJson, ctx: Ctx): void {
  const walk = (c: ComponentJson, menuId?: string) => {
    const id = idOf(c);
    const currentMenu = c.type === 'bolt-menu' ? id : menuId;
    if (c.type === 'bolt-menu-items' && currentMenu && id) {
      const media = hiddenIn(ctx.sourceStyles, c);
      if (media) ctx.styles.push(freeRule(`#${currentMenu}[data-bolt-menu-open] #${id}`, { display: 'block' }, media));
      else ctx.report.note('Menu: a origem não esconde os itens em nenhum breakpoint; o botão do menu não tem efeito visível.');
    }
    if (Array.isArray(c.components)) c.components.forEach((ch) => walk(ch, currentMenu));
  };
  walk(root);
}

function ensureIds(c: ComponentJson, prefix: string, seq: { n: number }): void {
  if (c.type !== 'textnode' && typeof c.attributes?.id !== 'string') {
    c.attributes = { ...(c.attributes ?? {}), id: `${prefix}${(seq.n += 1).toString(36)}` };
  }
  if (Array.isArray(c.components)) c.components.forEach((ch) => ensureIds(ch, prefix, seq));
}

export function convertGrapesJs(raw: unknown, fileName: string, fileSize: number): AdapterResult {
  if (!isGrapesJsProject(raw)) throw new Error('O ficheiro não tem a estrutura de um projeto GrapesJS (pages › frames › component).');
  const studio = isStudioProject(raw);
  const source = JSON.parse(JSON.stringify(raw)) as GrapesProjectData & { custom?: { globalPageSettings?: { fonts?: Record<string, StudioFont> } } };
  const report = new ReportBuilder();
  const sourceStyles: StyleJson[] = Array.isArray(source.styles) ? (source.styles as StyleJson[]) : [];
  const ctx: Ctx = { report, styles: [], sourceStyles, headingsWithoutTag: [], menus: 0, carousels: 0 };
  const removed: string[] = [];

  const pages = source.pages.map((page) => ({
    ...page,
    frames: page.frames.map((frame) => {
      const clean = sanitizeComponent(frame.component as ComponentJson, removed);
      const converted = convert(clean, ctx, []);
      ensureIds(converted, 'imp-', { n: 0 });
      menuRules(converted, ctx);
      return { ...frame, component: converted };
    }),
  }));

  const fonts: FontEntry[] = [];
  const fontRules = fontFaces(source.custom?.globalPageSettings?.fonts ?? {}, fonts);

  // Recursos da lista do gestor de imagens: os inválidos são removidos e reportados.
  const assets = Array.isArray(source.assets) ? source.assets : [];
  const validAssets = assets.filter((a) => {
    const src = typeof a === 'string' ? a : a && typeof a === 'object' ? String((a as { src?: unknown }).src ?? '') : '';
    return /^https?:\/\//.test(src) || src.startsWith('data:image/');
  });
  if (validAssets.length !== assets.length) report.note(`${assets.length - validAssets.length} entrada(s) da lista de imagens sem endereço válido foram ignoradas.`);

  if (ctx.headingsWithoutTag.length) {
    report.note(
      `${ctx.headingsWithoutTag.length} título(s) sem nível no ficheiro (em: ${[...new Set(ctx.headingsWithoutTag)].join('; ')}). ` +
        'Foi aplicado h1, o padrão do tipo «heading» do Studio. Confirme o nível no painel de propriedades.',
    );
  }
  const variableBindings = sourceStyles.reduce((n, s) => n + Object.values(s.style ?? {}).filter((v) => v && typeof v === 'object').length, 0);
  if (variableBindings) {
    report.note(
      `Variáveis de tema do Studio preservadas (${variableBindings} ligações a «${(source.dataSources as Array<{ id?: string }> | undefined)?.map((d) => d.id).join(', ') ?? 'dataSources'}»). ` +
        'As variáveis do tema editam-se em «Estilos globais», mantendo as ligações. Alterar no inspetor a cor de um elemento ligado a uma variável substitui a ligação por um valor fixo nesse elemento.',
    );
  }
  if (studio && Array.isArray((source.custom as { plugins?: unknown[] } | undefined)?.plugins)) {
    report.note('Plugins do Studio referidos no ficheiro não são carregados: o comportamento do carrossel é reimplementado pelo Bolt.');
  }
  report.removed.push(...removed);

  const { custom: _custom, ...rest } = source;
  void _custom;
  const projectData: RawProjectData = {
    ...rest,
    assets: validAssets,
    pages,
    styles: [...fontRules, ...sourceStyles, ...ctx.styles],
  };

  const title = findTitle(pages[0]?.frames[0]?.component as ComponentJson | undefined);
  return {
    projectData,
    suggestedName: title ?? fileName.replace(/\.[^.]+$/, ''),
    report: {
      format: 'grapesjs',
      formatLabel: studio ? 'GrapesJS Studio (JSON de projeto)' : 'GrapesJS (JSON de projeto)',
      fileName,
      fileSize,
      items: report.items(),
      assets: [],
      fonts,
      notes: report.notes,
      removed: report.removed,
      totals: report.totals(),
    },
  };
}

function findTitle(wrapper: ComponentJson | undefined): string | undefined {
  const head = wrapper?.head as { components?: ComponentJson[] } | undefined;
  const title = head?.components?.find((c) => c.tagName === 'title');
  const text = Array.isArray(title?.components) ? title.components.map((c) => c.content ?? '').join('') : undefined;
  return text?.split('|')[0]?.trim() || undefined;
}
