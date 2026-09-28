import { Download, HardDrive, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useServices } from '../app/services';
import { Button, errorMessage } from '../app/ui';
import { ENGINE_VERSION } from '../engine/createBoltEditor';
import { IndexedDbRepository } from '../persistence/indexedDbRepository';
import { backupFileName, buildBackup, copyProjects, downloadJson, readCopied, recordCopied, type TransferResult } from '../persistence/localProjects';
import type { ProjectSummary } from '../persistence/repository';

/** Botão de cópia de segurança dos projetos guardados neste browser. */
export function ExportLocalButton({ label = 'Exportar cópia de segurança' }: { label?: string }) {
  const local = useMemo(() => new IndexedDbRepository(ENGINE_VERSION), []);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    try {
      setError(null);
      downloadJson(backupFileName(), await buildBackup(local));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <Button data-testid="export-local" onClick={() => void run()}>
        <Download aria-hidden="true" /> {label}
      </Button>
      {error && <span className="error-text" role="alert">{error}</span>}
    </>
  );
}

/**
 * Em modo servidor: projetos que ficaram no modo local deste browser. Continuam aqui,
 * intactos; podem ser exportados ou copiados para a conta (sem duplicar se repetir).
 */
export function LocalProjectsPanel({ onCopied }: { onCopied: () => void }) {
  const { catalog, auth } = useServices();
  const account = auth?.email ?? '';
  const local = useMemo(() => new IndexedDbRepository(ENGINE_VERSION), []);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [copied, setCopied] = useState<Record<string, string>>(() => readCopied(account));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TransferResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    local
      .list()
      .then((list) => active && setProjects(list))
      .catch(() => active && setProjects([]));
    return () => {
      active = false;
    };
  }, [local]);

  if (!projects || projects.length === 0) return null;
  const pending = projects.filter((p) => !copied[p.id]);

  const copyAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await copyProjects(local, catalog, pending.map((p) => p.id));
      recordCopied(account, res);
      setCopied(readCopied(account));
      setResults(res);
      onCopied();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = results?.filter((r) => r.error) ?? [];
  return (
    <section className="notice" role="region" aria-label="Projetos deste browser" data-testid="local-projects-panel">
      <HardDrive aria-hidden="true" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {pending.length > 0 ? (
          <div>
            <strong>
              {pending.length === 1 ? 'Há 1 projeto' : `Há ${pending.length} projetos`} do modo local guardado{pending.length === 1 ? '' : 's'} só neste browser.
            </strong>{' '}
            Continua{pending.length === 1 ? '' : 'm'} aqui, intacto{pending.length === 1 ? '' : 's'}, mas não aparece{pending.length === 1 ? '' : 'm'} na sua conta. Pode copiá-lo
            {pending.length === 1 ? '' : 's'} para a conta (as imagens seguem dentro do documento) ou guardar um ficheiro de cópia de segurança.
            <div style={{ marginTop: 6 }}>{pending.map((p) => p.name).join(' · ')}</div>
          </div>
        ) : (
          <div>
            Os {projects.length} projetos do modo local deste browser já foram copiados para a sua conta. As versões locais continuam guardadas neste browser.
          </div>
        )}
        {results && failed.length === 0 && results.length > 0 && (
          <div role="status">Copiado{results.length === 1 ? '' : 's'} para a conta: {results.map((r) => r.name).join(', ')}.</div>
        )}
        {failed.length > 0 && (
          <div className="error-text" role="alert">
            Não foi possível copiar: {failed.map((r) => `${r.name} (${r.error})`).join('; ')}. Os dados locais continuam intactos.
          </div>
        )}
        {error && <div className="error-text" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {pending.length > 0 && (
            <Button variant="primary" disabled={busy} data-testid="copy-local" onClick={() => void copyAll()}>
              <UploadCloud aria-hidden="true" /> {busy ? 'A copiar…' : 'Copiar para a minha conta'}
            </Button>
          )}
          <ExportLocalButton />
        </div>
      </div>
    </section>
  );
}
