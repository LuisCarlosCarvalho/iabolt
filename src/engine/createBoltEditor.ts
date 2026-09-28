import grapesjs, { type Editor, type EditorConfig } from 'grapesjs';
import { boltTypesPlugin } from './boltTypes';
import { blocksPlugin } from './blocks';
import { identityPlugin, sweepAllPages } from './identity';
import { deviceManagerConfig } from './styles';
import type { GrapesProjectData } from '../contract/boltDocument';

/** Versão do motor em execução, gravada no envelope BoltDocument. */
export const ENGINE_VERSION: string = grapesjs.version;

export interface CreateBoltEditorOptions {
  /** Elemento onde montar o editor; omitir = headless (testes, pré-visualizações). */
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
    // Estilos de um elemento vão para a regra `#id` dele, não para classes partilhadas.
    selectorManager: { componentFirst: true },
    deviceManager: deviceManagerConfig(),
    plugins: [boltTypesPlugin, identityPlugin, blocksPlugin],
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

/** HTML e CSS exportados de um projeto (pré-visualizações; nunca a forma persistida). */
export function renderProjectHtml(projectData: GrapesProjectData): { html: string; css: string } {
  const editor = createBoltEditor({ projectData });
  try {
    return { html: editor.getHtml(), css: editor.getCss() ?? '' };
  } finally {
    editor.destroy();
  }
}
