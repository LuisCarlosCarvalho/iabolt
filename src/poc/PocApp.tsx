import { useEffect, useRef, useState } from 'react';
import type { Component, Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { POC_FIXTURE } from '../engine/pocFixture';
import { duplicate, remove, selectParent } from '../engine/operations';
import { LocalDevRepository } from '../persistence/localDevRepository';
import { SaveQueue, type SaveState } from '../persistence/saveQueue';
import type { GrapesProjectData } from '../contract/boltDocument';

/**
 * PROVA TÉCNICA DA FASE 0 — não é a interface do produto.
 * React controla a moldura (botões, estado de gravação); o GrapesJS controla o documento.
 */
const ENGINE_VERSION = '0.23.6';
const STATE_LABEL: Record<SaveState, string> = {
  saved: 'Guardado',
  dirty: 'Alterações por guardar',
  saving: 'A guardar…',
  error: 'Falha ao guardar',
  conflict: 'Conflito de revisão',
};

function fixtureProjectData(): GrapesProjectData {
  const tmp = createBoltEditor();
  tmp.setComponents(POC_FIXTURE);
  const data = getProjectData(tmp);
  tmp.destroy();
  return data;
}

export function PocApp() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [queue, setQueue] = useState<SaveQueue | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [revision, setRevision] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string>('—');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let ed: Editor | null = null;
    let q: SaveQueue | null = null;
    let timer: number | undefined;
    const repo = new LocalDevRepository(ENGINE_VERSION);

    (async () => {
      const url = new URL(window.location.href);
      let projectId = url.searchParams.get('project');
      if (!projectId) {
        const created = await repo.create(crypto.randomUUID(), fixtureProjectData());
        projectId = created.projectId;
        url.searchParams.set('project', projectId);
        window.history.replaceState(null, '', url);
      }
      const doc = await repo.load(projectId);
      if (disposed || !canvasRef.current || !layersRef.current) return;

      ed = createBoltEditor({
        container: canvasRef.current,
        projectData: doc.projectData,
        extra: { layerManager: { appendTo: layersRef.current }, panels: { defaults: [] } },
      });
      // Autosave só depois do carregamento validado.
      ed.on('load', () => {
        if (disposed || !ed) return;
        const loaded = ed;
        q = new SaveQueue({
          repository: repo,
          projectId: doc.projectId,
          loadedRevision: doc.revision,
          snapshot: () => getProjectData(loaded),
          onState: (s, info) => {
            setSaveState(s);
            if (info?.revision !== undefined) setRevision(info.revision);
            if (info?.error) setError(info.error);
          },
        });
        setRevision(doc.revision);
        setQueue(q);
        ed.on('update', () => {
          q?.markDirty();
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void q?.flush(), 1000);
        });
        ed.on('component:toggled', () => setSelectedId(ed?.getSelected()?.getId() ?? '—'));
        setEditor(ed);
      });
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      q?.dispose();
      ed?.destroy();
    };
  }, []);

  const withSelected = (fn: (ed: Editor, c: Component) => void) => () => {
    const c = editor?.getSelected();
    if (editor && c) fn(editor, c);
  };

  return (
    <div className="poc">
      <header className="poc-bar" role="toolbar" aria-label="Ferramentas da prova técnica">
        <strong>Bolt IA · prova técnica</strong>
        <button type="button" data-testid="select-parent" disabled={!editor} onClick={() => editor && selectParent(editor)}>Selecionar pai</button>
        <button type="button" data-testid="duplicate" disabled={!editor} onClick={withSelected((ed, c) => duplicate(ed, c.getId()))}>Duplicar</button>
        <button type="button" data-testid="delete" disabled={!editor} onClick={withSelected((ed, c) => remove(ed, c.getId()))}>Eliminar</button>
        <button type="button" data-testid="undo" disabled={!editor} onClick={() => editor?.UndoManager.undo()}>Desfazer</button>
        <button type="button" data-testid="redo" disabled={!editor} onClick={() => editor?.UndoManager.redo()}>Refazer</button>
        <button type="button" data-testid="save" disabled={!queue} onClick={() => void queue?.flush()}>Guardar</button>
        <span data-testid="save-state" aria-live="polite">{STATE_LABEL[saveState]}</span>
        <span data-testid="revision">rev {revision ?? '—'}</span>
        <span data-testid="selected-id">sel {selectedId}</span>
      </header>
      {error && <p role="alert" data-testid="error">{error}</p>}
      <main className="poc-main">
        <aside className="poc-layers" aria-label="Navigator" ref={layersRef} />
        <div className="poc-canvas" ref={canvasRef} />
      </main>
    </div>
  );
}
