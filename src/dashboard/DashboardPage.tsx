import { FilePlus2, FileUp, FolderOpen, Info, LayoutTemplate, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, projectPath } from '../app/router';
import { resolveForDisplay } from '../assets/resolveForDisplay';
import { useServices } from '../app/services';
import { SitePreview } from '../app/SitePreview';
import { Button, errorMessage, formatDateTime, formatRelative, IconButton, Modal, StatePanel } from '../app/ui';
import type { ProjectSummary } from '../persistence/repository';
import { templateName } from '../templates/registry';
import { ExportLocalButton, LocalProjectsPanel } from './LocalProjectsPanel';

type ListState = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] } | { status: 'error'; message: string };

export function DashboardPage() {
  const { catalog, mode } = useServices();
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  // Cada pedido de lista tem um número; o resultado só conta se for do pedido atual.
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ request: number; state: ListState } | null>(null);
  const state: ListState = result?.request === request ? result.state : { status: 'loading' };
  const load = () => setRequest((n) => n + 1);

  useEffect(() => {
    let active = true;
    catalog
      .list()
      .then((projects) => active && setResult({ request, state: { status: 'ready', projects } }))
      .catch((e: unknown) => active && setResult({ request, state: { status: 'error', message: errorMessage(e) } }));
    return () => {
      active = false;
    };
  }, [catalog, request]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Projetos</h1>
          <p>Crie uma página a partir de um template, edite-a visualmente e volte a ela quando quiser.</p>
        </div>
        <div className="page-actions">
          {mode === 'local' && state.status === 'ready' && state.projects.length > 0 && <ExportLocalButton />}
          <Link to="/importar" className="btn btn-lg" data-testid="open-import">
            <FileUp aria-hidden="true" />
            Importar
          </Link>
          <Link to="/templates" className="btn btn-primary btn-lg">
            <FilePlus2 aria-hidden="true" />
            Novo projeto
          </Link>
        </div>
      </div>

      {mode === 'local' && (
        <div className="notice" role="note">
          <Info aria-hidden="true" />
          <div>
            <strong>Servidor ainda não configurado.</strong> Os projetos ficam guardados só neste browser (IndexedDB). Não são enviados para a base de dados e
            desaparecem se os dados do site forem limpos. Quando o servidor for ativado, estes projetos continuam neste browser e podem ser copiados para a
            sua conta. Antes disso, guarde uma cópia de segurança com «Exportar cópia de segurança».
          </div>
        </div>
      )}

      {mode === 'server' && <LocalProjectsPanel onCopied={load} />}

      {state.status === 'loading' && (
        <div className="card-grid" aria-busy="true" aria-label="A carregar projetos">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {state.status === 'error' && (
        <StatePanel
          title="Não foi possível carregar os projetos"
          actions={
            <Button onClick={load}>
              <RefreshCw aria-hidden="true" /> Tentar de novo
            </Button>
          }
        >
          {state.message}
        </StatePanel>
      )}

      {state.status === 'ready' && state.projects.length === 0 && (
        <StatePanel
          icon={<FolderOpen />}
          title="Ainda não tem projetos"
          actions={
            <>
              <Link to="/templates" className="btn btn-primary btn-lg">
                <LayoutTemplate aria-hidden="true" /> Escolher um template
              </Link>
            </>
          }
        >
          Comece por um template pronto ou por uma página em branco. O projeto aparece aqui assim que o criar.
        </StatePanel>
      )}

      {state.status === 'ready' && state.projects.length > 0 && (
        <ul className="card-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Lista de projetos">
          {state.projects.map((p) => (
            <li key={p.id}>
              <ProjectCard project={p} onRename={() => setRenaming(p)} onRemove={() => setRemoving(p)} />
            </li>
          ))}
        </ul>
      )}

      <RenameDialog
        key={renaming?.id ?? 'fechado'}
        project={renaming}
        onClose={() => setRenaming(null)}
        onDone={() => {
          setRenaming(null);
          load();
        }}
      />
      <RemoveDialog
        project={removing}
        onClose={() => setRemoving(null)}
        onDone={() => {
          setRemoving(null);
          load();
        }}
      />
    </main>
  );
}

function ProjectCard({ project, onRename, onRemove }: { project: ProjectSummary; onRename: () => void; onRemove: () => void }) {
  const { catalog, assets } = useServices();
  const [menu, setMenu] = useState(false);
  const origin = templateName(project.templateId);
  return (
    <article className="card" data-testid="project-card">
      <SitePreview
        label={`Pré-visualização de ${project.name}`}
        source={{ key: `${project.id}:${project.revision}`, load: () => catalog.load(project.id).then(async (d) => (await resolveForDisplay(assets, d.projectData)).data) }}
      />
      <Link to={projectPath(project.id)} className="card-link" aria-label={`Abrir ${project.name}`} />
      <div className="card-body">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{project.name}</div>
          <div className="card-meta" title={formatDateTime(project.updatedAt)}>
            Atualizado {formatRelative(project.updatedAt)}
          </div>
          {origin && <span className="card-tag">{origin}</span>}
        </div>
        <div className="card-menu">
          <IconButton label={`Opções de ${project.name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal />
          </IconButton>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); onRename(); }}>
                <Pencil size={15} aria-hidden="true" /> Mudar o nome
              </button>
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }}>
                <Trash2 size={15} aria-hidden="true" /> Remover
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function RenameDialog({ project, onClose, onDone }: { project: ProjectSummary | null; onClose: () => void; onDone: () => void }) {
  const { catalog } = useServices();
  // Montado de novo para cada projeto (key no pai): o estado inicial vem do projeto.
  const [name, setName] = useState(project?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setBusy(true);
    try {
      await catalog.rename(project.id, name);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={project !== null} title="Mudar o nome do projeto" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span>Nome</span>
          <input className="input" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>Guardar nome</Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveDialog({ project, onClose, onDone }: { project: ProjectSummary | null; onClose: () => void; onDone: () => void }) {
  const { catalog, mode } = useServices();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      await catalog.archive(project.id);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={project !== null}
      title="Remover projeto"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>Remover</Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        «{project?.name}» deixa de aparecer na lista.{' '}
        {mode === 'server' ? 'O projeto e o histórico de revisões ficam arquivados no servidor.' : 'Os dados ficam marcados como arquivados neste browser.'}
      </p>
      {error && <p className="error-text" role="alert">{error}</p>}
    </Modal>
  );
}
