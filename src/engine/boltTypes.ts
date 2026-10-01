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

/** Tipo da folha de estilos importada (CSS literal de um site estático). */
export const STYLESHEET_TYPE = 'bolt-stylesheet';

/** Componentes internos que não são conteúdo da página (camadas, assistente, operações). */
export function isInternalComponent(c: Component): boolean {
  return c.get('type') === STYLESHEET_TYPE;
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

  // Tipos usados pela importação. Nenhum acrescenta estilos: a aparência vem das classes e
  // regras do documento importado, e o layout flex original mantém-se tal como estava.
  structural(editor, 'bolt-row', 'div', 'row');
  structural(editor, 'bolt-col', 'div', 'col');
  structural(editor, 'bolt-icon', 'div', 'icon');
  structural(editor, 'bolt-link-box', 'a', 'link-box');
  structural(editor, 'bolt-list', 'ul', 'list');
  structural(editor, 'bolt-list-item', 'li', 'list-item');

  // Menu com versão móvel: o botão abre/fecha os itens (runtime do Bolt, sem scripts importados).
  structural(editor, 'bolt-menu', 'nav', 'menu');
  structural(editor, 'bolt-menu-toggle', 'div', 'menu-toggle', {
    attributes: { 'data-bolt-type': 'menu-toggle', role: 'button', tabindex: '0', 'aria-label': 'Abrir menu', 'aria-expanded': 'false' },
  });
  structural(editor, 'bolt-menu-items', 'div', 'menu-items');

  // Carrossel: configuração em data-bolt-carousel (JSON), slides como componentes editáveis.
  structural(editor, 'bolt-carousel', 'div', 'carousel');
  structural(editor, 'bolt-carousel-track', 'div', 'carousel-track', {
    droppable: (source: Component) => source.get('type') === 'bolt-slide',
  });
  structural(editor, 'bolt-slide', 'div', 'slide', {
    draggable: (_source: Component, target: Component) => target.get('type') === 'bolt-carousel-track',
  });
  structural(editor, 'bolt-carousel-pagination', 'div', 'carousel-pagination', { droppable: false });
  structural(editor, 'bolt-carousel-prev', 'div', 'carousel-prev', {
    attributes: { 'data-bolt-type': 'carousel-prev', role: 'button', tabindex: '0', 'aria-label': 'Slide anterior' },
  });
  structural(editor, 'bolt-carousel-next', 'div', 'carousel-next', {
    attributes: { 'data-bolt-type': 'carousel-next', role: 'button', tabindex: '0', 'aria-label': 'Slide seguinte' },
  });

  // Acordeão nativo (<details>/<summary>): abre e fecha sem JavaScript.
  structural(editor, 'bolt-accordion', 'div', 'accordion');
  structural(editor, 'bolt-accordion-item', 'details', 'accordion-item');
  editor.Components.addType('bolt-accordion-title', {
    extend: 'text',
    isComponent: (el) => el.tagName === 'SUMMARY',
    model: { defaults: { tagName: 'summary', attributes: { 'data-bolt-type': 'accordion-title' } } },
  });

  // Campo de formulário: estrutura e atributos editáveis; o envio depende de integração.
  editor.Components.addType('bolt-input', {
    isComponent: (el) => el.tagName === 'INPUT',
    model: { defaults: { tagName: 'input', void: true, droppable: false, attributes: { 'data-bolt-type': 'input', type: 'text' } } },
  });

  // Folha de estilos de um site importado: o CSS original, literal e pela ordem original (ver
  // importers/static/site.ts). Não é um elemento da página: não se seleciona, não aparece nas
  // camadas e não se move, copia nem apaga. Só existe dentro da página a que pertence.
  editor.Components.addType(STYLESHEET_TYPE, {
    isComponent: (el) => el.tagName === 'STYLE' && el.dataset?.boltType === 'stylesheet',
    model: {
      defaults: {
        tagName: 'style',
        attributes: { 'data-bolt-type': 'stylesheet' },
        selectable: false,
        hoverable: false,
        highlightable: false,
        layerable: false,
        draggable: false,
        droppable: false,
        copyable: false,
        removable: false,
        editable: false,
        stylable: false,
      },
    },
  });

  // Mapa incorporado: no canvas, o motor desenhava <div><iframe></div>, e o CSS do site (ex.:
  // `.map iframe { height: 100% }`) ficava sem efeito. Com a vista base, o elemento do canvas é o
  // próprio <iframe>, como no HTML exportado. Não recebe cliques no editor (bolt-runtime.css):
  // seleciona-se o contentor ou pelas camadas.
  editor.Components.addType('map', { extendView: 'default' });

  // Nomes legíveis no destaque do canvas, derivados do modelo (sem os gravar).
  for (const type of [
    'wrapper', 'default', 'text', 'image', 'link', 'bolt-button', 'bolt-section', 'bolt-navbar', 'bolt-footer', 'bolt-container', 'bolt-columns', 'bolt-column',
    'bolt-row', 'bolt-col', 'bolt-icon', 'bolt-link-box', 'bolt-list', 'bolt-list-item', 'bolt-menu', 'bolt-menu-toggle', 'bolt-menu-items',
    'bolt-carousel', 'bolt-carousel-track', 'bolt-slide', 'bolt-carousel-pagination', 'bolt-carousel-prev', 'bolt-carousel-next',
    'bolt-accordion', 'bolt-accordion-item', 'bolt-accordion-title', 'bolt-input', 'svg',
  ]) {
    editor.Components.addType(type, {
      model: {
        getName() {
          return displayName(this);
        },
      },
    });
  }
}
