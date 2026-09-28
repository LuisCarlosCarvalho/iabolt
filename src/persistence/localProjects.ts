import type { BoltDocument } from '../contract/boltDocument';
import type { ProjectCatalog, ProjectSummary } from './repository';

/**
 * Projetos criados em modo local (IndexedDB) quando o servidor é ativado.
 * Nada é apagado: os dados locais ficam no browser. Há duas formas de os preservar:
 * uma cópia de segurança em ficheiro e a cópia para a conta (idempotente).
 */
export interface LocalBackup {
  format: 'bolt-ia-backup';
  version: 1;
  exportedAt: string;
  projects: Array<{ summary: ProjectSummary; document: BoltDocument }>;
}

export async function buildBackup(source: ProjectCatalog): Promise<LocalBackup> {
  const projects: LocalBackup['projects'] = [];
  for (const summary of await source.list()) {
    projects.push({ summary, document: await source.load(summary.id) });
  }
  return { format: 'bolt-ia-backup', version: 1, exportedAt: new Date().toISOString(), projects };
}

export function backupFileName(now: Date = new Date()): string {
  return `bolt-ia-copia-local-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
}

/** Descarrega um objeto JSON como ficheiro (no browser do utilizador, sem rede). */
export function downloadJson(fileName: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface TransferResult {
  localId: string;
  name: string;
  serverId?: string;
  error?: string;
}

/**
 * Copia projetos locais para o destino (a conta no servidor). A chave de idempotência é o
 * id local: repetir a cópia devolve o mesmo projeto do servidor em vez de criar outro.
 * A origem não é alterada.
 */
export async function copyProjects(source: ProjectCatalog, target: ProjectCatalog, ids?: readonly string[]): Promise<TransferResult[]> {
  const results: TransferResult[] = [];
  const summaries = (await source.list()).filter((p) => !ids || ids.includes(p.id));
  for (const summary of summaries) {
    try {
      const doc = await source.load(summary.id);
      const created = await target.create(summary.id, doc.projectData, { name: summary.name, templateId: summary.templateId });
      results.push({ localId: summary.id, name: summary.name, serverId: created.projectId });
    } catch (e) {
      results.push({ localId: summary.id, name: summary.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Registo, neste browser e por conta, dos projetos locais já copiados. */
const copiedKey = (account: string) => `bolt-ia:copiados:${account}`;

export function readCopied(account: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(copiedKey(account));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

export function recordCopied(account: string, results: readonly TransferResult[]): void {
  try {
    const next = { ...readCopied(account) };
    for (const r of results) if (r.serverId) next[r.localId] = r.serverId;
    window.localStorage.setItem(copiedKey(account), JSON.stringify(next));
  } catch {
    // Sem armazenamento: a cópia continua idempotente no servidor; só se perde a indicação visual.
  }
}
