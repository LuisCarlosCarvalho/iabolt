import type { Component, Editor } from 'grapesjs';
import { displayName } from './labels';

/**
 * Tipos estruturais do Bolt IA. Os conteúdos (título, texto, botão, imagem, logo)
 * usam os tipos nativos `text`, `link` e `image` para continuarem manipuláveis.
 */
const TOP_LEVEL = new Set(['bolt-navbar', 'bolt-section', 'bolt-footer']);

/** Secções, navbar e rodapé só podem viver no nível de topo da página. */
const onlyInPage = (_source: Component, target: Component): boolean => target.is('wrapper');

export function isTopLevelType(type: string | undefined): boolean {
  return TOP_LEVEL.has(type ?? '');
}

function structural(editor: Editor, type: string, tagName: string, boltType: string, extra: Record<string, unknown> = {}): void {
  editor.Components.addType(type, {
    isComponent: (el) => el.tagName === tagName.toUpperCase() && el.dataset?.boltType === boltType,
    model: {
      defaults: {
        tagName,
        attributes: { 'data-bolt-type': boltType },
        droppable: true,
        ...extra,
      },
    },
  });
}

export function boltTypesPlugin(editor: Editor): void {
  structural(editor, 'bolt-section', 'section', 'section', { draggable: onlyInPage });
  structural(editor, 'bolt-navbar', 'nav', 'navbar', { draggable: onlyInPage });
  structural(editor, 'bolt-footer', 'footer', 'footer', { draggable: onlyInPage });
  structural(editor, 'bolt-container', 'div', 'container');
  structural(editor, 'bolt-columns', 'div', 'columns', {
    // Uma linha de colunas só aceita colunas.
    droppable: (source: Component) => source.get('type') === 'bolt-column',
  });
  structural(editor, 'bolt-column', 'div', 'column', {
    draggable: (_source: Component, target: Component) => target.get('type') === 'bolt-columns',
  });

  editor.Components.addType('bolt-button', {
    extend: 'link',
    isComponent: (el) => el.tagName === 'A' && el.dataset?.boltType === 'button',
    model: {
      defaults: {
        attributes: { 'data-bolt-type': 'button' },
      },
    },
  });

  // Nomes legíveis no destaque do canvas, derivados do modelo (sem os gravar).
  for (const type of ['wrapper', 'default', 'text', 'image', 'link', 'bolt-button', 'bolt-section', 'bolt-navbar', 'bolt-footer', 'bolt-container', 'bolt-columns', 'bolt-column']) {
    editor.Components.addType(type, {
      model: {
        getName() {
          return displayName(this);
        },
      },
    });
  }
}
