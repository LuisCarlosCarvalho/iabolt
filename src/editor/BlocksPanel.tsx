import type { Component, Editor } from 'grapesjs';
import { Columns2, Heading, Image as ImageIcon, LayoutPanelTop, MousePointerClick, Type } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BLOCKS, type BlockId } from '../engine/blocks';
import { insertBlock } from '../engine/operations';

const ICONS: Record<BlockId, ReactNode> = {
  section: <LayoutPanelTop />,
  columns: <Columns2 />,
  heading: <Heading />,
  text: <Type />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
};

/**
 * Biblioteca de componentes básicos. Clicar insere na primeira posição válida junto
 * à seleção; arrastar usa o arrasto nativo do motor para largar no canvas.
 */
export function BlocksPanel({ editor, onImageInserted }: { editor: Editor; onImageInserted: (c: Component) => void }) {
  const [error, setError] = useState<string | null>(null);

  const add = (id: BlockId) => {
    const block = BLOCKS.find((b) => b.id === id);
    if (!block) return;
    try {
      const added = insertBlock(editor, block.content(), editor.getSelected());
      setError(null);
      added.getEl()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (id === 'image') onImageInserted(added);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel-scroll">
      <div className="panel-title">Componentes básicos</div>
      <p className="block-help">Clique para inserir junto ao elemento selecionado, ou arraste para o sítio exato no canvas.</p>
      {error && (
        <p className="error-text" role="alert" style={{ padding: '0 8px' }}>
          {error}
        </p>
      )}
      <div className="block-grid">
        {BLOCKS.map((b) => (
          <button
            key={b.id}
            type="button"
            className="block-tile"
            data-testid={`block-${b.id}`}
            draggable
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
        ))}
      </div>
    </div>
  );
}
