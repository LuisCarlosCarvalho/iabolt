import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { BOLT_SCHEMA_VERSION, ENGINE_NAME, parseBoltDocument, type BoltDocument, type GrapesProjectData } from '../contract/boltDocument';
import {
  cleanProjectName,
  ProjectNotFoundError,
  type ProjectCatalog,
  type ProjectMeta,
  type ProjectSummary,
  type SaveResult,
} from './repository';

/**
 * Persistência no SERVIDOR (Supabase). Toda a escrita do documento passa pelas funções
 * `create_project` e `save_project` (supabase/migrations). A RLS isola workspaces.
 * «Guardado» só é mostrado depois de `save_project` devolver a revisão.
 */
const summaryRow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  template_id: z.string().nullable(),
  current_revision: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

const documentRow = summaryRow.extend({
  schema_version: z.number().int(),
  engine_name: z.string(),
  engine_version: z.string(),
  project_data: z.unknown(),
});

const saveRow = z.object({ status: z.enum(['saved', 'conflict']), revision: z.number().int() });

const SUMMARY_COLUMNS = 'id, workspace_id, name, template_id, current_revision, created_at, updated_at';

function toSummary(row: z.infer<typeof summaryRow>): ProjectSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    templateId: row.template_id,
    revision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fail(action: string, error: { message: string }, projectId?: string): never {
  if (projectId && /project_not_found/.test(error.message)) throw new ProjectNotFoundError(projectId);
  if (/forbidden|permission denied/.test(error.message)) throw new Error(`Sem permissão para ${action}.`);
  throw new Error(`Falha ao ${action} no servidor: ${error.message}`);
}

export class SupabaseRepository implements ProjectCatalog {
  readonly mode = 'server' as const;

  constructor(private readonly client: SupabaseClient, private readonly engineVersion: string) {}

  async create(idempotencyKey: string, initial: GrapesProjectData, meta?: ProjectMeta): Promise<BoltDocument> {
    const { data, error } = await this.client.rpc('create_project', {
      p_idempotency_key: idempotencyKey,
      p_name: cleanProjectName(meta?.name ?? ''),
      p_template_id: meta?.templateId ?? null,
      p_schema_version: BOLT_SCHEMA_VERSION,
      p_engine_name: ENGINE_NAME,
      p_engine_version: this.engineVersion,
      p_project_data: initial,
    });
    if (error) fail('criar o projeto', error);
    const row = z.array(z.object({ id: z.string() })).min(1).parse(data)[0];
    if (!row) throw new Error('O servidor não devolveu o projeto criado.');
    return this.load(row.id);
  }

  async load(projectId: string): Promise<BoltDocument> {
    const { data, error } = await this.client
      .from('projects')
      .select(`${SUMMARY_COLUMNS}, schema_version, engine_name, engine_version, project_data`)
      .eq('id', projectId)
      .is('archived_at', null)
      .maybeSingle();
    if (error) fail('abrir o projeto', error, projectId);
    if (!data) throw new ProjectNotFoundError(projectId);
    const row = documentRow.parse(data);
    const parsed = parseBoltDocument({
      boltSchemaVersion: row.schema_version,
      engine: { name: row.engine_name, version: row.engine_version },
      projectId: row.id,
      revision: row.current_revision,
      projectData: row.project_data,
    });
    if (!parsed.ok) throw new Error(`Documento do servidor inválido: ${parsed.error}`);
    return parsed.doc;
  }

  async save(projectId: string, baseRevision: number, data: GrapesProjectData): Promise<SaveResult> {
    const { data: result, error } = await this.client.rpc('save_project', {
      p_project_id: projectId,
      p_base_revision: baseRevision,
      p_project_data: data,
    });
    if (error) fail('guardar', error, projectId);
    const row = z.array(saveRow).min(1).parse(result)[0];
    if (!row) throw new Error('O servidor não confirmou a gravação.');
    return row.status === 'saved' ? { status: 'saved', revision: row.revision } : { status: 'conflict', serverRevision: row.revision };
  }

  async list(): Promise<ProjectSummary[]> {
    const { data, error } = await this.client.from('projects').select(SUMMARY_COLUMNS).is('archived_at', null).order('updated_at', { ascending: false });
    if (error) fail('listar os projetos', error);
    return z.array(summaryRow).parse(data).map(toSummary);
  }

  async summary(projectId: string): Promise<ProjectSummary> {
    const { data, error } = await this.client.from('projects').select(SUMMARY_COLUMNS).eq('id', projectId).is('archived_at', null).maybeSingle();
    if (error) fail('abrir o projeto', error, projectId);
    if (!data) throw new ProjectNotFoundError(projectId);
    return toSummary(summaryRow.parse(data));
  }

  private async updateMeta(projectId: string, patch: { name?: string; archived_at?: string }, action: string): Promise<void> {
    const { data, error } = await this.client.from('projects').update(patch).eq('id', projectId).is('archived_at', null).select('id');
    if (error) fail(action, error, projectId);
    if (z.array(z.object({ id: z.string() })).parse(data).length === 0) throw new ProjectNotFoundError(projectId);
  }

  rename(projectId: string, name: string): Promise<void> {
    return this.updateMeta(projectId, { name: cleanProjectName(name) }, 'mudar o nome');
  }

  archive(projectId: string): Promise<void> {
    return this.updateMeta(projectId, { archived_at: new Date().toISOString() }, 'remover o projeto');
  }
}
