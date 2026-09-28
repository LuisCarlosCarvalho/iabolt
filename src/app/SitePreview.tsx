import { useEffect, useRef, useState } from 'react';
import type { GrapesProjectData } from '../contract/boltDocument';
import { renderProjectHtml } from '../engine/createBoltEditor';

/**
 * Pré-visualização em miniatura, gerada do JSON do projeto pelo próprio motor
 * (exportação HTML/CSS). Nada é guardado: é sempre derivada do documento atual.
 */
const cache = new Map<string, string>();

export function previewDocument(data: GrapesProjectData): string {
  const { html, css } = renderProjectHtml(data);
  return `<!doctype html><html><head><meta charset="utf-8"><style>html{overflow:hidden}${css}</style></head>${html}</html>`;
}

export interface PreviewSource {
  /** Identifica a versão (ex.: id + revisão): muda quando o conteúdo muda. */
  key: string;
  load: () => Promise<GrapesProjectData>;
}

type State = { status: 'loading' } | { status: 'ready'; doc: string } | { status: 'error' };

export function SitePreview({ source, label, viewport = 1280, interactive = false }: { source: PreviewSource; label: string; viewport?: number; interactive?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [height, setHeight] = useState(0);
  // Resultado associado à chave que o produziu: mudar de chave volta a «a carregar» sem efeitos síncronos.
  const [result, setResult] = useState<{ key: string; state: State } | null>(null);
  const cached = cache.get(source.key);
  const state: State = cached ? { status: 'ready', doc: cached } : result?.key === source.key ? result.state : { status: 'loading' };
  // A função muda a cada render do pai; a chave é que identifica o conteúdo.
  const loadRef = useRef(source.load);
  useEffect(() => {
    loadRef.current = source.load;
  });

  useEffect(() => {
    const key = source.key;
    if (cache.has(key)) return;
    let active = true;
    // Deixa o cartão aparecer primeiro; a exportação corre a seguir.
    const t = window.setTimeout(() => {
      loadRef.current()
        .then((data) => {
          const doc = previewDocument(data);
          cache.set(key, doc);
          if (active) setResult({ key, state: { status: 'ready', doc } });
        })
        .catch(() => active && setResult({ key, state: { status: 'error' } }));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [source.key]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const s = el.clientWidth / viewport;
      setScale(s);
      setHeight(el.clientHeight / s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);

  return (
    <div ref={boxRef} className={`site-preview ${interactive ? 'is-interactive' : ''}`} aria-label={label} role="img">
      {state.status === 'ready' && (
        <iframe
          title={label}
          srcDoc={state.doc}
          sandbox=""
          tabIndex={interactive ? 0 : -1}
          style={{ width: viewport, height, transform: `scale(${scale})` }}
        />
      )}
      {state.status === 'loading' && <div className="site-preview-placeholder">A preparar pré-visualização…</div>}
      {state.status === 'error' && <div className="site-preview-placeholder">Pré-visualização indisponível</div>}
    </div>
  );
}
