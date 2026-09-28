import type { Component, ComponentDefinition, Editor } from 'grapesjs';

/** Operações do editor sobre o modelo do motor, endereçadas por id estável. */

export function findById(editor: Editor, id: string): Component | undefined {
  const wrapper = editor.getWrapper();
  if (!wrapper) return undefined;
  // Percorre o modelo (não o DOM): funciona em headless e não depende de escapar seletores.
  const walk = (c: Component): Component | undefined => {
    if (c.getId() === id) return c;
    for (const child of c.components().models) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(wrapper);
}

function requireById(editor: Editor, id: string): Component {
  const c = findById(editor, id);
  if (!c) throw new Error(`Componente inexistente: ${id}`);
  return c;
}

export function selectById(editor: Editor, id: string): Component {
  const c = requireById(editor, id);
  editor.select(c);
  return c;
}

/** Seleciona o pai imediato; na raiz (wrapper) não sobe mais. */
export function selectParent(editor: Editor): Component | undefined {
  const current = editor.getSelected();
  const parent = current?.parent();
  if (!current || !parent) return current;
  editor.select(parent);
  return parent;
}

/** Ligações e botões (`bolt-button` estende `link`; `Component.is` compara o tipo exato). */
export const isLink = (c: Component): boolean => c.is('link') || c.is('bolt-button');

/** Bloco inteiro clicável (`<a>` com outros elementos lá dentro). Tem destino, não texto próprio. */
export const isLinkBox = (c: Component): boolean => c.is('bolt-link-box');

/** Elementos com destino (href) editável. */
export const hasHref = (c: Component): boolean => isLink(c) || isLinkBox(c);

/** Elementos cujo conteúdo é texto editável (inclui o título de um item de acordeão). */
export const isTextLike = (c: Component): boolean => c.is('text') || c.is('bolt-accordion-title') || isLink(c);

/** Verdadeiro quando o conteúdo é só texto (sem formatação nem elementos filhos). */
export function isPlainText(c: Component): boolean {
  return c.components().models.every((child) => child.get('type') === 'textnode');
}

/** Conteúdo como nó de texto: o que o utilizador escreve nunca é interpretado como HTML. */
const asTextNode = (text: string): ComponentDefinition[] => [{ type: 'textnode', content: text }];

export function setText(editor: Editor, id: string, text: string): void {
  const c = requireById(editor, id);
  if (!isTextLike(c)) throw new Error(`Componente ${id} não é texto`);
  c.components(asTextNode(text));
}

export interface LinkPatch {
  text?: string;
  href?: string;
  newTab?: boolean;
}

/** Texto e destino de ligações e botões. */
export function setLink(editor: Editor, id: string, patch: LinkPatch): void {
  const c = requireById(editor, id);
  if (!hasHref(c)) throw new Error(`Componente ${id} não é uma ligação`);
  if (patch.text !== undefined) {
    if (!isLink(c)) throw new Error(`O bloco de ligação ${id} não tem texto próprio`);
    c.components(asTextNode(patch.text));
  }
  if (patch.href !== undefined) c.addAttributes({ href: patch.href });
  if (patch.newTab === true) c.addAttributes({ target: '_blank', rel: 'noopener noreferrer' });
  if (patch.newTab === false) c.removeAttributes(['target', 'rel']);
}

export const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const;
export type TextTag = (typeof TEXT_TAGS)[number];

/** Nível do título (h1–h6) ou parágrafo. Só para textos cujo elemento já é um destes. */
export function textTag(c: Component): TextTag | null {
  const tag = String(c.get('tagName') ?? '').toLowerCase();
  return c.is('text') ? (TEXT_TAGS.find((t) => t === tag) ?? null) : null;
}

export function setTextTag(editor: Editor, id: string, tag: TextTag): void {
  const c = requireById(editor, id);
  if (!textTag(c)) throw new Error(`Componente ${id} não é um título nem um parágrafo`);
  c.set('tagName', tag);
}

export interface InputPatch {
  placeholder?: string;
  name?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'number';
  required?: boolean;
}

/** Atributos de um campo de formulário. O envio não é configurado aqui (sem integração). */
export function setInput(editor: Editor, id: string, patch: InputPatch): void {
  const c = requireById(editor, id);
  if (!c.is('bolt-input')) throw new Error(`Componente ${id} não é um campo de formulário`);
  const { required, ...attrs } = patch;
  const clean = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length) c.addAttributes(clean);
  if (required === true) c.addAttributes({ required: true });
  if (required === false) c.removeAttributes(['required']);
}

