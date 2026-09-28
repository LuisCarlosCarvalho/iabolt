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

/** Elementos cujo conteúdo é texto editável. */
export const isTextLike = (c: Component): boolean => c.is('text') || isLink(c);

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
  if (!isLink(c)) throw new Error(`Componente ${id} não é uma ligação`);
  if (patch.text !== undefined) c.components(asTextNode(patch.text));
  if (patch.href !== undefined) c.addAttributes({ href: patch.href });
  if (patch.newTab === true) c.addAttributes({ target: '_blank', rel: 'noopener noreferrer' });
  if (patch.newTab === false) c.removeAttributes(['target', 'rel']);
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
