import { AlertTriangle, CheckCircle2, FileUp, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, navigate, projectPath } from '../app/router';
import { persistenceLabel, useServices } from '../app/services';
import { Button, errorMessage, IconButton, Spinner } from '../app/ui';
import { previewDocument } from '../engine/runtime';
import { analyzeImport, browserDependencies, completeImport, FORMATS, unresolvedAssets, type ImportAnalysis } from './pipeline';
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

export function ImportPage() {
  const { mode } = useServices();
  const [step, setStep] = useState<Step>({ name: 'choose' });

  const analyze = async (file: File) => {
    setStep({ name: 'analyzing', fileName: file.name });
    try {
      const analysis = await analyzeImport(file, browserDependencies());
      setStep({ name: 'review', analysis });
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
      {step.name === 'choose' && <ChooseFile error={step.error} onFile={(f) => void analyze(f)} />}
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
          onProgress={(progress) => setStep({ name: 'importing', analysis: step.analysis, progress })}
          onError={(error) => setStep({ name: 'choose', error })}
        />
      )}
    </main>
  );
}

function ChooseFile({ error, onFile }: { error: string | undefined; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
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
          <strong>Arraste o ficheiro para aqui</strong> ou
        </p>
        <Button variant="primary" onClick={() => input.current?.click()}>
          Escolher ficheiro
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
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
      <p className="hint">Scripts e manipuladores de eventos do ficheiro nunca são executados: são removidos na importação e indicados no relatório.</p>
    </>
  );
}

function Review({
  analysis,
  busy,
  onCancel,
  onProgress,
  onError,
}: {
  analysis: ImportAnalysis;
  busy: string | null;
  onCancel: () => void;
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
  const doc = useMemo(() => previewDocument(analysis.projectData, { interactive: true, scroll: true }), [analysis]);
  const unresolved = unresolvedAssets(report);
  const copiable = report.assets.filter((a) => a.status === 'disponivel');
  const partial = unresolved.length > 0 || report.totals.parcial > 0 || report.totals['nao-suportado'] > 0;

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onProgress(copiable.length && rights ? `A copiar imagens (0/${copiable.length})…` : 'A criar o projeto…');
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
        <ReportDetails report={report} />
      </section>

      <section className="import-preview" aria-label="Pré-visualização">
        <div className="device-tabs" role="group" aria-label="Largura da pré-visualização">
          <IconButton label="Computador" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor /></IconButton>
          <IconButton label="Tablet" aria-pressed={device === 'tablet'} onClick={() => setDevice('tablet')}><Tablet /></IconButton>
          <IconButton label="Telemóvel" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone /></IconButton>
        </div>
        <ScaledFrame width={PREVIEW_WIDTHS[device]} doc={doc} />
        <p className="hint">Pré-visualização isolada: só corre o runtime do Bolt IA (menu e carrossel). Imagens em falta aparecem assinaladas a vermelho.</p>

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
              {report.totals.parcial + report.totals['nao-suportado'] > 0 ? ` e que há elementos convertidos parcialmente ou não suportados` : ''}. O ficheiro original fica
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
              <span className={`status status-asset-${a.status}`}>{ASSET_LABELS[a.status]}</span> <code title={a.url}>{shortUrl(a.url)}</code>
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