export interface CarouselBreakpoint {
  min: number;
  perView: number;
  gap: number;
}

export interface CarouselConfig {
  breakpoints: CarouselBreakpoint[];
  loop?: boolean;
  autoplay?: { delay: number } | null;
  speed?: number;
  easing?: 'ease' | 'linear';
  pagination?: boolean;
  pauseOnHover?: boolean;
  /** Movimento contínuo em sentido inverso. */
  reverse?: boolean;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Configuração do carrossel, lida do atributo `data-bolt-carousel` (JSON próprio do Bolt IA). */
export function carouselConfig(c: Component): CarouselConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(String(c.getAttributes()['data-bolt-carousel'] ?? '{}'));
  } catch {
    raw = {};
  }
  const r = typeof raw === 'object' && raw !== null ? raw : {};
  const get = (k: string): unknown => (k in r ? Object.getOwnPropertyDescriptor(r, k)?.value : undefined);
  const bps = get('breakpoints');
  const breakpoints = (Array.isArray(bps) ? bps : [])
    .filter((b): b is object => typeof b === 'object' && b !== null)
    .map((b) => {
      const v = (k: string): unknown => Object.getOwnPropertyDescriptor(b, k)?.value;
      return { min: num(v('min'), 0), perView: Math.max(1, num(v('perView'), 1)), gap: Math.max(0, num(v('gap'), 0)) };
    });
  const autoplay = get('autoplay');
  const delay = typeof autoplay === 'object' && autoplay !== null ? Object.getOwnPropertyDescriptor(autoplay, 'delay')?.value : undefined;
  return {
    breakpoints: breakpoints.length ? breakpoints : [{ min: 0, perView: 1, gap: 0 }],
    loop: get('loop') === true,
    autoplay: typeof delay === 'number' ? { delay } : null,
    speed: num(get('speed'), 300),
    easing: get('easing') === 'linear' ? 'linear' : 'ease',
    pagination: get('pagination') !== false,
    pauseOnHover: get('pauseOnHover') !== false,
    reverse: get('reverse') === true,
  };
}

export function setCarouselConfig(editor: Editor, id: string, patch: Partial<CarouselConfig>): void {
  const c = requireById(editor, id);
  if (!c.is('bolt-carousel')) throw new Error(`Componente ${id} não é um carrossel`);
  const next = { ...carouselConfig(c), ...patch };
  next.breakpoints = [...next.breakpoints].sort((a, b) => a.min - b.min);
  c.addAttributes({ 'data-bolt-carousel': JSON.stringify(next) });
}

export interface ImagePatch {
  src?: string;
  alt?: string;
}

export function setImage(editor: Editor, id: string, patch: ImagePatch): void {
  const c = requireById(editor, id);
  if (!c.is('image')) throw new Error(`Componente ${id} não é uma imagem`);
  if (patch.src !== undefined) c.set('src', patch.src);
  if (patch.alt !== undefined) c.addAttributes({ alt: patch.alt });
}

/** Clona a subárvore logo a seguir à origem e seleciona o clone. */
export function duplicate(editor: Editor, id: string): Component {
  const source = requireById(editor, id);
  const parent = source.parent();
  if (!parent) throw new Error('A raiz não pode ser duplicada');
  const clone = source.clone();
  const [added] = parent.append(clone, { at: source.index() + 1 });
  if (!added) throw new Error('Falha ao inserir o clone');
  editor.select(added);
  return added;
}

