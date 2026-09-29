import type { Editor } from 'grapesjs';
import { AlertTriangle, ArrowLeft, Monitor, Smartphone, Tablet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, Modal } from '../app/ui';
import { getProjectData } from '../engine/createBoltEditor';
import { listPages, type PageInfo } from '../engine/pages';
import { previewDocument } from '../engine/runtime';

/**
 * Pré-visualização do projeto (todas as páginas), isolada num iframe com sandbox. As ligações
 * «/slug» para páginas do projeto são tratadas aqui: mostram essa página, com «Voltar». Um
 * destino inexistente é indicado, sem navegar. Âncoras e endereços externos não mudam.
 * O documento mostrado é o estado atual do editor no momento em que se abre (só leitura).
 */
const WIDTHS = { desktop: 1280, tablet: 820, mobile: 390 } as const;
type Device = keyof typeof WIDTHS;

/** Página correspondente a um href «/slug» («/» é a inicial). */
export function pageForHref(pages: readonly PageInfo[], href: string): PageInfo | null {
  const path = href.split(/[?#]/)[0] ?? '';
  const slug = decodeURIComponent(path.replace(/^\/+|\/+$/g, ''));
  if (!slug) return pages.find((p) => p.isHome) ?? null;
  return pages.find((p) => p.slug === slug) ?? null;
}

export function ProjectPreview({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  // Ao fechar (botão, Escape fora ou dentro do iframe), o foco volta a quem abriu a pré-visualização.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, [open]);
  return (
    <Modal wide open={open} title="Pré-visualização" onClose={onClose}>
      {open && <PreviewBody editor={editor} onClose={onClose} />}
    </Modal>
  );
}

function PreviewBody({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  // Instantâneo ao abrir: a pré-visualização não altera nem acompanha o documento.
  const [snapshot] = useState(() => ({ data: getProjectData(editor), pages: listPages(editor) }));
  const start = snapshot.pages.find((p) => p.selected) ?? snapshot.pages[0];
  const [current, setCurrent] = useState<string>(start?.id ?? '');
  const [history, setHistory] = useState<string[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => previewDocument(snapshot.data, { interactive: true, scroll: true, pageId: current }), [snapshot, current]);
  const page = snapshot.pages.find((p) => p.id === current);

  const go = (id: string) => {
    if (id === current) return;
    setHistory((h) => [...h, current]);
    setCurrent(id);
    setMissing(null);
  };
  const goRef = useRef(go);
  const closeRef = useRef(onClose);
  useEffect(() => {
    goRef.current = go;
    closeRef.current = onClose;
  });

  // Mensagens só do iframe desta pré-visualização (origem opaca: valida-se a janela de origem).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const data: unknown = e.data;
      if (typeof data !== 'object' || data === null) return;
      // Escape vindo do iframe: só fecha se o foco ainda estiver na pré-visualização (um diálogo
      // aberto por cima tem o foco e trata o seu próprio Escape).
      if (Reflect.get(data, 'bolt') === 'escape') {
        if (document.activeElement === frameRef.current) closeRef.current();
        return;
      }
      if (Reflect.get(data, 'bolt') !== 'navigate') return;
      const href = Reflect.get(data, 'href');
      if (typeof href !== 'string') return;
      const target = pageForHref(snapshot.pages, href);
      if (target) goRef.current(target.id);
      else setMissing(href);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [snapshot]);

  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
    setMissing(null);
  };

  return (
    <div className="project-preview" data-testid="project-preview">
      <div className="preview-bar">
        <Button onClick={back} disabled={history.length === 0} data-testid="preview-back">
          <ArrowLeft aria-hidden="true" /> Voltar
        </Button>
        <label className="preview-page">
          <span className="sr-only">Página</span>
          <select className="select" aria-label="Página a pré-visualizar" value={current} onChange={(e) => go(e.target.value)} data-testid="preview-page">
            {snapshot.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (/{p.slug}){p.isHome ? ' · inicial' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="device-tabs" role="group" aria-label="Largura da pré-visualização">
          <IconButton label="Computador" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
            <Monitor />
          </IconButton>
          <IconButton label="Tablet" aria-pressed={device === 'tablet'} onClick={() => setDevice('tablet')}>
            <Tablet />
          </IconButton>
          <IconButton label="Telemóvel" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
            <Smartphone />
          </IconButton>
        </div>
      </div>
      {missing && (
        <div className="notice notice-error" role="alert" data-testid="preview-missing">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Destino inexistente.</strong> A ligação aponta para «{missing}», que não é nenhuma página deste projeto. Continua em «{page?.name}».
          </div>
          <button type="button" className="notice-close" aria-label="Fechar aviso" onClick={() => setMissing(null)} data-testid="preview-missing-close">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="preview-frame" style={{ maxWidth: WIDTHS[device] }}>
        <iframe ref={frameRef} key={current} title={`Pré-visualização de ${page?.name ?? ''}`} sandbox="allow-scripts" srcDoc={doc} data-testid="preview-frame" data-page={page?.slug} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Ligações entre páginas do projeto («/…») mostram essa página aqui, e «Voltar» regressa. Âncoras (#) deslocam dentro da página. Endereços externos mantêm o comportamento habitual.
      </p>
    </div>
  );
}
