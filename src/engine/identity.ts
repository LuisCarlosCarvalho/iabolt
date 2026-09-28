import type { Component, Editor } from 'grapesjs';

const ID_EXEMPT_TYPES = new Set(['textnode']);

/** Torna persistente o id que o motor já usa (attributes.id → ccid). */
export function ensureStableId(component: Component): void {
  if (ID_EXEMPT_TYPES.has(component.get('type') ?? '')) return;
  const attrs = component.getAttributes();
  if (typeof attrs.id !== 'string' || attrs.id.length === 0) {
    // avoidStore: não cria um passo de undo nem marca alterações só por fixar a identidade.
    component.setId(component.getId(), { avoidStore: true });
  }
}

export function ensureStableIdsDeep(root: Component): void {
  ensureStableId(root);
  root.components().models.forEach((child) => ensureStableIdsDeep(child));
}

export function sweepAllPages(editor: Editor): void {
  editor.Pages.getAll().forEach((page) => {
    const wrapper = page.getMainComponent();
    ensureStableIdsDeep(wrapper);
  });
}

/**
 * Plugin GrapesJS: qualquer componente que entra no documento fica com id persistido.
 * A colisão de ids (ex.: ao duplicar) é resolvida pelo próprio motor em Component.createId.
 */
export function identityPlugin(editor: Editor): void {
  editor.on('component:add', (component: Component) => ensureStableIdsDeep(component));
  editor.on('load', () => sweepAllPages(editor));
}
