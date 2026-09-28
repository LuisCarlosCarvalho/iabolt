import type { Component, Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpLeft, Copy, Monitor, Redo2, Save, Smartphone, Tablet, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ModeBadge } from '../app/AppShell';
import { Link, navigate } from '../app/router';
import { persistenceLabel, useServices } from '../app/services';
import { Button, errorMessage, IconButton, Modal, Spinner, StatePanel } from '../app/ui';
import type { AssetUrlMap } from '../assets/assetRefs';
import { resolveForDisplay } from '../assets/resolveForDisplay';
import type { BoltDocument, GrapesProjectData } from '../contract/boltDocument';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { contentHint, displayName } from '../engine/labels';
import { duplicate, moveBy, remove, selectParent } from '../engine/operations';
import { deviceById, type DeviceId } from '../engine/styles';
import { ProjectNotFoundError, type PersistenceMode, type ProjectSummary } from '../persistence/repository';
import { SaveQueue, type SaveState } from '../persistence/saveQueue';
import { BlocksPanel } from './BlocksPanel';
import { ImageDialog } from './ImageDialog';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { syncEditing, useEditorTick } from './useEditorTick';

const AUTOSAVE_MS = 1200;

function saveLabel(state: SaveState, mode: PersistenceMode): string {
  switch (state) {
    case 'saved':
      return `Alterações guardadas ${persistenceLabel(mode)}`;
    case 'dirty':
      return 'Alterações por guardar';
    case 'saving':
      return 'A guardar…';
    case 'error':
      return 'Não foi possível guardar';
    case 'conflict':
      return 'Conflito: versão mais recente noutro sítio';
  }
}

type LoadState = { status: 'loading' } | { status: 'ready'; doc: BoltDocument; summary: ProjectSummary; display: GrapesProjectData; urls: AssetUrlMap } | { status: 'not-found' } | { status: 'error'; message: string };

