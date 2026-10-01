import type { Component, Editor, Page } from 'grapesjs';
import {
  AI_STYLE_PROPS,
  HARD_LIMITS,
  type AiCapabilities,
  type AiContext,
  type AiDevice,
  type AiElementContext,
  type AiNode,
  type AiPageContext,
  type AiScope,
  type AiScopeKind,
  type AiVariable,
} from '../../supabase/functions/_shared/ai/contract.ts';
import { isInternalComponent } from '../engine/boltTypes';
import { readGlobalStyles, resolveValue, variableOf } from '../engine/globalStyles';
import { contentHint, displayName } from '../engine/labels';
import { findInProject, hasHref, isLinkBox, isPlainText, isTextLike, textTag } from '../engine/operations';
import { listPages, pageLabel } from '../engine/pages';
import { styleSources } from '../engine/styleSources';
import { DEVICES, getOwnStyle, type DeviceId } from '../engine/styles';

/**
 * Contexto do pedido ao assistente, para o âmbito ESCOLHIDO pelo utilizador:
 *  - elemento: o detalhe do elemento (estilos com origem e variáveis) + os antepassados só como
 *    contexto (fora do âmbito), para o modelo perceber, por exemplo, que a imagem de fundo é da
 *    secção e não do elemento;
 *  - secção: o detalhe da secção + a sua árvore (no âmbito) + antepassados (fora);
 *  - página / site inteiro: a árvore de cada página, em forma reduzida.
 * Textos e atributos são dados do projeto (possivelmente importados): o servidor delimita-os como
 * dados e o modelo é instruído a nunca os seguir como instruções.
 */
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Texto visível do elemento, lido do modelo (funciona sem canvas). */
export function plainText(c: Component): string {
  const walk = (x: Component): string => {
    if (x.get('type') === 'textnode') return String(x.get('content') ?? '');
    if (isInternalComponent(x)) return '';
    const own = String(x.get('content') ?? '');
    return own + x.components().models.map(walk).join('');
  };
  return walk(c).replace(/\s+/g, ' ').trim();
}

/** Recebe blocos lá dentro (secções, contentores, colunas, a própria página). */
export function isContainer(editor: Editor, c: Component): boolean {
  if (isTextLike(c) || c.is('image') || c.get('type') === 'textnode') return false;
  return editor.Components.canMove(c, { type: 'text', tagName: 'p' }, c.components().length).result;
}

export function capabilitiesOf(editor: Editor, c: Component): AiCapabilities {
  return { text: isTextLike(c) && !isLinkBox(c), link: hasHref(c), tag: textTag(c) !== null, image: c.is('image'), container: isContainer(editor, c) };
}

const SECTION_TAGS = new Set(['section', 'header', 'footer', 'nav', 'main', 'aside']);

/** Secção de um elemento: o antepassado mais próximo que é uma secção, ou o filho direto da página. */
export function sectionOf(c: Component): Component | null {
  let cur: Component | undefined = c;
  while (cur) {
    const parent: Component | undefined = cur.parent();
    if (!parent) return null; // é a própria página
    const tag = String(cur.get('tagName') ?? '').toLowerCase();
    if (cur.get('type') === 'bolt-section' || SECTION_TAGS.has(tag) || !parent.parent()) return cur;
    cur = parent;
  }
  return null;
}

/** Dispositivos cujas regras se aplicam num dispositivo (o próprio e os mais largos). */
function cascade(device: AiDevice): DeviceId[] {
  const i = DEVICES.findIndex((d) => d.id === device);
  return DEVICES.slice(0, i + 1).map((d) => d.id);
}

/**
 * Nome do ficheiro de um endereço de imagem, só quando diz alguma coisa (ex.: «estacionamento.jpg»).
 * Imagens dentro do documento (data:) e nomes gerados (identificadores, sequências hexadecimais)
 * não são enviados: não descrevem a imagem. O modelo NUNCA recebe a imagem nem o endereço.
 */
