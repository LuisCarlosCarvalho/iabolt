-- Bolt IA · biblioteca de templates da equipa e registo de importações.
-- Migração NOVA: não altera nem apaga dados existentes (projetos, revisões, imagens).
--
-- Regras:
--   * Um template pertence a um workspace. O conteúdo vive em versões IMUTÁVEIS
--     (template_versions). Alterar um template = acrescentar uma versão.
--   * Criar um projeto a partir de um template copia o documento da versão escolhida
--     (create_project já existente): o projeto é independente do template.
--   * As imagens referenciadas (`bolt-asset:<workspace>/library/…`) pertencem ao workspace,
--     não ao projeto; arquivar/remover um projeto não as apaga.
--   * Importações guardam o ficheiro ORIGINAL (texto) e o relatório de compatibilidade, para
--     recuperação. Só membros do workspace os leem.
--   * Escrita só pelas funções SECURITY DEFINER; o cliente só pode renomear/arquivar templates.


-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  -- Projeto de onde saiu a primeira versão. Apenas informativo: o template não depende dele.
  source_project_id uuid references public.projects (id) on delete set null,
  current_version integer not null default 1 check (current_version >= 1),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (created_by, idempotency_key)
);

create index templates_workspace_updated_idx on public.templates (workspace_id, updated_at desc) where archived_at is null;

create table public.template_versions (
  template_id uuid not null references public.templates (id) on delete cascade,
  version integer not null check (version >= 1),
  schema_version integer not null check (schema_version > 0),
  engine_name text not null,
  engine_version text not null,
  project_data jsonb not null,
  note text not null default '' check (char_length(note) <= 500),
  -- Histórico apenas (sem chave estrangeira): a versão é imutável e sobrevive ao projeto.
  source_project_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);

create table public.import_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  format text not null check (format in ('grapesjs', 'elementor', 'bolt', 'html', 'zip')),
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_size integer not null check (file_size >= 0),
  -- Original para recuperação (JSON/HTML em texto). Limite de 5 MB de caracteres.
  original_text text not null check (char_length(original_text) <= 5242880),
  report jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index import_records_workspace_idx on public.import_records (workspace_id, created_at desc);
create index import_records_project_idx on public.import_records (project_id);

-- Versões são imutáveis, mesmo para funções SECURITY DEFINER. (DELETE só em cascata ao
-- remover o workspace; não há política nem permissão de DELETE para o cliente.)
create or replace function public.forbid_template_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'template_version_immutable' using errcode = '42501';
end;
$$;

create trigger template_versions_immutable
  before update on public.template_versions
  for each row execute function public.forbid_template_version_update();

-- O registo de importação também não muda depois de criado (só o projeto pode ficar a null).
create or replace function public.forbid_import_record_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is null and old.project_id is not null
     and new.id = old.id and new.original_text = old.original_text and new.report = old.report
     and new.workspace_id = old.workspace_id then
    return new; -- on delete set null do projeto
  end if;
  raise exception 'import_record_immutable' using errcode = '42501';
end;
$$;

create trigger import_records_immutable
  before update on public.import_records
  for each row execute function public.forbid_import_record_update();

-- ---------------------------------------------------------------------------
-- Autorização (RLS)
-- ---------------------------------------------------------------------------

alter table public.templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.import_records enable row level security;

create policy templates_select on public.templates
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Só renomear, descrever e arquivar (permissões de coluna abaixo).
create policy templates_update_meta on public.templates
  for update to authenticated
  using (public.is_workspace_member(workspace_id, array['owner', 'editor']))
  with check (public.is_workspace_member(workspace_id, array['owner', 'editor']));

create policy template_versions_select on public.template_versions
  for select to authenticated
  using (exists (select 1 from public.templates t where t.id = template_id and public.is_workspace_member(t.workspace_id)));

create policy import_records_select on public.import_records
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.templates, public.template_versions, public.import_records from anon, authenticated;
grant select on public.templates, public.template_versions, public.import_records to authenticated;
grant update (name, description, archived_at) on public.templates to authenticated;

-- ---------------------------------------------------------------------------
-- Funções de escrita
-- ---------------------------------------------------------------------------

