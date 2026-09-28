import grapesjs, { type Editor, type EditorConfig } from 'grapesjs';
import { boltTypesPlugin } from './boltTypes';
import { identityPlugin, sweepAllPages } from './identity';
import type { GrapesProjectData } from '../contract/boltDocument';

export interface CreateBoltEditorOptions {
  /** Elemento onde montar o editor; omitir = headless (testes). */
  container?: HTMLElement;
  projectData?: GrapesProjectData;
  extra?: Partial<EditorConfig>;
}

export function createBoltEditor(opts: CreateBoltEditorOptions = {}): Editor {
  const headless = !opts.container;
  const editor = grapesjs.init({
    headless,
    ...(opts.container ? { container: opts.container } : {}),
    height: '100%',
    // A persistência é da camada Bolt (SaveQueue), nunca do storage manager do motor.
    storageManager: false,
    // Sem estilos inline: estilos por regra, para a responsividade por breakpoint.
    avoidInlineStyle: true,
    plugins: [boltTypesPlugin, identityPlugin],
    ...(opts.projectData ? { projectData: opts.projectData } : {}),
    ...opts.extra,
  });
  // Em headless, `projectData` é carregado de forma síncrona antes de 'load'; garantir ids já.
  sweepAllPages(editor);
  return editor;
}

export function getProjectData(editor: Editor): GrapesProjectData {
  return editor.getProjectData() as GrapesProjectData;
}
