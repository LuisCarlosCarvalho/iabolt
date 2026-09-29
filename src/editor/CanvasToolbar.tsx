import type { Component, Editor } from 'grapesjs';
import { ArrowUpLeft, Columns2, Copy, Heading, Image as ImageIcon, ImageUp, LayoutPanelTop, Move, MousePointerClick, PenLine, Plus, Trash2, Type, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { BLOCKS, type BlockId } from '../engine/blocks';
import { displayName } from '../engine/labels';
import { canInsert, duplicate, insertAt, isPlainText, isTextLike, remove, selectParent, type InsertPosition } from '../engine/operations';
import { useEditorTick } from './useEditorTick';

/**
 * Barra de ferramentas junto ao elemento selecionado, sobre o canvas (fora do iframe).
 * Não tem estado de seleção próprio: lê sempre `editor.getSelected()` e usa as mesmas
 * operações do resto do editor (modelo, histórico e gravação do motor).
 * A posição acompanha scroll, zoom, dispositivo e mudanças de tamanho (medida por fotograma).
 */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const ICONS: Record<BlockId, ReactNode> = {
  section: <LayoutPanelTop />,
  columns: <Columns2 />,
  heading: <Heading />,
  text: <Type />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
};

const POSITIONS: ReadonlyArray<{ value: InsertPosition; label: string }> = [
  { value: 'before', label: 'Antes' },
  { value: 'inside', label: 'Dentro' },
  { value: 'after', label: 'Depois' },
];

const TOOLBAR_H = 34;
const GAP = 6;

function hasOnActive(view: object): view is { onActive(ev: MouseEvent): unknown } {
  return typeof Reflect.get(view, 'onActive') === 'function';
}

/** Retângulo do elemento no referencial do contentor do canvas (tem em conta o zoom). */
function measure(editor: Editor, c: Component, host: HTMLElement): Box | null {
  const el = c.getEl();
  const frame = editor.Canvas.getFrameEl();
  if (!el || !frame || !el.isConnected) return null;
  const zoom = editor.Canvas.getZoom() / 100;
  const r = el.getBoundingClientRect();
  const f = frame.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  return { top: f.top - h.top + r.top * zoom, left: f.left - h.left + r.left * zoom, width: r.width * zoom, height: r.height * zoom };
}

export function CanvasToolbar({
  editor,
  host,
  onReplaceImage,
  onImageInserted,
  onOpenBlocksPanel,
}: {
  editor: Editor;
  host: HTMLElement;
  onReplaceImage: (c: Component) => void;
  onImageInserted: (c: Component) => void;
  /** Abrir o painel «Adicionar» com o destino escolhido aqui (antes, dentro ou depois). */
  onOpenBlocksPanel?: (target: { anchorId: string; position: InsertPosition }) => void;
}) {
  useEditorTick(editor);
  const selected = editor.getSelected();
  const [box, setBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inserting, setInserting] = useState<{ id: string; position: InsertPosition } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [barW, setBarW] = useState(320);

  // Largura real da barra (muda com o tipo de elemento), para a manter dentro da área visível.
  useEffect(() => {
    if (!barEl) return;
    const ro = new ResizeObserver(() => setBarW(barEl.offsetWidth));
    ro.observe(barEl);
    return () => ro.disconnect();
  }, [barEl]);

  // Posição por fotograma: segue scroll do canvas, zoom, dispositivo, imagens a carregar, etc.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const c = editor.getSelected();
      const next = c ? measure(editor, c, host) : null;
      const key = next ? `${Math.round(next.top)}|${Math.round(next.left)}|${Math.round(next.width)}|${Math.round(next.height)}` : '';
      if (key !== last) {
        last = key;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, host]);

  // Arrasto pelo mecanismo do motor: esconder a barra enquanto decorre.
  useEffect(() => {
    const start = () => setDragging(true);
    const end = () => setDragging(false);
    editor.on('component:drag:start', start);
    editor.on('component:drag:end', end);
    return () => {
      editor.off('component:drag:start', start);
      editor.off('component:drag:end', end);
    };
  }, [editor]);

  // Mudou a seleção: fecha o painel de inserção.
  const selectedId = selected?.getId() ?? null;
  if (inserting && inserting.id !== selectedId) setInserting(null);

  useEffect(() => {
    if (!inserting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInserting(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inserting]);

  if (!selected || !box || dragging || editor.getEditing()) return null;

  const parent = selected.parent();
  const isRoot = !parent;
  const hostW = host.clientWidth;
  const hostH = host.clientHeight;
  // Acima do elemento, alinhada à direita; se não couber, por dentro do topo; sempre na área visível.
  const above = box.top - TOOLBAR_H - GAP;
  const top = Math.min(Math.max(above >= 0 ? above : box.top + GAP, GAP), Math.max(GAP, hostH - TOOLBAR_H - GAP));
  const left = Math.min(Math.max(box.left + box.width - barW, GAP), Math.max(GAP, hostW - barW - GAP));
  const offscreen = box.top + box.height < 0 || box.top > hostH;

  const run = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startMove = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    // Sem foco no botão: as teclas (Esc cancela) vão para o canvas, onde o motor as escuta.
    e.preventDefault();
    editor.Canvas.getWindow()?.focus();
    editor.runCommand('tlb-move', { target: selected, event: e.nativeEvent });
  };

  const editText = () => {
    const view = selected.getView();
    if (view && hasOnActive(view)) view.onActive(new MouseEvent('dblclick'));
  };

  const textEditable = isTextLike(selected) && isPlainText(selected);
  const defaultPosition = (): InsertPosition => {
    const fitsInside = BLOCKS.some((b) => canInsert(editor, b.content(), selected, 'inside'));
    return fitsInside ? 'inside' : 'after';
  };

  // O painel de inserção não tapa o elemento (nem o indicador da posição): por baixo dele, ou
  // por cima da barra, ou, sem espaço, encostado ao fundo da área visível.
  const POPOVER_H = 260;
  const popoverTop = () => {
    const below = box.top + box.height + GAP;
    if (below + POPOVER_H <= hostH) return Math.max(below, top + TOOLBAR_H + GAP);
    const aboveBar = top - POPOVER_H - GAP;
    if (aboveBar >= GAP) return aboveBar;
    return Math.max(GAP, hostH - POPOVER_H - GAP);
  };

  const position = inserting?.position;
  const indicator: Box | null = position
    ? position === 'inside'
      ? box
      : { top: position === 'before' ? box.top - 2 : box.top + box.height - 1, left: box.left, width: box.width, height: 3 }
    : null;

  return (
    <>
      {indicator && <div className={`canvas-insert-indicator ${position === 'inside' ? 'is-inside' : 'is-line'}`} style={indicator} aria-hidden="true" />}
      <div
        ref={setBarEl}
        className={`canvas-toolbar ${offscreen ? 'is-pinned' : ''}`}
        style={{ top, left }}
        role="toolbar"
        aria-label={`Ações para ${displayName(selected)}`}
        data-testid="canvas-toolbar"
      >
        <span className="canvas-toolbar-name" data-testid="canvas-toolbar-name">
          {displayName(selected)}
        </span>
        <button type="button" className="ct-btn" title="Selecionar pai" aria-label="Selecionar pai" disabled={isRoot} onClick={() => run(() => selectParent(editor))} data-testid="ct-parent">
          <ArrowUpLeft />
        </button>
        <button
          type="button"
          className="ct-btn ct-move"
          title="Arrastar para mover (Esc cancela)"
          aria-label="Mover: arraste para o novo lugar"
          disabled={isRoot || selected.get('draggable') === false}
          onMouseDown={startMove}
          data-testid="ct-move"
        >
          <Move />
        </button>
        <button
          type="button"
          className="ct-btn"
          title="Inserir componente"
          aria-label="Inserir componente"
          aria-expanded={!!inserting}
          onClick={() => setInserting(inserting ? null : { id: selected.getId(), position: defaultPosition() })}
          data-testid="ct-insert"
        >
          <Plus />
        </button>
        {textEditable && (
          <button type="button" className="ct-btn" title="Editar texto" aria-label="Editar texto" onClick={editText} data-testid="ct-edit-text">
            <PenLine />
          </button>
        )}
        {selected.is('image') && (
          <button type="button" className="ct-btn" title="Substituir imagem" aria-label="Substituir imagem" onClick={() => onReplaceImage(selected)} data-testid="ct-replace-image">
            <ImageUp />
          </button>
        )}
        <button type="button" className="ct-btn" title="Duplicar" aria-label="Duplicar" disabled={isRoot} onClick={() => run(() => duplicate(editor, selected.getId()))} data-testid="ct-duplicate">
          <Copy />
        </button>
        <button type="button" className="ct-btn ct-danger" title="Eliminar" aria-label="Eliminar" disabled={isRoot} onClick={() => run(() => remove(editor, selected.getId()))} data-testid="ct-delete">
          <Trash2 />
        </button>
      </div>

      {inserting && (
        <div className="insert-popover" style={{ top: popoverTop(), left: Math.min(left, Math.max(GAP, hostW - 300)) }} role="dialog" aria-label="Inserir componente" data-testid="insert-popover">
          <div className="insert-head">
            <strong>Inserir</strong>
            <button type="button" className="ct-btn" aria-label="Fechar" onClick={() => setInserting(null)}>
              <X />
            </button>
          </div>
          <div className="insert-positions" role="radiogroup" aria-label="Posição da inserção">
            {POSITIONS.map((p) => {
              const possible = p.value === 'inside' ? !(isTextLike(selected) || selected.is('image')) : !isRoot;
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={inserting.position === p.value}
                  disabled={!possible}
                  className="insert-position"
                  onClick={() => setInserting({ ...inserting, position: p.value })}
                  data-testid={`insert-pos-${p.value}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="insert-where" data-testid="insert-where">
            {inserting.position === 'inside' ? 'Dentro de' : inserting.position === 'before' ? 'Antes de' : 'Depois de'} «{displayName(selected)}»
          </p>
          <div className="insert-grid">
            {BLOCKS.map((b) => {
              const ok = canInsert(editor, b.content(), selected, inserting.position);
              return (
                <button
                  key={b.id}
                  type="button"
                  className="insert-tile"
                  disabled={!ok}
                  title={ok ? b.description : 'Não pode ser inserido nesta posição'}
                  onClick={() =>
                    run(() => {
                      const added = insertAt(editor, b.content(), selected, inserting.position);
                      setInserting(null);
                      if (b.id === 'image') onImageInserted(added);
                    })
                  }
                  data-testid={`insert-${b.id}`}
                >
                  {ICONS[b.id]}
                  <span>{b.label}</span>
                </button>
              );
            })}
          </div>
          {onOpenBlocksPanel && (
            <button
              type="button"
              className="insert-more"
              onClick={() => {
                onOpenBlocksPanel({ anchorId: selected.getId(), position: inserting.position });
                setInserting(null);
              }}
              data-testid="insert-open-panel"
            >
              Abrir no painel «Adicionar» com este destino
            </button>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {!inserting && error && (
        <p className="canvas-toolbar-error error-text" role="alert" style={{ top: top + TOOLBAR_H + GAP, left }}>
          {error}
        </p>
      )}
    </>
  );
}
