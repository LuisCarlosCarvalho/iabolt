-- Bolt IA · base de dados (fatia funcional)
-- Workspaces, membros, projetos e revisões com RLS por membro de workspace.
--
-- Via única de gravação: o documento (project_data) só é escrito pelas funções
-- create_project e save_project. O cliente não tem permissão de INSERT nem de UPDATE
-- nessa coluna; só pode mudar `name` e `archived_at` de projetos onde é editor.


-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  template_id text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  schema_version integer not null check (schema_version > 0),
  engine_name text not null,
  engine_version text not null,
  project_data jsonb not null,
  current_revision integer not null default 0 check (current_revision >= 0),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (created_by, idempotency_key)
);

create index projects_workspace_updated_idx on public.projects (workspace_id, updated_at desc) where archived_at is null;

create table public.project_revisions (
  project_id uuid not null references public.projects (id) on delete cascade,
  revision integer not null check (revision >= 0),
  project_data jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (project_id, revision)
);

-- ---------------------------------------------------------------------------
-- Autorização
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER para evitar recursão de RLS em workspace_members.
create or replace function public.is_workspace_member(p_workspace_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy projects_select on public.projects
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Só renomear e arquivar (permissões de coluna abaixo).
create policy projects_update_meta on public.projects
  for update to authenticated
  using (public.is_workspace_member(workspace_id, array['owner', 'editor']))
  with check (public.is_workspace_member(workspace_id, array['owner', 'editor']));

create policy project_revisions_select on public.project_revisions
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)));

-- Sem políticas de INSERT/DELETE: criar e gravar só pelas funções; projetos são arquivados.

revoke all on public.workspaces, public.workspace_members, public.projects, public.project_revisions from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.projects, public.project_revisions to authenticated;
grant update (name, archived_at) on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace pessoal criado com a conta
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  insert into public.workspaces (name, created_by)
  values (left('Espaço de ' || coalesce(new.email, 'utilizador'), 120), new.id)
  returning id into v_workspace;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Via única de gravação
-- SECURITY DEFINER com verificação explícita de auth.uid() e de membro em cada função.
-- ---------------------------------------------------------------------------

create or replace function public.validate_project_data(p_project_data jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_project_data) is distinct from 'object'
     or jsonb_typeof(p_project_data -> 'pages') is distinct from 'array'
     or jsonb_array_length(p_project_data -> 'pages') < 1 then
    raise exception 'invalid_project_data' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_project(
  p_idempotency_key uuid,
  p_name text,
  p_template_id text,
  p_schema_version integer,
  p_engine_name text,
  p_engine_version text,
  p_project_data jsonb,
  p_workspace_id uuid default null
)
returns setof public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid := p_workspace_id;
  v_project public.projects;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_project from public.projects p
  where p.created_by = v_user and p.idempotency_key = p_idempotency_key;
  if found then
    return next v_project;
    return;
  end if;

  perform public.validate_project_data(p_project_data);

  if v_workspace is null then
    select m.workspace_id into v_workspace
    from public.workspace_members m
    where m.user_id = v_user and m.role in ('owner', 'editor')
    order by m.created_at
    limit 1;
  end if;
  if v_workspace is null or not public.is_workspace_member(v_workspace, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.projects (workspace_id, name, template_id, schema_version, engine_name, engine_version, project_data, idempotency_key, created_by)
  values (v_workspace, p_name, p_template_id, p_schema_version, p_engine_name, p_engine_version, p_project_data, p_idempotency_key, v_user)
  returning * into v_project;

  insert into public.project_revisions (project_id, revision, project_data, created_by)
  values (v_project.id, 0, p_project_data, v_user);

  return next v_project;
end;
$$;

-- Grava só se a revisão de base for a atual. Nunca sobrescreve uma versão mais recente.
create or replace function public.save_project(p_project_id uuid, p_base_revision integer, p_project_data jsonb)
returns table (status text, revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
  v_revision integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select p.workspace_id into v_workspace
  from public.projects p
  where p.id = p_project_id and p.archived_at is null;
  -- Quem não é membro não fica a saber se o projeto existe.
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(v_workspace, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform public.validate_project_data(p_project_data);

  update public.projects p
  set project_data = p_project_data,
      current_revision = p.current_revision + 1,
      updated_at = now()
  where p.id = p_project_id
    and p.current_revision = p_base_revision
    and p.archived_at is null
  returning p.current_revision into v_revision;

  if v_revision is null then
    select p.current_revision into v_revision from public.projects p where p.id = p_project_id;
    return query select 'conflict'::text, v_revision;
    return;
  end if;

  insert into public.project_revisions (project_id, revision, project_data, created_by)
  values (p_project_id, v_revision, p_project_data, v_user);

  return query select 'saved'::text, v_revision;
end;
$$;

revoke all on function public.create_project(uuid, text, text, integer, text, text, jsonb, uuid) from public, anon;
revoke all on function public.save_project(uuid, integer, jsonb) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.create_project(uuid, text, text, integer, text, text, jsonb, uuid) to authenticated;
grant execute on function public.save_project(uuid, integer, jsonb) to authenticated;
grant execute on function public.is_workspace_member(uuid, text[]) to authenticated;
grant execute on function public.validate_project_data(jsonb) to authenticated;
