import { projectDataSchema, type GrapesProjectData } from '../contract/boltDocument';
import type { ImportFormatId, ImportReport } from '../importers/types';
import { DB_NAME, done, openBoltDb, request, STORES } from '../persistence/localDb';
import type { PersistenceMode } from '../persistence/repository';

/**
 * Biblioteca de templates da equipa.
 *
 * - Um template tem versões IMUTÁVEIS. «Guardar como template» cria a versão 1; guardar de
 *   novo sobre um template acrescenta uma versão (controlo otimista pela versão atual).
 * - Criar um projeto a partir de um template copia o documento da versão: o projeto é
 *   independente e editá-lo nunca muda o template.
 * - Imagens: no servidor o documento guarda `bolt-asset:<workspace>/library/…` (ficheiros do
 *   workspace, não do projeto); em modo local ficam embutidas (data URL) no próprio documento.
 *
 * Mesmo contrato em memória (testes), IndexedDB (modo local) e Supabase (modo servidor).
 */
export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  currentVersion: number;
  sourceProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersionInfo {
  templateId: string;
  version: number;
  note: string;
  sourceProjectId: string | null;
  createdAt: string;
}

export interface TemplateVersion extends TemplateVersionInfo {
  projectData: GrapesProjectData;
}

export interface NewTemplate {
  name: string;
  description: string;
  sourceProjectId: string | null;
  projectData: GrapesProjectData;
}

export type AddVersionResult = { status: 'saved'; version: number } | { status: 'conflict'; currentVersion: number };

export interface TemplateLibrary {
  readonly mode: PersistenceMode;
  list(): Promise<TeamTemplate[]>;
  get(templateId: string): Promise<TeamTemplate>;
  versions(templateId: string): Promise<TemplateVersionInfo[]>;
  /** Sem `version`: a versão atual. */
  loadVersion(templateId: string, version?: number): Promise<TemplateVersion>;
  create(idempotencyKey: string, input: NewTemplate): Promise<TeamTemplate>;
  addVersion(templateId: string, baseVersion: number, projectData: GrapesProjectData, note: string, sourceProjectId: string | null): Promise<AddVersionResult>;
  rename(templateId: string, name: string): Promise<void>;
  /** Retira da biblioteca sem apagar versões (projetos criados antes não dependem dele). */
  archive(templateId: string): Promise<void>;
}

/** Registo de uma importação concluída: original para recuperação e relatório mostrado. */
export interface ImportRecordInput {
  projectId: string;
  format: ImportFormatId;
  fileName: string;
  fileSize: number;
  originalText: string;
  report: ImportReport;
}

export interface ImportRecord extends Omit<ImportRecordInput, 'report'> {
  id: string;
  /** Como foi gravado; só para mostrar (versões antigas podem ter outro formato). */
  report: unknown;
  createdAt: string;
}

export interface ImportLog {
  record(input: ImportRecordInput): Promise<{ id: string }>;
  forProject(projectId: string): Promise<ImportRecord[]>;
}

