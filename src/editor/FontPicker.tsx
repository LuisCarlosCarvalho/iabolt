import type { Editor } from 'grapesjs';
import { useState } from 'react';
import { firstFamily, projectFontFamilies, variableOf } from '../engine/globalStyles';
import { cleanFamily, ensureGoogleFont, GOOGLE_FONTS, GOOGLE_PREFIX, googleFontStack } from '../engine/googleFonts';

/** Fontes do sistema (sem descarregar nada). */
export const FONTS: Array<[string, string]> = [
  ["'Inter', 'Segoe UI', system-ui, sans-serif", 'Sem serifa (Inter)'],
  ["Georgia, 'Times New Roman', serif", 'Com serifa (Georgia)'],
  ["'Trebuchet MS', 'Segoe UI', sans-serif", 'Humanista (Trebuchet)'],
  ["ui-monospace, 'Cascadia Code', Consolas, monospace", 'Monoespaçada'],
];

const OTHER = `${GOOGLE_PREFIX}?`;

/**
 * Seletor de fonte com a biblioteca do Google Fonts: fontes do sistema, do projeto (@font-face já
 * carregadas) e do Google (populares, ou outra pelo nome). Escolher uma do Google carrega-a no
 * projeto (`ensureGoogleFont`) e só depois grava o valor, num único passo.
 */
export function FontPicker({
  editor,
  value,
  emptyLabel,
  extra = [],
  label,
  testId,
  onChange,
}: {
  editor: Editor;
  value: string;
  /** Texto da opção vazia (sem valor próprio); sem ela, a opção vazia não aparece. */
  emptyLabel?: string;
  /** Opções antes das restantes (ex.: variáveis de fonte). */
  extra?: Array<[string, string]>;
  label: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [other, setOther] = useState<string | null>(null);
  const project = projectFontFamilies(editor);
  const inProject = new Set(project.map((f) => f.toLowerCase()));
  const projectOptions = project.map((f): [string, string] => [googleFontStack(f), `${f} (fonte do projeto)`]);
  const google = GOOGLE_FONTS.filter(([f]) => !inProject.has(f.toLowerCase()));
  const options = [...extra, ...projectOptions, ...FONTS];
  // Mesma família com outra escrita (aspas, alternativas) conta como a mesma opção.
  const match = options.find(([v]) => v === value) ?? (value && !variableOf(value) ? options.find(([v]) => !variableOf(v) && firstFamily(v) === firstFamily(value)) : undefined);
  const selected = match?.[0] ?? value;

  const load = async (family: string) => {
    setError('');
    setBusy(family);
    try {
      onChange(await ensureGoogleFont(editor, family));
      setOther(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const choose = (v: string) => {
    if (v === OTHER) {
      setError('');
      setOther('');
    } else if (v.startsWith(GOOGLE_PREFIX)) void load(v.slice(GOOGLE_PREFIX.length));
    else {
      setOther(null);
      onChange(v);
    }
  };
  const submitOther = () => {
    const family = cleanFamily(other ?? '');
    if (!family) setError('Escreva o nome da família como aparece no Google Fonts (ex.: «Quicksand»).');
    else void load(family);
  };

  return (
    <div className="font-picker">
      <select className="select" aria-label={label} data-testid={testId} value={other !== null ? OTHER : selected} disabled={!!busy} onChange={(e) => choose(e.target.value)}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {value && !match && <option value={value}>{firstFamily(value)} (atual)</option>}
        {extra.length > 0 && (
          <optgroup label="Variáveis">
            {extra.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </optgroup>
        )}
        {projectOptions.length > 0 && (
          <optgroup label="Fontes do projeto">
            {projectOptions.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Fontes do sistema">
          {FONTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </optgroup>
        <optgroup label="Google Fonts">
          {google.map(([f]) => (
            <option key={f} value={`${GOOGLE_PREFIX}${f}`}>
              {f}
            </option>
          ))}
          <option value={OTHER}>Outra do Google Fonts…</option>
        </optgroup>
      </select>
      {other !== null && (
        <form
          className="font-picker-other"
          onSubmit={(e) => {
            e.preventDefault();
            submitOther();
          }}
        >
          <input className="input" aria-label="Nome da fonte do Google Fonts" placeholder="Ex.: Quicksand" value={other} disabled={!!busy} onChange={(e) => setOther(e.target.value)} data-testid={`${testId}-other`} autoFocus />
          <button type="submit" className="btn btn-secondary" disabled={!!busy || !other.trim()} data-testid={`${testId}-other-add`}>
            Usar
          </button>
        </form>
      )}
      {busy && (
        <p className="hint" role="status" data-testid={`${testId}-status`}>
          A carregar «{busy}» do Google Fonts…
        </p>
      )}
      {error && (
        <p className="error-text" role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
