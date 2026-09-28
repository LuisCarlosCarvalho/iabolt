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

/** Contrato único de persistência. Fase 1: SupabaseRepository implementa o mesmo. */
export interface ProjectRepository {
  create(idempotencyKey: string, initial: GrapesProjectData): Promise<BoltDocument>;
  load(projectId: string): Promise<BoltDocument>;
  save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult>;
}

/**
 * ADAPTADOR DE TESTE/PROVA (Fase 0). Simula o servidor: guarda JSON serializado
 * (não referências vivas), atribui ids e revisões, e aplica controlo otimista.
 */
export class MemoryRepository implements ProjectRepository {
  private readonly rows = new Map<string, string>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;

  constructor(private readonly engineVersion: string) {}

  async create(idempotencyKey: string, initial: GrapesProjectData): Promise<BoltDocument> {
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
    this.rows.set(projectId, JSON.stringify(doc));
    this.byKey.set(idempotencyKey, projectId);
    return this.load(projectId);
  }

  async load(projectId: string): Promise<BoltDocument> {
    const raw = this.rows.get(projectId);
    if (!raw) throw new Error(`Projeto inexistente: ${projectId}`);
    const parsed = parseBoltDocument(JSON.parse(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.doc;
  }

  async save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult> {
    const current = await this.load(projectId);
    if (current.revision !== baseRevision) return { status: 'conflict', serverRevision: current.revision };
    const next: BoltDocument = { ...current, revision: current.revision + 1, projectData: data };
    const parsed = parseBoltDocument(JSON.parse(JSON.stringify(next)));
    if (!parsed.ok) throw new Error(`Documento rejeitado: ${parsed.error}`);
    this.rows.set(projectId, JSON.stringify(parsed.doc));
    return { status: 'saved', revision: next.revision };
  }
}
