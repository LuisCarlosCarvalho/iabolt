import { AlertTriangle, CheckCircle2, FileUp, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, navigate, projectPath } from '../app/router';
import { persistenceLabel, useServices } from '../app/services';
import { Button, errorMessage, IconButton, Spinner } from '../app/ui';
import { previewDocument } from '../engine/runtime';
import type { GrapesProjectData } from '../contract/boltDocument';
import { analyzeImport, browserDependencies, completeImport, FORMATS, previewProjectData, reanalyzeSite, unresolvedAssets, type ImportAnalysis } from './pipeline';
import type { AssetStatus, ImportReport, ItemStatus } from './types';

/**
 * Importar ficheiro → analisar compatibilidade → (relatório + prévia) → confirmar → projeto.
 * O ficheiro original fica registado (servidor: tabela import_records; local: IndexedDB).
 */
type Step =
  | { name: 'choose'; error?: string }
  | { name: 'analyzing'; fileName: string }
  | { name: 'review'; analysis: ImportAnalysis }
  | { name: 'importing'; analysis: ImportAnalysis; progress: string };

export const ITEM_LABELS: Record<ItemStatus, string> = {
  preservado: 'Preservado',
  convertido: 'Convertido',
  parcial: 'Parcial',
  'nao-suportado': 'Não suportado',
};

const ITEM_ORDER: readonly ItemStatus[] = ['preservado', 'convertido', 'parcial', 'nao-suportado'];

const ASSET_LABELS: Record<AssetStatus, string> = {
  pendente: 'Por verificar',
  disponivel: 'Pode ser copiada',
  copiada: 'Copiada',
  externa: 'Fica no endereço original',
  'em-falta': 'Em falta',
  rejeitada: 'Recusada',
};

const PREVIEW_WIDTHS = { desktop: 1280, tablet: 820, mobile: 390 } as const;
type Device = keyof typeof PREVIEW_WIDTHS;

/**
 * Ficheiro principal de uma escolha com vários: o ZIP, senão a primeira página HTML. Os outros
 * são os recursos associados (CSS, imagens, fontes) de um HTML avulso.
 */
function mainFile(files: File[]): { main: File; extra: File[] } | null {
  const main = files.find((f) => /\.zip$/i.test(f.name) || f.type.includes('zip')) ?? files.find((f) => /\.html?$/i.test(f.name)) ?? files[0];
  return main ? { main, extra: files.filter((f) => f !== main) } : null;
}