export function EditorPage({ projectId }: { projectId: string }) {
  const { catalog, mode, assets } = useServices();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([catalog.load(projectId), catalog.summary(projectId)])
      // Imagens privadas: as referências guardadas passam a URLs assinados só para mostrar.
      .then(async ([doc, summary]) => ({ doc, summary, ...(await resolveForDisplay(assets, doc.projectData)) }))
      .then(({ doc, summary, data, urls }) => active && setLoad({ status: 'ready', doc, summary, display: data, urls }))
      .catch((e: unknown) => {
        if (!active) return;
        setLoad(e instanceof ProjectNotFoundError ? { status: 'not-found' } : { status: 'error', message: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [catalog, assets, projectId, attempt]);

  if (load.status === 'ready') return <EditorWorkspace doc={load.doc} summary={load.summary} display={load.display} urls={load.urls} />;

  return (
    <div className="shell">
      <main className="page">
        {load.status === 'loading' && (
          <div className="center-fill">
            <Spinner label="A abrir o projeto…" />
          </div>
        )}
        {load.status === 'not-found' && (
          <StatePanel title="Projeto não encontrado" actions={<Link to="/" className="btn btn-primary">Voltar aos projetos</Link>}>
            Este projeto não existe, foi removido ou não tem acesso a ele{mode === 'local' ? ' neste browser' : ''}.
          </StatePanel>
        )}
        {load.status === 'error' && (
          <StatePanel
            title="Não foi possível abrir o projeto"
            actions={
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    setLoad({ status: 'loading' });
                    setAttempt((n) => n + 1);
                  }}
                >
                  Tentar de novo
                </Button>
                <Link to="/" className="btn">Voltar aos projetos</Link>
              </>
            }
          >
            {load.message}
          </StatePanel>
        )}
      </main>
    </div>
  );
}

function EditorWorkspace({ doc, summary, display, urls }: { doc: BoltDocument; summary: ProjectSummary; display: GrapesProjectData; urls: AssetUrlMap }) {
  const { catalog, mode } = useServices();
  const canvasRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<SaveQueue | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(doc.revision);
  const [device, setDeviceState] = useState<DeviceId>('desktop');
  const [leftTab, setLeftTab] = useState<'layers' | 'blocks'>('layers');
  const [imageTarget, setImageTarget] = useState<Component | null>(null);
  const [name, setName] = useState(summary.name);
  const [savedName, setSavedName] = useState(summary.name);
  const [leaving, setLeaving] = useState(false);

  // Monta o motor com o documento validado. A fila de gravação só existe depois do 'load'.
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    let disposed = false;
    let timer: number | undefined;
    // Uma falha aqui chega ao AppErrorBoundary com a mensagem do motor.
    const ed = createBoltEditor({
        container,
        projectData: display,
        extra: {
          panels: { defaults: [] },
          showToolbar: false,
          showOffsets: true,
          undoManager: { trackSelection: false },
        },
      });
    // O fluxo de imagem do motor (duplo clique, largar bloco) abre o diálogo do Bolt IA.
    ed.on('command:run:before:core:open-assets', (data: { options: { abort?: boolean; target?: Component } }) => {
      data.options.abort = true;
      const target = data.options.target ?? ed.getSelected();
      if (target?.is('image')) setImageTarget(target);
    });
    ed.on('load', () => {
      if (disposed) return;
      ed.UndoManager.clear();
      const queue = new SaveQueue({
        repository: catalog,
        projectId: doc.projectId,
        loadedRevision: doc.revision,
        // Grava referências estáveis, nunca os URLs temporários de visualização.
        snapshot: () => urls.forStorage(getProjectData(ed)),
        onState: (s, info) => {
          setSaveState(s);
          if (info?.revision !== undefined) setRevision(info.revision);
          setSaveError(s === 'error' ? (info?.error ?? 'Erro desconhecido') : null);
        },
      });
      queueRef.current = queue;
      ed.on('update', () => {
        queue.markDirty();
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void queue.flush(), AUTOSAVE_MS);
      });
      setEditor(ed);
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      queueRef.current?.dispose();
      queueRef.current = null;
      // Nenhum outro efeito pode usar um editor já destruído (zoom, atalhos, painéis).
      setEditor(null);
      ed.destroy();
    };
  }, [catalog, doc, display, urls]);

  const saveNow = useCallback(async () => {
    const queue = queueRef.current;
    if (!editor || !queue) return;
    await syncEditing(editor);
    await queue.flush();
  }, [editor]);

  // Ctrl/Cmd+S grava; sair com alterações por gravar pede confirmação ao browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = queueRef.current?.currentState;
      if (s === 'dirty' || s === 'saving' || s === 'error') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [saveNow]);

  const goBack = async () => {
    await saveNow();
    const s = queueRef.current?.currentState;
    if (s === 'error' || s === 'conflict') setLeaving(true);
    else navigate('/');
  };

  const changeDevice = (id: DeviceId) => {
    editor?.setDevice(id);
    setDeviceState(id);
  };

  // A moldura tem a largura real do dispositivo (1280 px no computador) e o zoom ajusta-a
  // à área disponível. Assim cada dispositivo mostra as regras de estilo que lhe pertencem.
  useEffect(() => {
    const host = canvasRef.current;
    if (!editor || !host) return;
    const fit = () => {
      const frameWidth = parseInt(deviceById(device).width, 10) || 1280;
      const available = host.clientWidth - 48;
      const zoom = Math.max(25, Math.min(100, Math.floor((available / frameWidth) * 100)));
      host.style.setProperty('--bolt-zoom', String(zoom / 100));
      editor.Canvas.setZoom(zoom);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [editor, device]);

  const commitName = async () => {
    const clean = name.trim();
    if (!clean || clean === savedName) {
      setName(savedName);
      return;
    }
    try {
      await catalog.rename(doc.projectId, clean);
      setSavedName(clean);
    } catch (e) {
      setSaveError(errorMessage(e));
      setName(savedName);
    }
  };

  const diagnostics = (
    <details className="diag">
      <summary>Diagnóstico técnico</summary>
      <dl data-testid="diagnostics">
        <dt>Projeto</dt>
        <dd>{doc.projectId}</dd>
        <dt>Revisão</dt>
        <dd data-testid="diag-revision">{revision}</dd>
        <dt>Gravação</dt>
        <dd>{mode === 'server' ? 'Servidor (Supabase)' : 'Local (IndexedDB, este browser)'}</dd>
        <dt>Estado</dt>
        <dd>{saveState}</dd>
        <dt>Elemento</dt>
        <dd data-testid="diag-selected">{editor?.getSelected()?.getId() ?? '—'}</dd>
        <dt>Tipo interno</dt>
        <dd>{editor?.getSelected()?.get('type') ?? '—'}</dd>
        <dt>Motor</dt>
        <dd>
          {doc.engine.name} {doc.engine.version}
        </dd>
      </dl>
    </details>
  );

  return (
    <div className="editor">
      <header className="editor-top">
        <IconButton label="Voltar aos projetos" data-testid="back-to-projects" onClick={() => void goBack()}>
          <ArrowLeft />
        </IconButton>
        <input
          className="project-name"
          aria-label="Nome do projeto"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="divider" />
        <div className="device-tabs" role="group" aria-label="Pré-visualização por dispositivo">
          <IconButton label="Computador" aria-pressed={device === 'desktop'} onClick={() => changeDevice('desktop')} disabled={!editor}>
            <Monitor />
          </IconButton>
          <IconButton label="Tablet" aria-pressed={device === 'tablet'} onClick={() => changeDevice('tablet')} disabled={!editor}>
            <Tablet />
          </IconButton>
          <IconButton label="Telemóvel" aria-pressed={device === 'mobile'} onClick={() => changeDevice('mobile')} disabled={!editor}>
            <Smartphone />
          </IconButton>
        </div>
        {editor && <HistoryButtons editor={editor} />}
        <div className="shell-spacer" />
        <ModeBadge />
        {/* Até o motor carregar, nada está pronto para editar: não mostrar «guardado» ainda. */}
        <span className="save-status" data-state={editor ? saveState : 'saving'} data-testid="save-status" aria-live="polite" title={saveError ?? undefined}>
          <span className="save-dot" aria-hidden="true" />
          {editor ? saveLabel(saveState, mode) : 'A preparar o editor…'}
        </span>
        <Button variant="primary" data-testid="save" disabled={!editor || saveState === 'saving' || saveState === 'conflict'} onClick={() => void saveNow()}>
          <Save aria-hidden="true" /> Guardar
        </Button>
      </header>

      <aside className="side side-left" aria-label="Estrutura e componentes">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className="tab" aria-selected={leftTab === 'layers'} onClick={() => setLeftTab('layers')}>
            Estrutura
          </button>
          <button type="button" role="tab" className="tab" aria-selected={leftTab === 'blocks'} onClick={() => setLeftTab('blocks')} data-testid="tab-blocks">
            Adicionar
          </button>
        </div>
        {editor && leftTab === 'layers' && <TickedLayers editor={editor} />}
        {editor && leftTab === 'blocks' && <BlocksPanel editor={editor} onImageInserted={setImageTarget} />}
      </aside>

      <section className="main" aria-label="Canvas">
        {saveState === 'conflict' && (
          <div className="notice notice-error" role="alert" style={{ borderRadius: 0 }}>
            <div>
              <strong>Este projeto foi alterado noutro separador ou por outra pessoa.</strong> As suas últimas alterações não foram gravadas, para não
              sobrescrever a versão mais recente.{' '}
              <Button onClick={() => window.location.reload()}>Abrir a versão mais recente</Button>
            </div>
          </div>
        )}
        {saveState === 'error' && saveError && (
          <div className="notice notice-error" role="alert" style={{ borderRadius: 0 }}>
            <div>
              <strong>Não foi possível guardar.</strong> {saveError} As alterações continuam no editor.{' '}
              <Button onClick={() => void saveNow()}>Tentar de novo</Button>
            </div>
          </div>
        )}
        {editor ? <ContextBar editor={editor} /> : <div className="context-bar" />}
        <div className="canvas-wrap">
          <div className="canvas-host" ref={canvasRef} data-testid="canvas" />
          {!editor && (
            <div className="canvas-overlay"><Spinner label="A preparar o editor…" /></div>
          )}
        </div>
      </section>

      <aside className="side side-right" aria-label="Propriedades">
        {editor ? (
          <TickedProperties editor={editor} device={device} onReplaceImage={setImageTarget} footer={diagnostics} />
        ) : (
          diagnostics
        )}
      </aside>

      {editor && (
        <ImageDialog
          editor={editor}
          target={imageTarget}
          projectId={doc.projectId}
          urls={urls}
          {...(summary.workspaceId ? { workspaceId: summary.workspaceId } : {})}
          onClose={() => setImageTarget(null)}
        />
      )}

      <Modal
        open={leaving}
        title="Sair sem guardar?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button onClick={() => setLeaving(false)}>Ficar no editor</Button>
            <Button variant="danger" onClick={() => navigate('/')}>
              Sair sem guardar
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {saveState === 'conflict'
            ? 'Existe uma versão mais recente deste projeto. Se sair, as alterações feitas aqui perdem-se.'
            : `A última gravação falhou${saveError ? ` (${saveError})` : ''}. Se sair agora, as alterações por guardar perdem-se.`}
        </p>
      </Modal>
    </div>
  );
}

/** Componentes que re-renderizam com os eventos do motor. */
function TickedLayers({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  return <LayersPanel editor={editor} />;
}

function TickedProperties(props: { editor: Editor; device: DeviceId; onReplaceImage: (c: Component) => void; footer: ReactNode }) {
  useEditorTick(props.editor);
  return <PropertiesPanel {...props} />;
}

function HistoryButtons({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const um = editor.UndoManager;
  return (
    <div className="device-tabs" role="group" aria-label="Histórico">
      <IconButton label="Desfazer (Ctrl+Z)" data-testid="undo" disabled={!um.hasUndo()} onClick={() => um.undo()}>
        <Undo2 />
      </IconButton>
      <IconButton label="Refazer (Ctrl+Shift+Z)" data-testid="redo" disabled={!um.hasRedo()} onClick={() => um.redo()}>
        <Redo2 />
      </IconButton>
    </div>
  );
}

function ContextBar({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const c = editor.getSelected();
  if (!c) {
    return (
      <div className="context-bar" data-testid="context-bar">
        <span className="context-empty">Clique num elemento da página para o selecionar. Duplo clique num texto para escrever.</span>
      </div>
    );
  }
  const parent = c.parent();
  const idx = c.index();
  const count = parent?.components().length ?? 0;
  const hint = contentHint(c);
  const id = c.getId();
  return (
    <div className="context-bar" data-testid="context-bar">
      <span className="context-name">
        <strong data-testid="selected-name">{displayName(c)}</strong>
        {hint && <span>{hint}</span>}
      </span>
      <Button variant="ghost" data-testid="select-parent" disabled={!parent} onClick={() => selectParent(editor)} title={parent ? `Selecionar ${displayName(parent)}` : undefined}>
        <ArrowUpLeft aria-hidden="true" /> Selecionar pai
      </Button>
      <IconButton label="Mover para cima" data-testid="move-up" disabled={!parent || idx === 0} onClick={() => moveBy(editor, id, -1)}>
        <ArrowUp />
      </IconButton>
      <IconButton label="Mover para baixo" data-testid="move-down" disabled={!parent || idx >= count - 1} onClick={() => moveBy(editor, id, 1)}>
        <ArrowDown />
      </IconButton>
      <Button variant="ghost" data-testid="duplicate" disabled={!parent} onClick={() => duplicate(editor, id)}>
        <Copy aria-hidden="true" /> Duplicar
      </Button>
      <Button variant="ghost" data-testid="delete" disabled={!parent} onClick={() => remove(editor, id)}>
        <Trash2 aria-hidden="true" /> Eliminar
      </Button>
    </div>
  );
}
