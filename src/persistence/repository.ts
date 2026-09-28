import {
  BOLT_SCHEMA_VERSION,
  ENGINE_NAME,
  parseBoltDocument,
  type BoltDocument,
  type GrapesProjectData,
} from '../contract/boltDocument';

export type SaveResult =
  | { status: 'saved'; revision: number }
  | { status: 'conflict'; serverRevision: number };

/** Metadados do projeto. Vivem fora do envelope (colunas do servidor). */
export interface ProjectMeta {
  name: string;
  /** Template de origem, `em-branco` ou null (desconhecido). Só informativo: a cópia é independente. */
  templateId: string | null;
}

/** Contrato único de persistência do documento. */
export interface ProjectRepository {
  create(idempotencyKey: string, initial: GrapesProjectData, meta?: ProjectMeta): Promise<BoltDocument>;
  load(projectId: string): Promise<BoltDocument>;
  save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult>;
}

/**
 * Onde os dados ficam de facto. A interface mostra isto ao utilizador:
 * `local` nunca é apresentado como gravação no servidor.
 */
export type PersistenceMode = 'local' | 'server';

export interface ProjectSummary extends ProjectMeta {
  id: string;
  /** Só no servidor: pasta das imagens no Storage. */
  workspaceId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Repositório com catálogo (Dashboard). Implementado por IndexedDB (local) e Supabase (servidor). */
export interface ProjectCatalog extends ProjectRepository {
  readonly mode: PersistenceMode;
  list(): Promise<ProjectSummary[]>;
  summary(projectId: string): Promise<ProjectSummary>;
  rename(projectId: string, name: string): Promise<void>;
  /** Retira da lista sem apagar dados (o servidor guarda `archived_at`). */
  archive(projectId: string): Promise<void>;
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Projeto inexistente: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export const DEFAULT_PROJECT_NAME = 'Projeto sem nome';

export function cleanProjectName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 120);
  return trimmed || DEFAULT_PROJECT_NAME;
}

interface MemoryRow {
  doc: string;
  meta: ProjectMeta;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

/**
 * ADAPTADOR DE TESTE (Fase 0). Simula o servidor: guarda JSON serializado
 * (não referências vivas), atribui ids e revisões, e aplica controlo otimista.
 */
export class MemoryRepository implements ProjectCatalog {
  readonly mode = 'local' as const;
  private readonly rows = new Map<string, MemoryRow>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;

  constructor(private readonly engineVersion: string, private readonly now: () => Date = () => new Date()) {}

  async create(idempotencyKey: string, initial: GrapesProjectData, meta?: ProjectMeta): Promise<BoltDocument> {
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return this.load(existing);
    const projectId = `proj-${++this.seq}`;
    const doc: BoltDocument = {
      boltSchemaVersion: BOLT_SCHEMA_VERSION,
      engine: { name: ENGINE_NAME, version: this.engineVersion },
      projectId,
      revision: 0,
      projectData: initial,
    };
    const at = this.now().toISOString();
    this.rows.set(projectId, {
      doc: JSON.stringify(doc),
      meta: { name: cleanProjectName(meta?.name ?? ''), templateId: meta?.templateId ?? null },
      createdAt: at,
      updatedAt: at,
      archived: false,
    });
    this.byKey.set(idempotencyKey, projectId);
    return this.load(projectId);
  }

  private row(projectId: string): MemoryRow {
    const row = this.rows.get(projectId);
    if (!row || row.archived) throw new ProjectNotFoundError(projectId);
    return row;
  }

  async load(projectId: string): Promise<BoltDocument> {
    const parsed = parseBoltDocument(JSON.parse(this.row(projectId).doc));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.doc;
  }

  async save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult> {
    const current = await this.load(projectId);
    if (current.revision !== baseRevision) return { status: 'conflict', serverRevision: current.revision };
    const next: BoltDocument = { ...current, revision: current.revision + 1, projectData: data };
    const parsed = parseBoltDocument(JSON.parse(JSON.stringify(next)));
    if (!parsed.ok) throw new Error(`Documento rejeitado: ${parsed.error}`);
    const row = this.row(projectId);
    row.doc = JSON.stringify(parsed.doc);
    row.updatedAt = this.now().toISOString();
    return { status: 'saved', revision: next.revision };
  }

  async list(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const [id, row] of this.rows) {
      if (!row.archived) out.push(await this.summary(id));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async summary(projectId: string): Promise<ProjectSummary> {
    const row = this.row(projectId);
    const doc = await this.load(projectId);
    return { id: projectId, ...row.meta, revision: doc.revision, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async rename(projectId: string, name: string): Promise<void> {
    const row = this.row(projectId);
    row.meta = { ...row.meta, name: cleanProjectName(name) };
    row.updatedAt = this.now().toISOString();
  }

  async archive(projectId: string): Promise<void> {
    this.row(projectId).archived = true;
  }
}
