import type { Component, Editor } from 'grapesjs';
import { ChevronRight, Columns2, Footprints, Heading, Image as ImageIcon, LayoutPanelTop, Link2, Menu, MousePointerClick, PanelsTopLeft, RectangleHorizontal, Square, Type } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';
import { contentHint, displayName } from '../engine/labels';
import { canPlace, findById, isTextLike, move } from '../engine/operations';

type DropPos = 'before' | 'after' | 'inside';

const ICONS: Record<string, ReactNode> = {
  wrapper: <PanelsTopLeft className="tree-icon" />,
  'bolt-navbar': <Menu className="tree-icon" />,
  'bolt-section': <LayoutPanelTop className="tree-icon" />,
  'bolt-footer': <Footprints className="tree-icon" />,
  'bolt-columns': <Columns2 className="tree-icon" />,
  'bolt-column': <RectangleHorizontal className="tree-icon" />,
  'bolt-button': <MousePointerClick className="tree-icon" />,
  link: <Link2 className="tree-icon" />,
  image: <ImageIcon className="tree-icon" />,
};

function iconFor(c: Component): ReactNode {
  const type = c.get('type') ?? '';
  const icon = ICONS[type];
  if (icon) return icon;
  if (type === 'text') return /^h[1-6]$/.test(String(c.get('tagName'))) ? <Heading className="tree-icon" /> : <Type className="tree-icon" />;
  return <Square className="tree-icon" />;
}

/** Filhos navegáveis: sem nós de texto e sem a formatação interna dos textos. */
export function navigableChildren(c: Component): Component[] {
  if (isTextLike(c) || c.is('image')) return [];
  return c.components().models.filter((child) => child.get('type') !== 'textnode');
}

/** Ícones e o SVG lá dentro: detalhe interno, fechado por omissão (abre-se na seta ou ao selecionar lá dentro). */
const CLOSED_BY_DEFAULT = new Set(['bolt-icon', 'svg']);
const closedByDefault = (c: Component) => CLOSED_BY_DEFAULT.has(c.get('type') ?? '');

interface DragState {
  sourceId: string;
  over: { id: string; pos: DropPos } | null;
}

export function LayersPanel({ editor }: { editor: Editor }) {
  const wrapper = editor.getWrapper();
  const selected = editor.getSelected();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Nós fechados por omissão (detalhe interno de ícones SVG) que o utilizador abriu.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!wrapper) return null;
  // Os antepassados da seleção ficam sempre abertos, para a seleção ser visível.
  const openPath = new Set(selected ? selected.parents().map((p) => p.getId()) : []);

  const toggle = (c: Component) => {
    const id = c.getId();
    const [set, save] = closedByDefault(c) ? [expanded, setExpanded] : [collapsed, setCollapsed];
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };

  const resolveDrop = (target: Component, pos: DropPos): { parent: Component; at: number } | null => {
    if (pos === 'inside') return { parent: target, at: target.components().length };
    const parent = target.parent();
    if (!parent) return null;
    return { parent, at: target.index() + (pos === 'after' ? 1 : 0) };
  };

  const onDragOver = (e: DragEvent, target: Component) => {
    if (!drag) return;
    const source = findById(editor, drag.sourceId);
    if (!source) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const order: DropPos[] = y < 0.3 ? ['before', 'inside'] : y > 0.7 ? ['after', 'inside'] : ['inside', 'after'];
    for (const pos of order) {
      const place = resolveDrop(target, pos);
      if (place && canPlace(editor, place.parent, source, place.at)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (drag.over?.id !== target.getId() || drag.over.pos !== pos) setDrag({ ...drag, over: { id: target.getId(), pos } });
        return;
      }
    }
    if (drag.over) setDrag({ ...drag, over: null });
  };

  const onDrop = (e: DragEvent, target: Component) => {
    e.preventDefault();
    const state = drag;
    setDrag(null);
    if (!state?.over) return;
    const place = resolveDrop(target, state.over.pos);
    if (!place) return;
    try {
      move(editor, state.sourceId, place.parent.getId(), place.at);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderNode = (c: Component, depth: number): ReactNode => {
    const id = c.getId();
    const kids = navigableChildren(c);
    const isRoot = depth === 0;
    const open = isRoot || openPath.has(id) || (closedByDefault(c) ? expanded.has(id) : !collapsed.has(id));
    const isSelected = selected === c;
    const hint = contentHint(c);
    const dropClass = drag?.over?.id === id ? `drop-${drag.over.pos}` : '';
    return (
      <li key={id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={isSelected}>
        <div
          className={`tree-row ${dropClass}`}
          style={{ paddingLeft: 4 }}
          aria-selected={isSelected}
          data-testid="layer-row"
          data-layer-id={id}
          draggable={!isRoot}
          onClick={() => editor.select(c)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', displayName(c));
            setDrag({ sourceId: id, over: null });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => onDragOver(e, c)}
          onDragLeave={() => drag?.over?.id === id && setDrag({ ...drag, over: null })}
          onDrop={(e) => onDrop(e, c)}
        >
          {kids.length > 0 && !isRoot ? (
            <button
              type="button"
              className="tree-toggle"
              aria-label={open ? 'Fechar' : 'Abrir'}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                toggle(c);
              }}
            >
              <ChevronRight />
            </button>
          ) : (
            <span className="tree-toggle" aria-hidden="true" />
          )}
          {iconFor(c)}
          <span className="tree-label">{displayName(c)}</span>
          {hint && <span className="tree-hint">· {hint}</span>}
        </div>
        {kids.length > 0 && open && (
          <ul className="tree" role="group">
            {kids.map((k) => renderNode(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="panel-scroll">
      <div className="panel-title">Camadas</div>
      {error && (
        <p className="error-text" role="alert" style={{ padding: '0 8px' }}>
          {error}
        </p>
      )}
      <ul className="tree" role="tree" aria-label="Árvore de componentes">
        {renderNode(wrapper, 0)}
      </ul>
      <p className="hint" style={{ padding: '10px 8px' }}>
        Arraste um elemento para o reordenar. Só são aceites posições válidas (por exemplo, secções apenas no nível da página).
      </p>
    </div>
  );
}
