import type { Editor } from 'grapesjs';
import { Copy, FilePlus2, FileText, House, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, errorMessage, Modal } from '../app/ui';
import { addPage, duplicatePage, linksToPage, listPages, removePage, renamePage, selectPage, setHomePage } from '../engine/pages';

/**
 * Páginas do projeto (acima das camadas). Lê sempre o gestor de páginas do motor: não há lista
 * paralela. As ações aplicam-se à página atual; mudar de página não altera o documento.
 */
export function PagesPanel({ editor }: { editor: Editor }) {
  const pages = listPages(editor);
  const current = pages.find((p) => p.selected) ?? pages[0];
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const commitRename = (e?: FormEvent) => {
    e?.preventDefault();
    if (!renaming) return;
    const { id, value } = renaming;
    setRenaming(null);
    run(() => renamePage(editor, id, value));
  };

  const target = removing ? pages.find((p) => p.id === removing) : undefined;
  const successor = target?.isHome ? pages.find((p) => p.id !== target.id) : undefined;
  const links = target ? linksToPage(editor, target.id) : 0;

  return (
    <section className="pages-panel" aria-label="Páginas" data-testid="pages-panel">
      <div className="pages-head">
        <span className="panel-title">Páginas</span>
        <button type="button" className="pages-add" onClick={() => run(() => addPage(editor))} data-testid="page-add">
          <FilePlus2 aria-hidden="true" /> Nova página
        </button>
      </div>
      <ul className="page-list" aria-label="Páginas do projeto">
        {pages.map((p) => (
          <li key={p.id}>
            {renaming?.id === p.id ? (
              <form className="page-rename" onSubmit={commitRename}>
                <input
                  className="input"
                  aria-label={`Novo nome de ${p.name}`}
                  value={renaming.value}
                  autoFocus
                  maxLength={80}
                  onChange={(e) => setRenaming({ id: p.id, value: e.target.value })}
                  onBlur={() => commitRename()}
                  onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  data-testid="page-rename-input"
                />
              </form>
            ) : (
              <button
                type="button"
                className={`page-row ${p.selected ? 'is-selected' : ''}`}
                aria-current={p.selected ? 'page' : undefined}
                onClick={() => selectPage(editor, p.id)}
                title={`Abrir ${p.name} (/${p.slug})`}
                data-testid="page-row"
                data-page-id={p.id}
              >
                <FileText aria-hidden="true" />
                <span className="page-name">{p.name}</span>
                {p.isHome && (
                  <span className="home-badge" title="Página inicial do site">
                    Inicial
                  </span>
                )}
                <span className="page-slug">/{p.slug}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {current && (
        <div className="page-actions" role="toolbar" aria-label={`Ações da página ${current.name}`}>
          <button type="button" className="page-action" onClick={() => setRenaming({ id: current.id, value: current.name })} data-testid="page-rename">
            <Pencil aria-hidden="true" /> Nome
          </button>
          <button type="button" className="page-action" onClick={() => run(() => duplicatePage(editor, current.id))} data-testid="page-duplicate">
            <Copy aria-hidden="true" /> Duplicar
          </button>
          <button type="button" className="page-action" disabled={current.isHome} title={current.isHome ? 'Já é a página inicial' : 'Tornar esta a página inicial'} onClick={() => run(() => setHomePage(editor, current.id))} data-testid="page-home">
            <House aria-hidden="true" /> Inicial
          </button>
          <button
            type="button"
            className="page-action is-danger"
            disabled={pages.length <= 1}
            title={pages.length <= 1 ? 'Um projeto tem sempre pelo menos uma página' : 'Eliminar esta página'}
            onClick={() => setRemoving(current.id)}
            data-testid="page-delete"
          >
            <Trash2 aria-hidden="true" /> Eliminar
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert" style={{ padding: '0 8px' }}>
          {error}
        </p>
      )}

      <Modal
        open={!!target}
        title={`Eliminar a página «${target?.name ?? ''}»?`}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button
              variant="danger"
              data-testid="page-delete-confirm"
              onClick={() => {
                const id = removing;
                setRemoving(null);
                if (id) run(() => removePage(editor, id));
              }}
            >
              Eliminar página
            </Button>
          </>
        }
      >
        <div className="page-delete-info" data-testid="page-delete-info">
          <p style={{ margin: 0 }}>O conteúdo desta página sai do projeto. Pode repô-la com «Desfazer» enquanto estiver no editor.</p>
          {successor && (
            <p style={{ margin: 0 }}>
              É a <strong>página inicial</strong>: a página inicial passa a ser <strong>«{successor.name}»</strong>.
            </p>
          )}
          {links > 0 && (
            <p style={{ margin: 0 }}>
              {links === 1 ? 'Há 1 ligação' : `Há ${links} ligações`} para esta página (/{target?.slug}), {links === 1 ? 'que fica' : 'que ficam'} sem destino.
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
