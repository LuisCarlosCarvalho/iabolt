import type { Component, Editor } from 'grapesjs';
import { AlertTriangle, Columns2, Heading, Image as ImageIcon, LayoutPanelTop, MousePointerClick, Search, Type, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BLOCKS, type BlockId } from '../engine/blocks';
import { displayName } from '../engine/labels';
import { canInsert, findById, insertAt, insertBlock, type InsertPosition } from '../engine/operations';

const ICONS: Record<BlockId, ReactNode> = {
  section: <LayoutPanelTop />,
  columns: <Columns2 />,
  heading: <Heading />,
  text: <Type />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
};

/** Categorias simples sobre os componentes existentes (organização da interface, não do documento). */
type Category = 'all' | 'layout' | 'text' | 'media' | 'actions';
const CATEGORIES: ReadonlyArray<[Category, string]> = [
  ['all', 'Todos'],
  ['layout', 'Estrutura'],
  ['text', 'Texto'],
  ['media', 'Média'],
  ['actions', 'Ações'],
];
const CATEGORY_OF: Record<BlockId, Exclude<Category, 'all'>> = {
  section: 'layout',
  columns: 'layout',
  heading: 'text',
  text: 'text',
  image: 'media',
  button: 'actions',
};

/** Destino escolhido no «+» da barra contextual, levado para este painel. */
export interface InsertTarget {
  anchorId: string;
  position: InsertPosition;
}

const WHERE: Record<InsertPosition, string> = { before: 'Antes de', inside: 'Dentro de', after: 'Depois de' };

/** Pesquisa sem acentos nem maiúsculas. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Biblioteca de componentes básicos. Sem destino: clicar insere na primeira posição válida
 * junto à seleção; arrastar usa o arrasto nativo do motor. Com destino (vindo do «+»): insere
 * exatamente antes, dentro ou depois do elemento escolhido. Se o destino deixar de existir ou
 * de aceitar componentes, o painel avisa e NÃO insere noutro sítio até o destino ser cancelado.
 */
export function BlocksPanel({
  editor,
  onImageInserted,
  target,
  onClearTarget,
}: {
  editor: Editor;
  onImageInserted: (c: Component) => void;
  target?: InsertTarget | null;
  onClearTarget?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const anchor = target ? findById(editor, target.anchorId) : undefined;
  const targetLost = !!target && !anchor;
  const fits = (id: BlockId) => {
    if (!target) return true;
    const block = BLOCKS.find((b) => b.id === id);
    return !!anchor && !!block && canInsert(editor, block.content(), anchor, target.position);
  };
  const targetBlocked = !!target && !!anchor && !BLOCKS.some((b) => fits(b.id));

  const add = (id: BlockId) => {
    const block = BLOCKS.find((b) => b.id === id);
    if (!block) return;
    try {
      let added: Component;
      if (target) {
        // Com destino: só nesse destino. Nunca cai para outra posição.
        const a = findById(editor, target.anchorId);
        if (!a) throw new Error('O elemento de destino já não existe. Cancele o destino para inserir junto à seleção.');
        added = insertAt(editor, block.content(), a, target.position);
        onClearTarget?.();
      } else {
        added = insertBlock(editor, block.content(), editor.getSelected());
      }
      setError(null);
      added.getEl()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (id === 'image') onImageInserted(added);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const q = fold(query.trim());
  const visible = BLOCKS.filter((b) => (category === 'all' || CATEGORY_OF[b.id] === category) && (!q || fold(b.label).includes(q)));

  return (
    <div className="panel-scroll blocks-panel">
      <div className="panel-title">Componentes básicos</div>

      {target && (
        <div className={`insert-target ${targetLost || targetBlocked ? 'is-problem' : ''}`} role="status" data-testid="blocks-target">
          {targetLost ? (
            <span>
              <AlertTriangle aria-hidden="true" /> O elemento de destino foi eliminado. Nada será inserido até cancelar o destino.
            </span>
          ) : targetBlocked ? (
            <span>
              <AlertTriangle aria-hidden="true" /> «{anchor ? displayName(anchor) : ''}» já não aceita componentes {WHERE[target.position].toLowerCase()} si. Cancele o destino ou escolha outro no «+».
            </span>
          ) : (
            <span>
              Destino: <strong>{anchor ? `${WHERE[target.position]} «${displayName(anchor)}»` : ''}</strong>
            </span>
          )}
          <button type="button" className="target-cancel" onClick={() => onClearTarget?.()} data-testid="blocks-target-cancel">
            <X aria-hidden="true" /> Cancelar destino
          </button>
        </div>
      )}
      {!target && <p className="block-help">Clique para inserir junto ao elemento selecionado, ou arraste para o sítio exato no canvas.</p>}

      <div className="blocks-filter">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input className="input" type="search" placeholder="Pesquisar componentes" aria-label="Pesquisar componentes" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="blocks-search" />
        </label>
        <div className="chip-row" role="radiogroup" aria-label="Categoria">
          {CATEGORIES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={category === id} className="chip" onClick={() => setCategory(id)} data-testid={`blocks-cat-${id}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="error-text" role="alert" style={{ padding: '0 8px' }}>
          {error}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="hint" style={{ padding: '8px' }} data-testid="blocks-empty">
          Nenhum componente corresponde à pesquisa.
        </p>
      ) : (
        <div className="block-grid">
          {visible.map((b) => {
            const ok = fits(b.id);
            return (
              <button
                key={b.id}
                type="button"
                className="block-tile"
                data-testid={`block-${b.id}`}
                draggable={!target}
                disabled={!ok}
                title={ok ? b.description : targetLost ? 'O destino já não existe' : 'Não pode ser inserido nesse destino'}
                onClick={() => add(b.id)}
                onDragStart={(e) => {
                  const block = editor.Blocks.get(b.id);
                  if (block) editor.Blocks.startDrag(block, e.nativeEvent);
                }}
                onDragEnd={() => editor.Blocks.endDrag()}
              >
                {ICONS[b.id]}
                <strong>{b.label}</strong>
                <small>{b.description}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
