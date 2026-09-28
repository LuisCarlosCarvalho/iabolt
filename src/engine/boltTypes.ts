import type { Editor } from 'grapesjs';

/**
 * Tipos estruturais do Bolt IA. Os conteúdos (título, texto, botão, imagem, logo)
 * usam os tipos nativos `text`, `link` e `image` para continuarem manipuláveis.
 */
export function boltTypesPlugin(editor: Editor): void {
  const dc = editor.Components;

  dc.addType('bolt-section', {
    isComponent: (el) => el.tagName === 'SECTION' && el.dataset?.boltType === 'section',
    model: {
      defaults: {
        tagName: 'section',
        name: 'Secção',
        attributes: { 'data-bolt-type': 'section' },
        // Restringir secções ao topo (draggable por seletor) fica para a Fase 2, com teste próprio.
        draggable: true,
        droppable: true,
      },
    },
  });

  dc.addType('bolt-navbar', {
    isComponent: (el) => el.tagName === 'NAV' && el.dataset?.boltType === 'navbar',
    model: {
      defaults: {
        tagName: 'nav',
        name: 'Navbar',
        attributes: { 'data-bolt-type': 'navbar' },
        droppable: true,
      },
    },
  });
}
