import type { Component, Editor } from 'grapesjs';
import { useSyncExternalStore } from 'react';

/**
 * O React não guarda cópia da árvore: re-renderiza quando o motor emite eventos e
 * volta a ler o modelo. O valor devolvido é só um contador de versão.
 */
const EVENTS = [
  'update',
  'component:toggled',
  'component:update',
  'component:add',
  'component:remove',
  'component:styleUpdate',
  'undo',
  'redo',
  'device:select',
  'rte:enable',
  'rte:disable',
].join(' ');

const versions = new WeakMap<Editor, { n: number }>();

function counter(editor: Editor) {
  let v = versions.get(editor);
  if (!v) {
    v = { n: 0 };
    versions.set(editor, v);
  }
  return v;
}

export function useEditorTick(editor: Editor): number {
  return useSyncExternalStore(
    (onChange) => {
      const v = counter(editor);
      let frame = 0;
      // Agrupa rajadas de eventos (ex.: colar uma secção) numa única re-renderização.
      const handler = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          v.n += 1;
          onChange();
        });
      };
      editor.on(EVENTS, handler);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        editor.off(EVENTS, handler);
      };
    },
    () => counter(editor).n,
  );
}

/** Termina e sincroniza a edição de texto em curso no canvas antes de gravar. */
export async function syncEditing(editor: Editor): Promise<void> {
  const editing: Component | undefined = editor.getEditing();
  const view = editing?.getView();
  if (view && 'syncContent' in view && typeof view.syncContent === 'function') {
    await view.syncContent();
  }
}
