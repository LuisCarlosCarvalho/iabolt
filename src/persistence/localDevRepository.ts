import { parseBoltDocument, type BoltDocument, type GrapesProjectData, BOLT_SCHEMA_VERSION, ENGINE_NAME } from '../contract/boltDocument';
import type { ProjectRepository, SaveResult } from './repository';

/**
 * ADAPTADOR SÓ DA PROVA TÉCNICA (Fase 0). Simula o servidor no localStorage para
 * provar serializar → F5 → recarregar no browser. Não é persistência de produto:
 * na Fase 1 é substituído por SupabaseRepository, com o mesmo contrato.
 */
const PREFIX = 'bolt-poc:project:';
const KEYS = 'bolt-poc:idempotency';

export class LocalDevRepository implements ProjectRepository {
  constructor(private readonly engineVersion: string, private readonly storage: Storage = window.localStorage) {}

  private keys(): Record<string, string> {
    return JSON.parse(this.storage.getItem(KEYS) ?? '{}') as Record<string, string>;
  }

  async create(idempotencyKey: string, initial: GrapesProjectData): Promise<BoltDocument> {
    const keys = this.keys();
    const existing = keys[idempotencyKey];
    if (existing) return this.load(existing);
    const projectId = crypto.randomUUID();
    const doc: BoltDocument = {
      boltSchemaVersion: BOLT_SCHEMA_VERSION,
      engine: { name: ENGINE_NAME, version: this.engineVersion },
      projectId,
      revision: 0,
      projectData: initial,
    };
    this.storage.setItem(PREFIX + projectId, JSON.stringify(doc));
    this.storage.setItem(KEYS, JSON.stringify({ ...keys, [idempotencyKey]: projectId }));
    return this.load(projectId);
  }

  async load(projectId: string): Promise<BoltDocument> {
    const raw = this.storage.getItem(PREFIX + projectId);
    if (!raw) throw new Error(`Projeto inexistente: ${projectId}`);
    const parsed = parseBoltDocument(JSON.parse(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.doc;
  }

  async save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult> {
    const current = await this.load(projectId);
    if (current.revision !== baseRevision) return { status: 'conflict', serverRevision: current.revision };
    const next = { ...current, revision: current.revision + 1, projectData: data };
    const parsed = parseBoltDocument(JSON.parse(JSON.stringify(next)));
    if (!parsed.ok) throw new Error(`Documento rejeitado: ${parsed.error}`);
    this.storage.setItem(PREFIX + projectId, JSON.stringify(parsed.doc));
    return { status: 'saved', revision: next.revision };
  }
}