export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Template inexistente: ${templateId}`);
    this.name = 'TemplateNotFoundError';
  }
}

/** Prefixo do `templateId` dos projetos criados a partir de um template da equipa. */
export const TEAM_TEMPLATE_PREFIX = 'team:';
export const teamTemplateRef = (templateId: string, version: number) => `${TEAM_TEMPLATE_PREFIX}${templateId}@${version}`;
export function parseTeamTemplateRef(ref: string | null): { templateId: string; version: number } | null {
  const m = ref ? /^team:([^@]+)@(\d+)$/.exec(ref) : null;
  return m?.[1] && m[2] ? { templateId: m[1], version: Number(m[2]) } : null;
}

export function cleanTemplateName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Template sem nome';
}
const cleanText = (text: string) => text.trim().slice(0, 500);

/** Cópia validada e desligada de qualquer referência viva. */
function detach(data: unknown): GrapesProjectData {
  return projectDataSchema.parse(JSON.parse(JSON.stringify(data)));
}

// ---------------------------------------------------------------------------
// Local (IndexedDB) — também usado em memória com `fake-indexeddb` nos testes.
// ---------------------------------------------------------------------------

interface TemplateRow extends TeamTemplate {
  archivedAt: string | null;
  idempotencyKey: string;
}

interface VersionRow extends TemplateVersionInfo {
  /** Documento serializado: texto, nunca referências vivas. */
  document: string;
}

const isTemplateRow = (v: unknown): v is TemplateRow => typeof v === 'object' && v !== null && 'id' in v && 'currentVersion' in v && 'idempotencyKey' in v;
const isVersionRow = (v: unknown): v is VersionRow => typeof v === 'object' && v !== null && 'templateId' in v && 'version' in v && 'document' in v;
const isImportRow = (v: unknown): v is ImportRecord => typeof v === 'object' && v !== null && 'id' in v && 'originalText' in v && 'projectId' in v;

const publicTemplate = ({ id, name, description, currentVersion, sourceProjectId, createdAt, updatedAt }: TemplateRow): TeamTemplate => ({
  id,
  name,
  description,
  currentVersion,
  sourceProjectId,
  createdAt,
  updatedAt,
});
const versionInfo = ({ templateId, version, note, sourceProjectId, createdAt }: VersionRow): TemplateVersionInfo => ({ templateId, version, note, sourceProjectId, createdAt });

export class IndexedDbTemplateLibrary implements TemplateLibrary, ImportLog {
  readonly mode = 'local' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = globalThis.indexedDB,
    private readonly dbName: string = DB_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openBoltDb(this.factory, this.dbName);
    return this.dbPromise;
  }

  private async row(templateId: string, tx?: IDBTransaction): Promise<TemplateRow> {
    const store = tx ? tx.objectStore(STORES.templates) : (await this.db()).transaction(STORES.templates, 'readonly').objectStore(STORES.templates);
    const row: unknown = await request(store.get(templateId));
    if (!isTemplateRow(row) || row.archivedAt !== null) throw new TemplateNotFoundError(templateId);
    return row;
  }

  async list(): Promise<TeamTemplate[]> {
    const db = await this.db();
    const rows: unknown[] = await request(db.transaction(STORES.templates, 'readonly').objectStore(STORES.templates).getAll());
    return rows
      .filter(isTemplateRow)
      .filter((r) => r.archivedAt === null)
      .map(publicTemplate)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(templateId: string): Promise<TeamTemplate> {
    return publicTemplate(await this.row(templateId));
  }

  async versions(templateId: string): Promise<TemplateVersionInfo[]> {
    await this.row(templateId);
    const db = await this.db();
    const rows: unknown[] = await request(db.transaction(STORES.templateVersions, 'readonly').objectStore(STORES.templateVersions).getAll());
    return rows.filter(isVersionRow).filter((r) => r.templateId === templateId).map(versionInfo).sort((a, b) => b.version - a.version);
  }

  async loadVersion(templateId: string, version?: number): Promise<TemplateVersion> {
    const t = await this.row(templateId);
    const db = await this.db();
    const row: unknown = await request(db.transaction(STORES.templateVersions, 'readonly').objectStore(STORES.templateVersions).get([templateId, version ?? t.currentVersion]));
    if (!isVersionRow(row)) throw new TemplateNotFoundError(`${templateId} v${version ?? t.currentVersion}`);
    return { ...versionInfo(row), projectData: detach(JSON.parse(row.document)) };
  }

  async create(idempotencyKey: string, input: NewTemplate): Promise<TeamTemplate> {
    const data = detach(input.projectData);
    const db = await this.db();
    const tx = db.transaction([STORES.templates, STORES.templateVersions], 'readwrite');
    const finished = done(tx);
    const all: unknown[] = await request(tx.objectStore(STORES.templates).getAll());
    const existing = all.filter(isTemplateRow).find((r) => r.idempotencyKey === idempotencyKey);
    if (existing) {
      await finished;
      return publicTemplate(existing);
    }
    const at = new Date().toISOString();
    const row: TemplateRow = {
      id: crypto.randomUUID(),
      name: cleanTemplateName(input.name),
      description: cleanText(input.description),
      currentVersion: 1,
      sourceProjectId: input.sourceProjectId,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      idempotencyKey,
    };
    tx.objectStore(STORES.templates).put(row);
    tx.objectStore(STORES.templateVersions).add({ templateId: row.id, version: 1, note: '', sourceProjectId: input.sourceProjectId, createdAt: at, document: JSON.stringify(data) } satisfies VersionRow);
    await finished;
    return publicTemplate(row);
  }

  async addVersion(templateId: string, baseVersion: number, projectData: GrapesProjectData, note: string, sourceProjectId: string | null): Promise<AddVersionResult> {
    const data = detach(projectData);
    const db = await this.db();
    const tx = db.transaction([STORES.templates, STORES.templateVersions], 'readwrite');
    const finished = done(tx);
    let row: TemplateRow;
    try {
      row = await this.row(templateId, tx);
    } catch (e) {
      tx.abort();
      await finished.catch(() => undefined);
      throw e;
    }
    if (row.currentVersion !== baseVersion) {
      await finished;
      return { status: 'conflict', currentVersion: row.currentVersion };
    }
    const version = row.currentVersion + 1;
    const at = new Date().toISOString();
    tx.objectStore(STORES.templates).put({ ...row, currentVersion: version, updatedAt: at });
    // `add` falha se a versão já existir: nunca substitui uma versão guardada.
    tx.objectStore(STORES.templateVersions).add({ templateId, version, note: cleanText(note), sourceProjectId, createdAt: at, document: JSON.stringify(data) } satisfies VersionRow);
    await finished;
    return { status: 'saved', version };
  }

  private async patch(templateId: string, patch: Partial<Pick<TemplateRow, 'name' | 'archivedAt' | 'updatedAt'>>): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORES.templates, 'readwrite');
    const finished = done(tx);
    let row: TemplateRow;
    try {
      row = await this.row(templateId, tx);
    } catch (e) {
      tx.abort();
      await finished.catch(() => undefined);
      throw e;
    }
    tx.objectStore(STORES.templates).put({ ...row, ...patch });
    await finished;
  }

  rename(templateId: string, name: string): Promise<void> {
    return this.patch(templateId, { name: cleanTemplateName(name), updatedAt: new Date().toISOString() });
  }

  archive(templateId: string): Promise<void> {
    return this.patch(templateId, { archivedAt: new Date().toISOString() });
  }

  async record(input: ImportRecordInput): Promise<{ id: string }> {
    const db = await this.db();
    const tx = db.transaction(STORES.imports, 'readwrite');
    const finished = done(tx);
    const row: ImportRecord = { ...JSON.parse(JSON.stringify(input)), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    tx.objectStore(STORES.imports).add(row);
    await finished;
    return { id: row.id };
  }

  async forProject(projectId: string): Promise<ImportRecord[]> {
    const db = await this.db();
    const rows: unknown[] = await request(db.transaction(STORES.imports, 'readonly').objectStore(STORES.imports).getAll());
    return rows.filter(isImportRow).filter((r) => r.projectId === projectId);
  }
}
