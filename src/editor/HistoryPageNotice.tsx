import type { Editor } from 'grapesjs';
import { History, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { affectedPages, historySnapshot, listPages, selectPage, type HistorySnapshot } from '../engine/pages';

/**
 * Aviso quando desfazer/refazer altera uma página diferente da que está à vista, com «Ver página».
 * Só observa os comandos de histórico do motor (botões e Ctrl+Z); ver a página não cria passos.
 */
interface Notice {
  verb: 'Desfazer' | 'Refazer';
  pageId: string | null;
  text: string;
}

export function HistoryPageNotice({ editor }: { editor: Editor }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let before: HistorySnapshot | null = null;
    const start = () => {
      before = historySnapshot(editor);
    };
    const end = (verb: Notice['verb']) => () => {
      if (!before) return;
      const effect = affectedPages(editor, before, historySnapshot(editor));
      before = null;
      const current = editor.Pages.getSelected()?.getId();
      const pages = listPages(editor);
      const other = effect.changed.find((id) => id !== current) ?? effect.added.find((id) => id !== current);
      if (other) {
        const name = pages.find((p) => p.id === other)?.name ?? '';
        const repos = effect.added.includes(other);
        setNotice({ verb, pageId: other, text: repos ? `${verb} repôs a página «${name}».` : `${verb} alterou a página «${name}», que não é a que está a ver.` });
      } else if (effect.removed[0]) {
        setNotice({ verb, pageId: null, text: `${verb} removeu a página «${effect.removed[0].name}».` });
      } else {
        setNotice(null);
      }
    };
    const undoEnd = end('Desfazer');
    const redoEnd = end('Refazer');
    const onPage = () => setNotice(null);
    editor.on('command:run:before:core:undo', start);
    editor.on('command:run:before:core:redo', start);
    editor.on('command:run:core:undo', undoEnd);
    editor.on('command:run:core:redo', redoEnd);
    editor.on('page:select', onPage);
    return () => {
      editor.off('command:run:before:core:undo', start);
      editor.off('command:run:before:core:redo', start);
      editor.off('command:run:core:undo', undoEnd);
      editor.off('command:run:core:redo', redoEnd);
      editor.off('page:select', onPage);
    };
  }, [editor]);

  if (!notice) return null;
  return (
    <div className="editor-notice history-notice" role="status" data-testid="history-notice">
      <History aria-hidden="true" />
      <span>{notice.text}</span>
      {notice.pageId && (
        <button type="button" className="notice-action" onClick={() => notice.pageId && selectPage(editor, notice.pageId)} data-testid="history-notice-view">
          Ver página
        </button>
      )}
      <button type="button" className="notice-close" aria-label="Fechar aviso" onClick={() => setNotice(null)}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