/** Remove e move a seleção para um destino válido (irmão seguinte, anterior ou pai). */
export function remove(editor: Editor, id: string): Component | undefined {
  const target = requireById(editor, id);
  const parent = target.parent();
  if (!parent) throw new Error('A raiz não pode ser eliminada');
  const siblings = parent.components();
  const idx = target.index();
  const next = siblings.at(idx + 1) ?? (idx > 0 ? siblings.at(idx - 1) : undefined) ?? parent;
  target.remove();
  editor.select(next);
  return next;
}

/** Verdadeiro quando o motor aceita mover `source` para dentro de `target` na posição `at`. */
export function canPlace(editor: Editor, target: Component, source: Component, at?: number): boolean {
  if (source === target || target.parents().includes(source)) return false;
  return editor.Components.canMove(target, source, at).result;
}

/**
 * Move `id` para dentro de `targetParentId`, na posição `at` (índice antes da remoção,
 * como em Component.move). Recusa destinos que as regras dos tipos não permitem.
 */
export function move(editor: Editor, id: string, targetParentId: string, at: number): Component {
  const c = requireById(editor, id);
  const target = requireById(editor, targetParentId);
  if (c === target || target.parents().includes(c)) throw new Error('Destino inválido: dentro de si próprio');
  if (!editor.Components.canMove(target, c, at).result) throw new Error('Destino inválido para este elemento');
  c.move(target, { at });
  return c;
}

/** Sobe ou desce um lugar entre os irmãos. Devolve falso quando já está no limite. */
export function moveBy(editor: Editor, id: string, delta: -1 | 1): boolean {
  const c = requireById(editor, id);
  const parent = c.parent();
  if (!parent) return false;
  const idx = c.index();
  const last = parent.components().length - 1;
  if ((delta < 0 && idx === 0) || (delta > 0 && idx === last)) return false;
  // Component.move usa o índice anterior à remoção: descer um lugar é `idx + 2`.
  c.move(parent, { at: delta > 0 ? idx + 2 : idx - 1 });
  return true;
}

const INSERT_INSIDE = new Set(['wrapper', 'bolt-container', 'bolt-column', 'bolt-section', 'bolt-navbar', 'bolt-footer']);

/**
 * Insere um bloco na primeira posição válida a partir da seleção: dentro dela
 * (se for contentor), senão a seguir a ela, subindo pelos antepassados.
 * Sem seleção, acrescenta ao fim da página.
 */
export function insertBlock(editor: Editor, def: ComponentDefinition, anchor?: Component): Component {
  const wrapper = editor.getWrapper();
  if (!wrapper) throw new Error('Página indisponível');
  const candidates: Array<[Component, number]> = [];
  if (anchor) {
    if (INSERT_INSIDE.has(anchor.get('type') ?? '')) candidates.push([anchor, anchor.components().length]);
    let cur: Component | undefined = anchor;
    while (cur) {
      const parent: Component | undefined = cur.parent();
      if (!parent) break;
      candidates.push([parent, cur.index() + 1]);
      cur = parent;
    }
  } else {
    candidates.push([wrapper, wrapper.components().length]);
  }
  for (const [target, at] of candidates) {
    if (!editor.Components.canMove(target, def, at).result) continue;
    const [added] = target.append(def, { at });
    if (added) {
      editor.select(added);
      return added;
    }
  }
  throw new Error('Não há posição válida para este elemento');
}

/** Árvore mínima (id, tipo, filhos) para asserções e Navigator. */
export interface TreeNode {
  id: string;
  type: string;
  children: TreeNode[];
}

export function tree(component: Component): TreeNode {
  return {
    id: component.getId(),
    type: component.get('type') ?? 'default',
    children: component
      .components()
      .models.filter((c) => c.get('type') !== 'textnode')
      .map((c) => tree(c)),
  };
}
