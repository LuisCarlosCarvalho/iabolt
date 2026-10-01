import type { Editor } from 'grapesjs';
import type { GrapesProjectData } from '../contract/boltDocument';
import { renderProjectHtml } from './createBoltEditor';

/**
 * Runtime próprio dos componentes interativos (menu móvel, carrossel), servido pela aplicação
 * em `public/assets/runtime/`. É o ÚNICO script que corre no canvas e nas pré-visualizações:
 * scripts e manipuladores de eventos dos ficheiros importados são removidos na importação e,
 * nas pré-visualizações, uma Content-Security-Policy só autoriza este ficheiro.
 */
declare global {
  interface Window {
    __boltRuntime?: { mode: string; scan(): void; show(el: Element): void };
  }
}

export type RuntimeMode = 'editor' | 'preview' | 'site';

export function runtimeUrls(origin: string = window.location.origin): { script: string; style: string } {
  const base = `${origin}${import.meta.env.BASE_URL}assets/runtime/`;
  return { script: `${base}bolt-runtime.js`, style: `${base}bolt-runtime.css` };
}

/** Configuração do canvas do editor: o runtime em modo «editor» (sem autoplay nem clones). */
export function canvasRuntimeConfig() {
  const { script, style } = runtimeUrls();
  return { scripts: [{ src: script, 'data-mode': 'editor' }], styles: [style] };
}

/** Mostra no canvas o slide do elemento selecionado (se estiver dentro de um carrossel). */
export function followSelectionInCarousels(editor: Editor): void {
  editor.on('component:selected', () => {
    const el = editor.getSelected()?.getEl();
    const win = editor.Canvas.getWindow();
    if (el && win?.__boltRuntime) win.__boltRuntime.show(el);
  });
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Documento HTML completo de pré-visualização, gerado do JSON do projeto pelo motor.
 * `interactive`: inclui o runtime (menu, carrossel, avisos de imagens em falta e de formulários
 * sem envio). O iframe tem de ter `sandbox="allow-scripts"` (sem allow-same-origin): origem
 * opaca, sem acesso à aplicação, sem navegação do topo e sem envio de formulários.
 */
export function previewDocument(data: GrapesProjectData, opts: { interactive?: boolean; scroll?: boolean; origin?: string; pageId?: string; focusId?: string } = {}): string {
  const { html, css } = renderProjectHtml(data, opts.pageId);
  const { script, style } = runtimeUrls(opts.origin);
  const csp = [
    "default-src 'none'",
    `script-src ${opts.interactive ? script : "'none'"}`,
    "style-src * 'unsafe-inline'",
    'img-src * data: blob:',
    'font-src * data:',
    'media-src * data: blob:',
    // Só mapas do Google incorporados (o único iframe que a importação aceita).
    'frame-src https://maps.google.com https://www.google.com',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  const plain = html.startsWith('<body') ? html : `<body>${html}</body>`;
  // Elemento em foco (antes/depois do assistente): contornado e mostrado pelo runtime.
  const focus = opts.focusId ? escapeAttr(opts.focusId) : '';
  const body = focus ? plain.replace(/^<body/, `<body data-bolt-focus="${focus}"`) : plain;
  const focusCss = focus ? `[id="${focus}"]{outline:3px dashed #f59e0b;outline-offset:4px}` : '';
  const runtime = opts.interactive ? `<script src="${escapeAttr(script)}" data-mode="preview"></script>` : '';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<link rel="stylesheet" href="${escapeAttr(style)}">`,
    `<style>${opts.scroll ? '' : 'html{overflow:hidden}'}${focusCss}${css.replace(/<\/style/gi, '<\\/style')}</style>`,
    '</head>',
    body.replace(/<\/body>\s*$/, `${runtime}</body>`),
    '</html>',
  ].join('');
}
