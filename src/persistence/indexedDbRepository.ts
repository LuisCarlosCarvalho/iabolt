import { BOLT_SCHEMA_VERSION, ENGINE_NAME, parseBoltDocument, type BoltDocument, type GrapesProjectData } from '../contract/boltDocument';
import {
  cleanProjectName,
  ProjectNotFoundError,
  type ProjectCatalog,
  type ProjectMeta,
  type ProjectSummary,
  type SaveResult,
} from './repository';
import { DB_NAME, done, openBoltDb, request, STORES } from './localDb';

/**
 * Persistência LOCAL (modo sem servidor configurado). Os dados ficam só neste browser,
 * em IndexedDB. A interface identifica sempre este modo; não é gravação no servidor.
 * Mesmo contrato do SupabaseRepository: create/load/save com revisão otimista.
 */
const PROJECTS = STORES.projects;
const KEYS = STORES.keys;

interface ProjectRow {
  id: string;
  name: string;
  templateId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** BoltDocument serializado: guardamos texto, nunca referências vivas. */
  document: string;
}

interface KeyRow {
  key: string;
  projectId: string;
}

function isProjectRow(v: unknown): v is ProjectRow {
  return typeof v === 'object' && v !== null && 'id' in v && 'document' in v && 'revision' in v;
}

function isKeyRow(v: unknown): v is KeyRow {
  return typeof v === 'object' && v !== null && 'key' in v && 'projectId' in v;
}

function parseRow(row: ProjectRow): BoltDocument {
  const parsed = parseBoltDocument(JSON.parse(row.document));
  if (!parsed.ok) throw new Error(`Documento inválido guardado localmente: ${parsed.error}`);
  return parsed.doc;
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    templateId: row.templateId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class IndexedDbRepository implements ProjectCatalog {
  readonly mode = 'local' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly engineVersion: string,
    private readonly factory: IDBFactory = globalThis.indexedDB,
    private readonly dbName: string = DB_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openBoltDb(this.factory, this.dbName);
    }
    return this.dbPromise;
  }

  private async getRow(projectId: string): Promise<ProjectRow> {
    const db = await this.db();
    const row: unknown = await request(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).get(projectId));
    if (!isProjectRow(row) || row.archivedAt !== null) throw new ProjectNotFoundError(projectId);
    return row;
  }

  async create(idempotencyKey: string, initial: GrapesProjectData, meta?: ProjectMeta): Promise<BoltDocument> {
    const db = await this.db();
    const tx = db.transaction([PROJECTS, KEYS], 'readwrite');
    const finished = done(tx);
    const existing: unknown = await request(tx.objectStore(KEYS).get(idempotencyKey));
    let projectId: string;
    if (isKeyRow(existing)) {
      projectId = existing.projectId;
    } else {
      projectId = crypto.randomUUID();
      const doc: BoltDocument = {
        boltSchemaVersion: BOLT_SCHEMA_VERSION,
        engine: { name: ENGINE_NAME, version: this.engineVersion },
        projectId,
        revision: 0,
        projectData: initial,
      };
      const parsed = parseBoltDocument(JSON.parse(JSON.stringify(doc)));
      if (!parsed.ok) {
        tx.abort();
        await finished.catch(() => undefined);
        throw new Error(`Documento rejeitado: ${parsed.error}`);
      }
      const at = new Date().toISOString();
      const row: ProjectRow = {
        id: projectId,
        name: cleanProjectName(meta?.name ?? ''),
        templateId: meta?.templateId ?? null,
        revision: 0,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
        document: JSON.stringify(parsed.doc),
      };
      tx.objectStore(PROJECTS).put(row);
      tx.objectStore(KEYS).put({ key: idempotencyKey, projectId } satisfies KeyRow);
    }
    await finished;
    return this.load(projectId);
  }

  async load(projectId: string): Promise<BoltDocument> {
    return parseRow(await this.getRow(projectId));
  }

  /** Leitura, comparação de revisão e escrita na mesma transação: sem sobrescrita silenciosa. */
  async save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult> {
    const db = await this.db();
    const tx = db.transaction(PROJECTS, 'readwrite');
    const finished = done(tx);
    const row: unknown = await request(tx.objectStore(PROJECTS).get(projectId));
    if (!isProjectRow(row) || row.archivedAt !== null) {
      tx.abort();
      await finished.catch(() => undefined);
      throw new ProjectNotFoundError(projectId);
    }
    if (row.revision !== baseRevision) {
      await finished;
      return { status: 'conflict', serverRevision: row.revision };
    }
    const current = parseRow(row);
    const next: BoltDocument = { ...current, revision: row.revision + 1, projectData: data };
    const parsed = parseBoltDocument(JSON.parse(JSON.stringify(next)));
    if (!parsed.ok) {
      tx.abort();
      await finished.catch(() => undefined);
      throw new Error(`Documento rejeitado: ${parsed.error}`);
    }
    tx.objectStore(PROJECTS).put({ ...row, revision: next.revision, updatedAt: new Date().toISOString(), document: JSON.stringify(parsed.doc) });
    await finished;
    return { status: 'saved', revision: next.revision };
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const rows: unknown[] = await request(db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS).getAll());
    return rows
      .filter(isProjectRow)
      .filter((r) => r.archivedAt === null)
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async summary(projectId: string): Promise<ProjectSummary> {
    return toSummary(await this.getRow(projectId));
  }

  private async update(projectId: string, patch: Partial<Pick<ProjectRow, 'name' | 'archivedAt' | 'updatedAt'>>): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(PROJECTS, 'readwrite');
    const finished = done(tx);
    const row: unknown = await request(tx.objectStore(PROJECTS).get(projectId));
    if (!isProjectRow(row) || row.archivedAt !== null) {
      tx.abort();
      await finished.catch(() => undefined);
      throw new ProjectNotFoundError(projectId);
    }
    tx.objectStore(PROJECTS).put({ ...row, ...patch });
    await finished;
  }

  rename(projectId: string, name: string): Promise<void> {
    return this.update(projectId, { name: cleanProjectName(name), updatedAt: new Date().toISOString() });
  }

  archive(projectId: string): Promise<void> {
    return this.update(projectId, { archivedAt: new Date().toISOString() });
  }
}