export function descriptiveFileName(src: string): string | undefined {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return undefined;
  const path = src.replace(/^bolt-asset:/, '').split(/[?#]/)[0] ?? '';
  let name = path.split('/').pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // mantém o nome tal como está
  }
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (stem.length < 3 || /^[0-9a-f-]{8,}$/i.test(stem) || !/[a-z]{3,}/i.test(stem)) return undefined;
  return cut(name, 120);
}

/** URL da imagem de fundo (a primeira), própria em cascata ou calculada no canvas. */
function backgroundUrl(editor: Editor, c: Component, device: AiDevice): string {
  for (const d of [...cascade(device)].reverse()) {
    const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(getOwnStyle(editor, c, d)['background-image'] ?? '');
    if (m?.[2]) return m[2];
  }
  const el = c.getEl();
  const view = el?.ownerDocument?.defaultView;
  const m = el && view ? /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(view.getComputedStyle(el).backgroundImage) : null;
  return m?.[2] ?? '';
}

/** Tem imagem de fundo (própria, em cascata, ou calculada no canvas quando existe). */
export function hasBackgroundImage(editor: Editor, c: Component, device: AiDevice): boolean {
  const own = cascade(device).some((d) => /url\(/.test(getOwnStyle(editor, c, d)['background-image'] ?? ''));
  if (own) return true;
  const el = c.getEl();
  const view = el?.ownerDocument?.defaultView;
  return Boolean(el && view && /url\(/.test(view.getComputedStyle(el).backgroundImage));
}

function nodeOf(editor: Editor, c: Component, device: AiDevice, inScope: boolean): AiNode {
  const caps = capabilitiesOf(editor, c);
  const attrs = c.getAttributes();
  const own: AiNode['own'] = {};
  const style = getOwnStyle(editor, c, device);
  for (const p of AI_STYLE_PROPS) {
    const v = style[p];
    if (v) own[p] = cut(v, 200);
  }
  const text = caps.text ? cut(plainText(c), HARD_LIMITS.nodeTextChars) : '';
  const bg = hasBackgroundImage(editor, c, device);
  const imageFile = caps.image ? descriptiveFileName(String(c.get('src') ?? attrs.src ?? '')) : undefined;
  const backgroundFile = bg ? descriptiveFileName(backgroundUrl(editor, c, device)) : undefined;
  return {
    id: c.getId(),
    parent: c.parent()?.getId() ?? null,
    kind: cut(displayName(c), 60),
    tag: cut(String(c.get('tagName') ?? ''), 20),
    inScope,
    caps,
    ...(text ? { text } : {}),
    ...(typeof attrs.href === 'string' ? { href: cut(attrs.href, 300) } : {}),
    ...(caps.image ? { imageAlt: cut(String(attrs.alt ?? ''), 300) } : {}),
    ...(imageFile ? { imageFile } : {}),
    ...(bg ? { backgroundImage: true } : {}),
    ...(backgroundFile ? { backgroundFile } : {}),
    ...(Object.keys(own).length ? { own } : {}),
  };
}

/** Subárvore (sem nós de texto), pré-ordem. */
function subtree(c: Component): Component[] {
  const out: Component[] = [];
  const walk = (x: Component) => {
    if (x.get('type') === 'textnode' || isInternalComponent(x)) return;
    out.push(x);
    x.components().models.forEach(walk);
  };
  walk(c);
  return out;
}

/** Antepassados (da página até ao pai), só como contexto. */
function ancestors(c: Component): Component[] {
  return [...c.parents()].reverse();
}

export function variablesOf(editor: Editor): AiVariable[] {
  const g = readGlobalStyles(editor);
  return g.slots
    .filter((s) => s.name.startsWith('--'))
    .slice(0, HARD_LIMITS.variables)
    .map((s) => ({ name: cut(s.name, 80), label: cut(s.label, 80), value: cut(resolveValue(s.value || s.fallback, g.variables), 300), kind: s.kind }));
}

/** Detalhe do elemento principal (estilos com origem e ligações a variáveis). */
export function buildElementContext(editor: Editor, component: Component, device: AiDevice): AiElementContext {
  const caps = capabilitiesOf(editor, component);
  const g = readGlobalStyles(editor);
  const labels = new Map(g.slots.filter((s) => s.name.startsWith('--')).map((s) => [s.name, s.label]));
  const attrs = component.getAttributes();
  const href = typeof attrs.href === 'string' ? attrs.href : undefined;
  const tag = textTag(component);
  // Sem canvas (headless ou outra página) não há origem calculada: o contexto segue só com o resto.
  const sources = (() => {
    try {
      return styleSources(editor, component, device);
    } catch {
      return null;
    }
  })();
  const styles: AiElementContext['styles'] = {};
  for (const prop of AI_STYLE_PROPS) {
    const s = sources?.get(prop);
    if (!s || !s.value) continue;
    const variable = variableOf(s.value);
    styles[prop] = {
      value: cut(s.value, 300),
      source: s.kind,
      from: cut(s.label, 200),
      ...(variable ? { variable, variableLabel: cut(labels.get(variable) ?? variable, 80) } : {}),
    };
  }
  return {
    id: component.getId(),
    kind: cut(displayName(component), 60),
    tagName: cut(String(component.get('tagName') ?? ''), 20),
    capabilities: caps,
    content: {
      ...(caps.text ? { text: cut(plainText(component), 4000), richText: !isPlainText(component) } : {}),
      ...(href !== undefined ? { href: cut(href, HARD_LIMITS.hrefChars), newTab: attrs.target === '_blank' } : {}),
      ...(tag ? { tag } : {}),
      ...(caps.image ? { imageAlt: cut(String(attrs.alt ?? ''), 300) } : {}),
    },
    styles,
  };
}

function pageMeta(editor: Editor, page: Page): { id: string; name: string; slug: string; current: boolean } {
  const info = listPages(editor).find((p) => p.id === page.getId());
  const all = editor.Pages.getAll();
  return { id: page.getId(), name: cut(info?.name ?? pageLabel(page, all.indexOf(page)), 120), slug: cut(info?.slug ?? '', 80), current: editor.Pages.getSelected() === page };
}

const limit = (nodes: AiNode[]) => nodes.slice(0, HARD_LIMITS.nodesPerPage);

// ---------------------------------------------------------------- âmbito

export interface ResolvedScope {
  scope: AiScope;
  /** Texto para mostrar (ex.: «Secção · Hero»). */
  label: string;
  /** Páginas abrangidas. */
  pageIds: string[];
}

/**
 * Âmbito concreto a partir da escolha do utilizador e da seleção atual. Null quando não é possível
 * (ex.: «Elemento» sem seleção).
 */
export function resolveScope(editor: Editor, kind: AiScopeKind, selected: Component | undefined, explicitId?: string): ResolvedScope | null {
  const page = editor.Pages.getSelected();
  if (!page) return null;
  const pageId = page.getId();
  const pageName = pageMeta(editor, page).name;
  if (kind === 'site') {
    const all = editor.Pages.getAll();
    return { scope: { kind: 'site' }, label: `Site inteiro · ${all.length} ${all.length === 1 ? 'página' : 'páginas'}`, pageIds: all.map((p) => p.getId()) };
  }
  if (kind === 'page') return { scope: { kind: 'page', pageId }, label: `Página · ${pageName}`, pageIds: [pageId] };
  const base = explicitId ? findInProject(editor, explicitId)?.component : selected;
  if (!base) return null;
  if (kind === 'element') {
    const hint = contentHint(base);
    return { scope: { kind: 'element', id: base.getId(), pageId }, label: `Elemento · ${displayName(base)}${hint ? ` «${cut(hint, 40)}»` : ''}`, pageIds: [pageId] };
  }
  const section = explicitId ? base : sectionOf(base);
  if (!section) return null;
  const hint = sectionHint(section);
  return { scope: { kind: 'section', id: section.getId(), pageId }, label: `Secção · ${displayName(section)}${hint ? ` «${cut(hint, 40)}»` : ''}`, pageIds: [pageId] };
}

/** Primeiro título da secção (para a identificar ao utilizador). */
function sectionHint(section: Component): string {
  const heading = subtree(section).find((x) => /^h[1-6]$/i.test(String(x.get('tagName') ?? '')));
  return heading ? plainText(heading) : '';
}

/** Contexto completo do âmbito (uma parte). */
export function buildScopeContext(editor: Editor, scope: AiScope, device: AiDevice): AiContext {
  const variables = variablesOf(editor);
  if (scope.kind === 'element' || scope.kind === 'section') {
    const hit = findInProject(editor, scope.id);
    if (!hit) throw new Error('O elemento do âmbito já não existe.');
    const c = hit.component;
    const inScope = scope.kind === 'element' ? [c] : subtree(c);
    // Elemento: os vizinhos da sua secção também seguem, SÓ como contexto (fora do âmbito), para o
    // modelo distinguir, por exemplo, a imagem selecionada de outras imagens e fundos próximos.
    const up = ancestors(c);
    const section = scope.kind === 'element' ? sectionOf(c) : null;
    const around = section ? subtree(section).filter((x) => x !== c && !up.includes(x)) : [];
    const nodes = [...up.map((a) => nodeOf(editor, a, device, false)), ...around.map((x) => nodeOf(editor, x, device, false)), ...inScope.map((x) => nodeOf(editor, x, device, true))];
    return { target: buildElementContext(editor, c, device), pages: [{ ...pageMeta(editor, hit.page), nodes: limit(nodes) }], variables };
  }
  const pages = scope.kind === 'page' ? editor.Pages.getAll().filter((p) => p.getId() === scope.pageId) : editor.Pages.getAll();
  if (!pages.length) throw new Error('A página do âmbito já não existe.');
  return {
    pages: pages.slice(0, HARD_LIMITS.pages).map((p) => ({ ...pageMeta(editor, p), nodes: limit(subtree(p.getMainComponent()).map((x) => nodeOf(editor, x, device, true))) })),
    variables,
  };
}

// ---------------------------------------------------------------- partes (pedidos grandes)

/** Tamanho máximo (caracteres de JSON) do contexto de UMA parte. */
export const PART_BUDGET = 60_000;

export interface ContextPart {
  label: string;
  context: AiContext;
}

const size = (x: unknown) => JSON.stringify(x).length;

/**
 * Divide o contexto em partes que cabem num pedido: primeiro por página; uma página grande por
 * grupos de secções (filhos diretos da página). Cada parte leva a página (nó raiz, para inserir
 * secções) e as secções dessa parte; a proposta final é consolidada no editor.
 */
export function planParts(context: AiContext, budget = PART_BUDGET): ContextPart[] {
  if (size(context) <= budget) return [{ label: 'Pedido único', context }];
  const perPage: Array<{ label: string; page: AiPageContext }> = [];
  for (const page of context.pages) {
    if (size({ ...context, pages: [page] }) <= budget) {
      perPage.push({ label: `Página «${page.name}»`, page });
      continue;
    }
    const root = page.nodes.find((n) => n.parent === null);
    const children = new Map<string, AiNode[]>();
    for (const n of page.nodes) if (n.parent) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
    const branch = (n: AiNode): AiNode[] => [n, ...(children.get(n.id) ?? []).flatMap(branch)];
    const sections = root ? (children.get(root.id) ?? []).map(branch) : [page.nodes];
    let group: AiNode[] = [];
    let groups = 0;
    const flush = () => {
      if (!group.length) return;
      groups += 1;
      perPage.push({ label: `Página «${page.name}» · secções ${groups}`, page: { ...page, nodes: [...(root ? [root] : []), ...group] } });
      group = [];
    };
    for (const s of sections) {
      if (group.length && size({ ...context, pages: [{ ...page, nodes: [...group, ...s] }] }) > budget) flush();
      group.push(...s);
    }
    flush();
  }
  const total = perPage.length;
  return perPage.map((p, i) => ({ label: p.label, context: { ...context, pages: [p.page], part: { index: i + 1, total, label: p.label } } }));
}
