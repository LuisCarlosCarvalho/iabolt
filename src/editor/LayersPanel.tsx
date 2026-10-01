import type { Component, Editor } from 'grapesjs';
import { ChevronRight, Columns2, Footprints, Heading, Image as ImageIcon, LayoutPanelTop, Link2, Menu, MousePointerClick, PanelsTopLeft, RectangleHorizontal, Square, Type } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { isInternalComponent } from '../engine/boltTypes';
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

/** Formatação dentro de um texto: nunca aparece como camada. */
const INLINE = new Set(['em', 'strong', 'b', 'i', 'u', 's', 'span', 'small', 'sub', 'sup', 'br', 'code', 'mark', 'abbr', 'q', 'cite', 'font', 'time', 'wbr']);
/** Textos propriamente ditos: o conteúdo deles (formatação, ligações no meio do texto) fica escondido. */
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'a', 'button', 'label', 'blockquote', 'summary', 'figcaption', 'td', 'th', 'dt', 'dd', 'pre']);

/**
 * Filhos navegáveis: sem nós de texto, sem componentes internos e sem a formatação dos textos.
 * Um «texto» que é afinal um CONTENTOR (ex.: um `div` importado só com um título e um botão, que
 * o motor trata como texto) mostra esses elementos: são selecionáveis no canvas e têm de ter linha.
 */
export function navigableChildren(c: Component): Component[] {
  if (c.is('image')) return [];
  const kids = c.components().models.filter((child) => child.get('type') !== 'textnode' && !isInternalComponent(child));
  if (!isTextLike(c)) return kids;
  if (TEXT_TAGS.has(String(c.get('tagName') ?? '').toLowerCase())) return [];
  return kids.filter((k) => !INLINE.has(String(k.get('tagName') ?? '').toLowerCase()));
}

/**
 * Linha que representa a seleção: a do próprio componente ou, se ele não tiver linha (ex.: um
 * `<em>` dentro de um título), a do antepassado mais próximo que a tem.
 */
export function rowFor(c: Component): Component {
  const path = [...c.parents()].reverse();
  path.push(c);
  let cur = path[0] ?? c;
  for (const next of path.slice(1)) {
    if (!navigableChildren(cur).includes(next)) break;
    cur = next;
  }
  return cur;
}

/** Ícones e o SVG lá dentro: detalhe interno, fechado por omissão (abre-se na seta ou ao selecionar lá dentro). */
const CLOSED_BY_DEFAULT = new Set(['bolt-icon', 'svg']);
const closedByDefault = (c: Component) => CLOSED_BY_DEFAULT.has(c.get('type') ?? '');

/**
 * Mostra a linha na lista de camadas SEM mexer em mais nada: só o `scrollTop` da própria lista
 * (`scrollIntoView` deslocaria também o canvas e a página da aplicação). Se já estiver visível,
 * não mexe. Não muda o foco.
 */
function revealRow(list: HTMLElement, row: HTMLElement): void {
  const margin = 8;
  const l = list.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  if (r.top < l.top + margin) list.scrollTop -= l.top + margin - r.top;
  else if (r.bottom > l.bottom - margin) list.scrollTop += r.bottom - (l.bottom - margin);
}

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
  const listRef = useRef<HTMLDivElement>(null);
  /** Seleção já revelada (página + componente): só se desloca quando a seleção muda. */
  const revealed = useRef('');

  // A seleção é a do motor (fonte única). Quando muda — no canvas, pela árvore, ao selecionar o
  // pai, duplicar, desfazer/refazer ou mudar de página — ou quando este painel volta a abrir, a
  // linha é revelada (os antepassados abrem por `openPath`, abaixo). Só interface: não altera o
  // documento, não cria passos de desfazer e não grava.
  // A linha da seleção (a do próprio componente ou a do antepassado que o contém) e o caminho até
  // ela, que fica aberto. Os outros ramos ficam como o utilizador os deixou.
  const shown = selected ? rowFor(selected) : undefined;
  const exact = !!shown && shown === selected;
  const openPath = new Set(shown ? shown.parents().map((p) => p.getId()) : []);
  const pageId = editor.Pages.getSelected()?.getId() ?? '';
  const selectedId = shown?.getId() ?? '';
  useLayoutEffect(() => {
    const key = `${pageId}|${selectedId}`;
    // Sem seleção (ex.: ao mudar de página): voltar a selecionar o mesmo elemento revela-o de novo.
    if (!selectedId) {
      revealed.current = '';
      return;
    }
    if (revealed.current === key) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(selectedId)}"]`);
    if (!list || !row) return;
    revealed.current = key;
    revealRow(list, row);
  });

  if (!wrapper) return null;

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
    const isSelected = exact && shown === c;
    const containsSelection = !exact && shown === c;
    const hint = contentHint(c);
    const dropClass = drag?.over?.id === id ? `drop-${drag.over.pos}` : '';
    return (
      <li key={id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={isSelected}>
        <div
          className={`tree-row ${dropClass}${containsSelection ? ' contains-selection' : ''}`}
          style={{ paddingLeft: 4 }}
          aria-selected={isSelected}
          {...(containsSelection ? { 'aria-current': 'true' as const, title: 'Contém o elemento selecionado' } : {})}
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
    <div className="panel-scroll" ref={listRef} data-testid="layers-list">
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