export function ImportPage() {
  const { mode } = useServices();
  const [step, setStep] = useState<Step>({ name: 'choose' });

  // URLs temporários da pré-visualização: libertados ao cancelar, ao trocar de análise e ao sair.
  const current = step.name === 'review' || step.name === 'importing' ? step.analysis : null;
  useEffect(() => () => current?.release(), [current]);

  const analyze = async (files: File[]) => {
    const pick = mainFile(files);
    if (!pick) return;
    setStep({ name: 'analyzing', fileName: pick.main.name });
    try {
      const analysis = await analyzeImport(pick.main, browserDependencies(), { extraFiles: pick.extra });
      setStep({ name: 'review', analysis });
    } catch (e) {
      setStep({ name: 'choose', error: errorMessage(e) });
    }
  };

  const reanalyze = async (previous: ImportAnalysis, opts: Parameters<typeof reanalyzeSite>[2]) => {
    setStep({ name: 'analyzing', fileName: previous.report.fileName });
    try {
      setStep({ name: 'review', analysis: await reanalyzeSite(previous, browserDependencies(), opts) });
    } catch (e) {
      setStep({ name: 'choose', error: errorMessage(e) });
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Importar ficheiro</h1>
          <p>
            O formato é identificado pelo conteúdo. Antes de criar o projeto vê o relatório de compatibilidade e a pré-visualização. O projeto fica guardado{' '}
            {persistenceLabel(mode)}.
          </p>
        </div>
      </div>
      {step.name === 'choose' && <ChooseFile error={step.error} onFiles={(f) => void analyze(f)} />}
      {step.name === 'analyzing' && (
        <div className="state-panel">
          <Spinner label={`A analisar ${step.fileName}… (imagens e fontes incluídas)`} />
        </div>
      )}
      {(step.name === 'review' || step.name === 'importing') && (
        <Review
          analysis={step.analysis}
          busy={step.name === 'importing' ? step.progress : null}
          onCancel={() => setStep({ name: 'choose' })}
          onReanalyze={(opts) => void reanalyze(step.analysis, opts)}
          onProgress={(progress) => setStep({ name: 'importing', analysis: step.analysis, progress })}
          onError={(error) => setStep({ name: 'choose', error })}
        />
      )}
    </main>
  );
}

function ChooseFile({ error, onFiles }: { error: string | undefined; onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };
  return (
    <>
      <div
        className={`dropzone ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        data-testid="import-dropzone"
      >
        <FileUp aria-hidden="true" />
        <p>
          <strong>Arraste o ficheiro para aqui</strong> (ou a página HTML com o CSS e as imagens) ou
        </p>
        <Button variant="primary" onClick={() => input.current?.click()}>
          Escolher ficheiro
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="import-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
      </div>
      {error && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 16 }}>
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Não foi possível importar.</strong> {error}
          </div>
        </div>
      )}
      <h2 className="section-title">Formatos</h2>
      <ul className="format-list">
        {FORMATS.map((f) => (
          <li key={f.id}>
            {f.available ? <CheckCircle2 aria-hidden="true" className="ok" /> : <span className="soon">em breve</span>} {f.label}
            {f.available ? <span className="hint"> · {f.note}</span> : null}
          </li>
        ))}
      </ul>
      <p className="hint">
        Scripts e manipuladores de eventos do ficheiro nunca são executados: são removidos na importação e indicados no relatório. Nos sites estáticos, os
        comportamentos reconhecidos (menu que abre e fecha, botão «voltar ao topo», colapsos do Bootstrap) passam para o runtime do Bolt IA.
      </p>
    </>
  );
}

function Review({
  analysis,
  busy,
  onCancel,
  onReanalyze,
  onProgress,
  onError,
}: {
  analysis: ImportAnalysis;
  busy: string | null;
  onCancel: () => void;
  onReanalyze: (opts: Parameters<typeof reanalyzeSite>[2]) => void;
  onProgress: (text: string) => void;
  onError: (error: string) => void;
}) {
  const { catalog, assets, imports, mode } = useServices();
  const { report } = analysis;
  const [name, setName] = useState(analysis.suggestedName);
  const [device, setDevice] = useState<Device>('desktop');
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [rights, setRights] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  // Sites estáticos: a pré-visualização recebe as imagens locais embutidas (ver previewProjectData).
  const [shown, setShown] = useState<GrapesProjectData | null>(analysis.site ? null : analysis.projectData);
  useEffect(() => {
    if (!analysis.site) return;
    let alive = true;
    void previewProjectData(analysis).then((data) => {
      if (alive) setShown(data);
    });
    return () => {
      alive = false;
    };
  }, [analysis]);
  const doc = useMemo(() => (shown ? previewDocument(shown, { interactive: true, scroll: true }) : ''), [shown]);
  const unresolved = unresolvedAssets(report);
  // Só as imagens remotas pedem autorização: as locais vêm no próprio ficheiro do utilizador.
  const copiable = report.assets.filter((a) => a.status === 'disponivel' && !a.local);
  const local = report.assets.filter((a) => a.status === 'disponivel' && a.local);
  const missingFiles = report.missingFiles ?? [];
  // O que torna a importação parcial, pelo nome (não só a contagem).
  const limited = report.items.filter((i) => i.status === 'parcial' || i.status === 'nao-suportado').map((i) => `${i.source}${i.count > 1 ? ` (${i.count})` : ''}`);
  const partial = unresolved.length > 0 || missingFiles.length > 0 || report.totals.parcial > 0 || report.totals['nao-suportado'] > 0;

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const toCopy = local.length + (rights ? copiable.length : 0);
      onProgress(toCopy ? `A copiar imagens (0/${toCopy})…` : 'A criar o projeto…');
      const done = await completeImport(analysis, assets, {
        copyImages: rights,
        onProgress: (n, total) => onProgress(`A copiar imagens (${n}/${total})…`),
      });
      onProgress('A criar o projeto…');
      const created = await catalog.create(idempotencyKey, done.projectData, { name, templateId: `import:${report.format}` });
      onProgress('A guardar o ficheiro original…');
      await imports.record({
        projectId: created.projectId,
        format: report.format,
        fileName: analysis.original.name,
        fileSize: report.fileSize,
        originalText: analysis.original.text,
        report: done.report,
      });
      navigate(projectPath(created.projectId));
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  return (
    <form className="import-review" onSubmit={(e) => void confirm(e)} data-testid="import-review">
      <section className="import-report" aria-label="Relatório de compatibilidade">
        <h2 className="section-title">
          {report.fileName} · {report.formatLabel}
        </h2>
        <ul className="totals" data-testid="import-totals">
          {ITEM_ORDER.map((s) => (
            <li key={s} className={`total total-${s}`}>
              <strong>{report.totals[s]}</strong> {ITEM_LABELS[s]}
            </li>
          ))}
        </ul>
        {analysis.site && <SitePages analysis={analysis} disabled={busy !== null} onApply={(site) => onReanalyze({ site })} />}
        {missingFiles.length > 0 && <MissingFiles report={report} disabled={busy !== null} onAdd={(extraFiles) => onReanalyze({ extraFiles })} />}
        <ReportDetails report={report} />
      </section>

      <section className="import-preview" aria-label="Pré-visualização">
        <div className="device-tabs" role="group" aria-label="Largura da pré-visualização">
          <IconButton label="Computador" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor /></IconButton>
          <IconButton label="Tablet" aria-pressed={device === 'tablet'} onClick={() => setDevice('tablet')}><Tablet /></IconButton>
          <IconButton label="Telemóvel" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone /></IconButton>
        </div>
        {doc ? <ScaledFrame width={PREVIEW_WIDTHS[device]} doc={doc} /> : <Spinner label="A preparar a pré-visualização…" />}
        <p className="hint">
          Pré-visualização isolada: só corre o runtime do Bolt IA (menus, carrossel, «voltar ao topo»). Imagens em falta aparecem assinaladas a vermelho.
          {local.length > 0 && ` As ${local.length} imagem(ns) do arquivo são guardadas ${mode === 'server' ? 'no armazenamento do workspace' : 'no projeto'} ao importar.`}
        </p>

        <label className="field">
          <span>Nome do projeto</span>
          <input className="input" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} data-testid="import-name" />
        </label>

        {copiable.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} data-testid="import-rights" />
            <span>
              Tenho autorização para usar as {copiable.length} imagem(ns) copiável(eis) e quero guardá-las {mode === 'server' ? 'no armazenamento do workspace' : 'no projeto'}.
              Sem isto, ficam com o endereço original.
            </span>
          </label>
        )}
        {partial && (
          <label className="check">
            <input type="checkbox" checked={acceptPartial} onChange={(e) => setAcceptPartial(e.target.checked)} data-testid="import-accept-partial" />
            <span>
              Compreendo que a importação é parcial
              {unresolved.length > 0 ? ` (${unresolved.length} imagem(ns) em falta ou fora do armazenamento)` : ''}
              {missingFiles.length > 0 ? ` (${missingFiles.length} ficheiro(s) referido(s) em falta)` : ''}
              {limited.length > 0 ? ` e que há elementos não suportados ou parciais: ${limited.join('; ')}` : ''}. O ficheiro original fica
              guardado para recuperação.
            </span>
          </label>
        )}
        <div className="import-actions">
          <Button onClick={onCancel} disabled={busy !== null}>
            Escolher outro ficheiro
          </Button>
          <Button type="submit" variant="primary" disabled={busy !== null || (partial && !acceptPartial)} data-testid="import-confirm">
            {busy ?? 'Importar e abrir o editor'}
          </Button>
        </div>
        <p className="hint">
          <Link to="/">Cancelar</Link>
        </p>
      </section>
    </form>
  );
}

/** Páginas do site: quais importar e qual é a inicial (nova análise ao aplicar). */
function SitePages({ analysis, disabled, onApply }: { analysis: ImportAnalysis; disabled: boolean; onApply: (site: { pages: string[]; home: string }) => void }) {
  const site = analysis.site;
  const [pages, setPages] = useState<string[]>(site?.pages ?? []);
  const [home, setHome] = useState(site?.home ?? '');
  if (!site) return null;
  const changed = home !== site.home || pages.length !== site.pages.length || pages.some((p) => !site.pages.includes(p));
  const toggle = (path: string, on: boolean) => {
    const next = on ? [...pages, path] : pages.filter((p) => p !== path);
    setPages(next);
    if (!next.includes(home)) setHome(next[0] ?? '');
  };
  return (
    <details className="site-pages" open data-testid="import-pages">
      <summary>
        Páginas ({site.pages.length} de {site.candidates.length} ficheiros HTML)
      </summary>
      <table className="report-table">
        <thead>
          <tr>
            <th>Importar</th>
            <th>Inicial</th>
            <th>Ficheiro</th>
          </tr>
        </thead>
        <tbody>
          {site.candidates.map((c) => (
            <tr key={c.path}>
              <td>
                <input type="checkbox" aria-label={`Importar ${c.path}`} checked={pages.includes(c.path)} disabled={disabled} onChange={(e) => toggle(c.path, e.target.checked)} />
              </td>
              <td>
                <input type="radio" name="home" aria-label={`${c.path} como página inicial`} checked={home === c.path} disabled={disabled || !pages.includes(c.path)} onChange={() => setHome(c.path)} />
              </td>
              <td>
                <code>{c.path}</code> · {c.title}
                {c.auxiliary && <div className="hint">Não é página por omissão: {c.auxiliary}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {changed && (
        <Button disabled={disabled || pages.length === 0} onClick={() => onApply({ pages, home })} data-testid="import-pages-apply">
          Aplicar escolha e analisar de novo
        </Button>
      )}
    </details>
  );
}

/** Ficheiros referidos que não estão no arquivo: lista exata e opção de os acrescentar. */
function MissingFiles({ report, disabled, onAdd }: { report: ImportReport; disabled: boolean; onAdd: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const missing = report.missingFiles ?? [];
  return (
    <div className="notice import-missing" data-testid="import-missing">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>{missing.length} ficheiro(s) referido(s) em falta.</strong> Nada é inventado nem substituído: acrescente-os ou importe sem eles.
        <ul className="asset-list">
          {missing.map((m) => (
            <li key={m.path}>
              <code>{m.path}</code> ({m.kind}) · referido em {m.from.join(', ')}
              {m.reason && <div className="hint">{m.reason}</div>}
            </li>
          ))}
        </ul>
        <Button disabled={disabled} onClick={() => input.current?.click()}>
          Acrescentar ficheiros…
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="import-missing-files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) onAdd(files);
          }}
        />
      </div>
    </div>
  );
}

export function ReportDetails({ report }: { report: ImportReport }) {
  const byStatus = (s: AssetStatus) => report.assets.filter((a) => a.status === s);
  return (
    <div className="report-details">
      <details open>
        <summary>Elementos ({report.items.length} tipos)</summary>
        <table className="report-table" data-testid="import-items">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Origem</th>
              <th>No Bolt IA</th>
              <th>N.º</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((i) => (
              <tr key={`${i.status}|${i.source}|${i.target}|${i.detail}`} title={i.detail}>
                <td>
                  <span className={`status status-${i.status}`}>{ITEM_LABELS[i.status]}</span>
                </td>
                <td>{i.source}</td>
                <td>
                  {i.target}
                  {i.detail && <div className="hint">{i.detail}</div>}
                </td>
                <td>{i.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details open={report.assets.some((a) => a.status !== 'disponivel')}>
        <summary>
          Imagens ({report.assets.length}
          {(['em-falta', 'rejeitada', 'externa'] as const).map((s) => (byStatus(s).length ? ` · ${byStatus(s).length} ${ASSET_LABELS[s].toLowerCase()}` : ''))})
        </summary>
        <ul className="asset-list" data-testid="import-assets">
          {report.assets.map((a) => (
            <li key={a.url}>
              <span className={`status status-asset-${a.status}`}>{a.local && a.status === 'disponivel' ? 'Guardada ao importar' : ASSET_LABELS[a.status]}</span>{' '}
              <code title={a.local ?? a.url}>{a.local ?? shortUrl(a.url)}</code>
              {a.reason && <div className="hint">{a.reason}</div>}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Fontes ({report.fonts.length})</summary>
        <ul className="asset-list">
          {report.fonts.map((f) => (
            <li key={`${f.family}|${f.source}`}>
              <span className={`status ${f.status === 'carregada' ? 'status-preservado' : 'status-parcial'}`}>{f.status === 'carregada' ? 'Carregada' : 'Não carregada'}</span>{' '}
              <strong>{f.family}</strong> · {f.source} · {f.license}
              {f.detail && <div className="hint">{f.detail}</div>}
            </li>
          ))}
        </ul>
      </details>
      {report.pages && report.pages.length > 0 && (
        <details>
          <summary>Páginas criadas ({report.pages.length})</summary>
          <ul className="notes">
            {report.pages.map((p) => (
              <li key={p.path}>
                {p.title} · <code>/{p.slug}</code> ← <code>{p.path}</code>
                {p.home ? ' (inicial)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.notes.length > 0 && (
        <details open>
          <summary>Notas e limitações ({report.notes.length})</summary>
          <ul className="notes" data-testid="import-notes">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {report.removed.length > 0 && (
        <details>
          <summary>Removido por segurança ({report.removed.length})</summary>
          <ul className="notes">
            {report.removed.map((r, i) => (
              <li key={`${i}-${r}`}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop() ?? '';
    return `${u.hostname}/…/${file}`;
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * Moldura com a largura real do dispositivo, reduzida para caber: o CSS responsivo da página
 * vê 1280 / 820 / 390 px, como num ecrã desse tamanho.
 */
function ScaledFrame({ width, doc }: { width: number; doc: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 700 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const scale = Math.min(1, el.clientWidth / width);
      setSize({ scale, height: el.clientHeight / scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div className="import-frame" ref={box} style={{ width: '100%', maxWidth: width }}>
      <iframe
        title="Pré-visualização da importação"
        sandbox="allow-scripts"
        srcDoc={doc}
        data-testid="import-preview"
        style={{ width, height: size.height, transform: `scale(${size.scale})`, transformOrigin: '0 0' }}
      />
    </div>
  );
}
