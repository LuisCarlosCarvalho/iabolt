import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { BOLT_SCHEMA_VERSION, ENGINE_NAME, projectDataSchema, type GrapesProjectData } from '../contract/boltDocument';
import {
  cleanTemplateName,
  TemplateNotFoundError,
  type AddVersionResult,
  type ImportLog,
  type ImportRecord,
  type ImportRecordInput,
  type NewTemplate,
  type TeamTemplate,
  type TemplateLibrary,
  type TemplateVersion,
  type TemplateVersionInfo,
} from './templateLibrary';

/**
 * Biblioteca no SERVIDOR (Supabase, migração 20260928150000). Escrita só pelas funções
 * `create_template`, `add_template_version` e `record_import`; a RLS isola workspaces.
 */
const templateRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  current_version: z.number().int(),
  source_project_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const TEMPLATE_COLUMNS = 'id, name, description, current_version, source_project_id, created_at, updated_at';

const versionRow = z.object({
  template_id: z.string(),
  version: z.number().int(),
  note: z.string(),
  source_project_id: z.string().nullable(),
  created_at: z.string(),
});
const VERSION_COLUMNS = 'template_id, version, note, source_project_id, created_at';

const importRow = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  format: z.enum(['grapesjs', 'elementor', 'bolt', 'html', 'zip']),
  file_name: z.string(),
  file_size: z.number().int(),
  original_text: z.string(),
  report: z.unknown(),
  created_at: z.string(),
});

const toTemplate = (r: z.infer<typeof templateRow>): TeamTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description,
  currentVersion: r.current_version,
  sourceProjectId: r.source_project_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toVersion = (r: z.infer<typeof versionRow>): TemplateVersionInfo => ({
  templateId: r.template_id,
  version: r.version,
  note: r.note,
  sourceProjectId: r.source_project_id,
  createdAt: r.created_at,
});

function fail(action: string, error: { message: string }, templateId?: string): never {
  if (templateId && /template_not_found/.test(error.message)) throw new TemplateNotFoundError(templateId);
  if (/forbidden|permission denied/.test(error.message)) throw new Error(`Sem permissão para ${action}.`);
  if (/project_not_found/.test(error.message)) throw new Error(`Não foi possível ${action}: o projeto de origem já não existe.`);
  throw new Error(`Falha ao ${action} no servidor: ${error.message}`);
}

export class SupabaseTemplateLibrary implements TemplateLibrary, ImportLog {
  readonly mode = 'server' as const;

  constructor(private readonly client: SupabaseClient, private readonly engineVersion: string) {}

  async list(): Promise<TeamTemplate[]> {
    const { data, error } = await this.client.from('templates').select(TEMPLATE_COLUMNS).is('archived_at', null).order('updated_at', { ascending: false });
    if (error) fail('listar os templates', error);
    return z.array(templateRow).parse(data).map(toTemplate);
  }

  async get(templateId: string): Promise<TeamTemplate> {
    const { data, error } = await this.client.from('templates').select(TEMPLATE_COLUMNS).eq('id', templateId).is('archived_at', null).maybeSingle();
    if (error) fail('abrir o template', error, templateId);
    if (!data) throw new TemplateNotFoundError(templateId);
    return toTemplate(templateRow.parse(data));
  }

  async versions(templateId: string): Promise<TemplateVersionInfo[]> {
    await this.get(templateId);
    const { data, error } = await this.client.from('template_versions').select(VERSION_COLUMNS).eq('template_id', templateId).order('version', { ascending: false });
    if (error) fail('listar as versões', error, templateId);
    return z.array(versionRow).parse(data).map(toVersion);
  }

  async loadVersion(templateId: string, version?: number): Promise<TemplateVersion> {
    const target = version ?? (await this.get(templateId)).currentVersion;
    const { data, error } = await this.client
      .from('template_versions')
      .select(`${VERSION_COLUMNS}, project_data`)
      .eq('template_id', templateId)
      .eq('version', target)
      .maybeSingle();
    if (error) fail('abrir o template', error, templateId);
    if (!data) throw new TemplateNotFoundError(`${templateId} v${target}`);
    const row = versionRow.extend({ project_data: z.unknown() }).parse(data);
    return { ...toVersion(row), projectData: projectDataSchema.parse(row.project_data) };
  }

