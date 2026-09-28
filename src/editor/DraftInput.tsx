import { useState, type KeyboardEvent } from 'react';

/** Campo de texto com rascunho local; grava ao sair do campo ou com Enter (um passo de desfazer). */
export function DraftInput({
  value,
  placeholder,
  onCommit,
  label,
  testId,
  multiline = false,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  label: string;
  testId?: string;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  // Valor externo mudou (desfazer, outro dispositivo): o rascunho acompanha.
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') setDraft(value);
  };
  return multiline ? (
    <textarea className="textarea" aria-label={label} data-testid={testId} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
  ) : (
    <input className="input" aria-label={label} data-testid={testId} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
  );
}