-- Workspace de destino: o indicado (se for owner/editor) ou o primeiro onde é owner/editor.
create or replace function public.writable_workspace(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := p_workspace_id;
begin
  if v_workspace is null then
    select m.workspace_id into v_workspace
    from public.workspace_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'editor')
    order by m.created_at
    limit 1;
  end if;
  if v_workspace is null or not public.is_workspace_member(v_workspace, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_workspace;
end;
$$;

-- Cria o template com a versão 1. Idempotente por (utilizador, chave).
create or replace function public.create_template(
  p_idempotency_key uuid,
  p_name text,
  p_description text,
  p_source_project_id uuid,
  p_schema_version integer,
  p_engine_name text,
  p_engine_version text,
  p_project_data jsonb,
  p_workspace_id uuid default null
)
returns setof public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
  v_template public.templates;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_template from public.templates t
  where t.created_by = v_user and t.idempotency_key = p_idempotency_key;
  if found then
    return next v_template;
    return;
  end if;

  perform public.validate_project_data(p_project_data);
  v_workspace := public.writable_workspace(p_workspace_id);

  -- O projeto de origem, se indicado, tem de ser do mesmo workspace (e visível ao utilizador).
  if p_source_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_source_project_id and p.workspace_id = v_workspace
  ) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  insert into public.templates (workspace_id, name, description, source_project_id, current_version, idempotency_key, created_by)
  values (v_workspace, p_name, coalesce(p_description, ''), p_source_project_id, 1, p_idempotency_key, v_user)
  returning * into v_template;

  insert into public.template_versions (template_id, version, schema_version, engine_name, engine_version, project_data, source_project_id, created_by)
  values (v_template.id, 1, p_schema_version, p_engine_name, p_engine_version, p_project_data, p_source_project_id, v_user);

  return next v_template;
end;
$$;

-- Acrescenta uma versão só se a versão de base for a atual (nunca substitui uma versão).
create or replace function public.add_template_version(
  p_template_id uuid,
  p_base_version integer,
  p_schema_version integer,
  p_engine_name text,
  p_engine_version text,
  p_project_data jsonb,
  p_note text default '',
  p_source_project_id uuid default null
)
returns table (status text, version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
  v_version integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select t.workspace_id into v_workspace
  from public.templates t
  where t.id = p_template_id and t.archived_at is null;
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(v_workspace, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public.validate_project_data(p_project_data);

  if p_source_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_source_project_id and p.workspace_id = v_workspace
  ) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  update public.templates t
  set current_version = t.current_version + 1,
      updated_at = now()
  where t.id = p_template_id
    and t.current_version = p_base_version
    and t.archived_at is null
  returning t.current_version into v_version;

  if v_version is null then
    select t.current_version into v_version from public.templates t where t.id = p_template_id;
    return query select 'conflict'::text, v_version;
    return;
  end if;

  insert into public.template_versions (template_id, version, schema_version, engine_name, engine_version, project_data, note, source_project_id, created_by)
  values (p_template_id, v_version, p_schema_version, p_engine_name, p_engine_version, p_project_data, coalesce(p_note, ''), p_source_project_id, v_user);

  return query select 'saved'::text, v_version;
end;
$$;

-- Regista uma importação concluída: original, relatório e projeto criado.
create or replace function public.record_import(
  p_project_id uuid,
  p_format text,
  p_file_name text,
  p_file_size integer,
  p_original_text text,
  p_report jsonb
)
returns setof public.import_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
  v_record public.import_records;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select p.workspace_id into v_workspace from public.projects p where p.id = p_project_id;
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(v_workspace, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'invalid_report' using errcode = '22023';
  end if;

  insert into public.import_records (workspace_id, project_id, format, file_name, file_size, original_text, report, created_by)
  values (v_workspace, p_project_id, p_format, p_file_name, p_file_size, p_original_text, p_report, v_user)
  returning * into v_record;

  return next v_record;
end;
$$;

revoke all on function public.forbid_template_version_update() from public, anon, authenticated;
revoke all on function public.forbid_import_record_update() from public, anon, authenticated;
revoke all on function public.writable_workspace(uuid) from public, anon;
revoke all on function public.create_template(uuid, text, text, uuid, integer, text, text, jsonb, uuid) from public, anon;
revoke all on function public.add_template_version(uuid, integer, integer, text, text, jsonb, text, uuid) from public, anon;
revoke all on function public.record_import(uuid, text, text, integer, text, jsonb) from public, anon;
grant execute on function public.writable_workspace(uuid) to authenticated;
grant execute on function public.create_template(uuid, text, text, uuid, integer, text, text, jsonb, uuid) to authenticated;
grant execute on function public.add_template_version(uuid, integer, integer, text, text, jsonb, text, uuid) to authenticated;
grant execute on function public.record_import(uuid, text, text, integer, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Imagens: duração garantida para templates
-- As imagens da pasta do workspace podem estar referenciadas por templates e por projetos
-- derivados. Apagar passa a ser só do owner (antes: owner e editor). A aplicação não apaga
-- imagens; esta política evita que um editor quebre templates por engano.
-- ---------------------------------------------------------------------------

drop policy if exists project_assets_delete on storage.objects;

create policy project_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name), array['owner'])
  );