  async create(idempotencyKey: string, input: NewTemplate): Promise<TeamTemplate> {
    const { data, error } = await this.client.rpc('create_template', {
      p_idempotency_key: idempotencyKey,
      p_name: cleanTemplateName(input.name),
      p_description: input.description.trim().slice(0, 500),
      p_source_project_id: input.sourceProjectId,
      p_schema_version: BOLT_SCHEMA_VERSION,
      p_engine_name: ENGINE_NAME,
      p_engine_version: this.engineVersion,
      p_project_data: projectDataSchema.parse(JSON.parse(JSON.stringify(input.projectData))),
    });
    if (error) fail('guardar o template', error);
    const row = z.array(templateRow).min(1).parse(data)[0];
    if (!row) throw new Error('O servidor não devolveu o template criado.');
    return toTemplate(row);
  }

  async addVersion(templateId: string, baseVersion: number, projectData: GrapesProjectData, note: string, sourceProjectId: string | null): Promise<AddVersionResult> {
    const { data, error } = await this.client.rpc('add_template_version', {
      p_template_id: templateId,
      p_base_version: baseVersion,
      p_schema_version: BOLT_SCHEMA_VERSION,
      p_engine_name: ENGINE_NAME,
      p_engine_version: this.engineVersion,
      p_project_data: projectDataSchema.parse(JSON.parse(JSON.stringify(projectData))),
      p_note: note.trim().slice(0, 500),
      p_source_project_id: sourceProjectId,
    });
    if (error) fail('guardar a nova versão', error, templateId);
    const row = z.array(z.object({ status: z.enum(['saved', 'conflict']), version: z.number().int() })).min(1).parse(data)[0];
    if (!row) throw new Error('O servidor não confirmou a nova versão.');
    return row.status === 'saved' ? { status: 'saved', version: row.version } : { status: 'conflict', currentVersion: row.version };
  }

  private async patch(templateId: string, patch: { name?: string; archived_at?: string }, action: string): Promise<void> {
    const { data, error } = await this.client.from('templates').update(patch).eq('id', templateId).is('archived_at', null).select('id');
    if (error) fail(action, error, templateId);
    if (z.array(z.object({ id: z.string() })).parse(data).length === 0) throw new TemplateNotFoundError(templateId);
  }

  rename(templateId: string, name: string): Promise<void> {
    return this.patch(templateId, { name: cleanTemplateName(name) }, 'mudar o nome do template');
  }

  archive(templateId: string): Promise<void> {
    return this.patch(templateId, { archived_at: new Date().toISOString() }, 'retirar o template');
  }

  async record(input: ImportRecordInput): Promise<{ id: string }> {
    const { data, error } = await this.client.rpc('record_import', {
      p_project_id: input.projectId,
      p_format: input.format,
      p_file_name: input.fileName.slice(0, 255),
      p_file_size: input.fileSize,
      p_original_text: input.originalText,
      p_report: JSON.parse(JSON.stringify(input.report)),
    });
    if (error) fail('registar a importação', error);
    const row = z.array(z.object({ id: z.string() })).min(1).parse(data)[0];
    if (!row) throw new Error('O servidor não confirmou o registo da importação.');
    return { id: row.id };
  }

  async forProject(projectId: string): Promise<ImportRecord[]> {
    const { data, error } = await this.client.from('import_records').select('id, project_id, format, file_name, file_size, original_text, report, created_at').eq('project_id', projectId);
    if (error) fail('ler o registo de importação', error);
    return z.array(importRow).parse(data).map((r) => ({
      id: r.id,
      projectId: r.project_id ?? projectId,
      format: r.format,
      fileName: r.file_name,
      fileSize: r.file_size,
      originalText: r.original_text,
      report: r.report,
      createdAt: r.created_at,
    }));
  }
}
