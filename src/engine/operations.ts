import type { Component, Editor } from 'grapesjs';

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

export function setText(editor: Editor, id: string, text: string): void {
  const c = requireById(editor, id);
  if (!c.is('text') && !c.is('link')) throw new Error(`Componente ${id} não é texto`);
  c.components(text);
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

/** Move `id` para dentro de `targetParentId`, na posição `at`. */
export function move(editor: Editor, id: string, targetParentId: string, at: number): Component {
  const c = requireById(editor, id);
  const target = requireById(editor, targetParentId);
  if (c === target || target.parents().includes(c)) throw new Error('Destino inválido: dentro de si próprio');
  c.move(target, { at });
  return c;
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
