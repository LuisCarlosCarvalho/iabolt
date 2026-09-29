-- Bolt IA · Configurações de IA (configuração CENTRAL, gerida pelos administradores do Bolt IA).
-- PARA REVISÃO: ainda não aplicada ao projeto Supabase. Depende de 20260929120000 (ai_usage).
--
-- Autorização: tabela `platform_admins` (por user_id). Ninguém escreve nela pela API: o primeiro
-- administrador é atribuído uma vez no SQL Editor; os seguintes por um administrador existente.
-- Ser owner de um workspace ou ter um email `admin@…` NÃO dá administração.
--
-- Chave do fornecedor: Supabase Vault (cifrada em repouso; decifrada só em vault.decrypted_secrets,
-- sem acesso para anon/authenticated). As tabelas guardam apenas o id do segredo, os últimos 4
-- caracteres e uma impressão digital. Nenhuma função devolve a chave, exceto ai_provider_key().
-- Privilégios EFETIVOS de leitura da chave: o papel de serviço (qualquer código com a service_role
-- key — aqui, as funções ai-propose e ai-admin) e quem administra a infraestrutura (postgres, painel
-- do Supabase, incluindo a secção Vault). anon/authenticated nunca: nem utilizadores comuns nem
-- administradores pela interface recebem o segredo (a função ai-admin nunca o devolve).
-- REQUISITO: a extensão Vault tem de existir ANTES desta migração (ai_provider_key é language sql e
-- o corpo é validado na criação).
--
-- Fonte única: ai_settings (uma linha). ai_reserve lê daqui os limites, o estado e o orçamento.
-- Assistente DESATIVADO por omissão; não se ativa sem chave válida.

-- ---------------------------------------------------------------------------
-- Administradores da plataforma
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  note text
);

alter table public.platform_admins enable row level security;
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid());
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (select 1 from public.platform_admins where user_id = p_user_id);
$$;

-- Só para mostrar/esconder a entrada na interface; a autorização real é feita no servidor.
create or replace function public.ai_whoami()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.is_platform_admin(auth.uid()); $$;

-- ---------------------------------------------------------------------------
-- Modelos suportados (só os que têm adaptador implementado) e configuração central
-- ---------------------------------------------------------------------------

create table public.ai_models (
  provider text not null check (provider in ('anthropic')),
  model text not null,
  label text not null,
  price_input numeric(10, 4) not null check (price_input >= 0),
  price_output numeric(10, 4) not null check (price_output >= 0),
  price_cache_read numeric(10, 4) not null check (price_cache_read >= 0),
  price_cache_write numeric(10, 4) not null check (price_cache_write >= 0),
  supported boolean not null default true,
  primary key (provider, model)
);

-- Preços públicos (USD por milhão de tokens) consultados a 29/09/2026.
insert into public.ai_models (provider, model, label, price_input, price_output, price_cache_read, price_cache_write) values
  ('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 10, 0.2, 2.5),
  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1, 5, 0.1, 1.25),
  ('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', 4, 20, 0.2, 5);

create table public.ai_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  provider text not null default 'anthropic',
  model text not null default 'claude-sonnet-5-5',
  requests_per_user_day integer not null default 50 check (requests_per_user_day between 1 and 1000),
  requests_per_workspace_day integer not null default 300 check (requests_per_workspace_day between 1 and 10000),
  max_concurrent_per_user integer not null default 1 check (max_concurrent_per_user between 1 and 5),
  max_concurrent_per_workspace integer not null default 4 check (max_concurrent_per_workspace between 1 and 50),
  max_output_tokens integer not null default 1500 check (max_output_tokens between 100 and 4000),
  max_retries integer not null default 1 check (max_retries between 0 and 2),
  max_operations integer not null default 10 check (max_operations between 1 and 20),
  overhead_tokens integer not null default 1000 check (overhead_tokens between 0 and 10000),
  timeout_ms integer not null default 30000 check (timeout_ms between 5000 and 120000),
  reservation_ttl_seconds integer not null default 300 check (reservation_ttl_seconds between 60 and 3600),
  monthly_budget_usd numeric(10, 2) not null default 25 check (monthly_budget_usd between 0 and 10000),
  key_secret_id uuid,
  key_last4 text,
  key_fingerprint text,
  key_status text not null default 'none' check (key_status in ('none', 'valid', 'invalid')),
  key_tested_at timestamptz,
  key_updated_at timestamptz,
  pending_secret_id uuid,
  pending_last4 text,
  pending_fingerprint text,
  version integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (provider, model) references public.ai_models (provider, model),
  -- Todas as tentativas cabem no tempo da função (140 s).
  check (timeout_ms * (max_retries + 1) + 10000 <= 140000),
  -- Não se ativa sem chave válida.
  check (not enabled or (key_secret_id is not null and key_status = 'valid')),
  check ((key_secret_id is null) = (key_status = 'none'))
);
insert into public.ai_settings default values;

create table public.ai_settings_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  -- Nunca contém segredos: a chave aparece só como «…1234».
  changes jsonb not null default '{}'::jsonb
);

alter table public.ai_models enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_settings_audit enable row level security;
revoke all on public.ai_models, public.ai_settings, public.ai_settings_audit from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leitura para utilizadores e para a função do assistente
-- ---------------------------------------------------------------------------

-- Estado público (sem segredos): o editor mostra ou não o assistente.
create or replace function public.ai_status()
returns table (enabled boolean, provider text, model text, model_label text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled and s.key_status = 'valid', s.provider, s.model, m.label
  from public.ai_settings s join public.ai_models m on m.provider = s.provider and m.model = s.model
  where s.id = 1;
$$;

-- Configuração em vigor + preços do modelo (para ai-propose; sem segredos).
create or replace function public.ai_runtime_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(s) - 'key_secret_id' - 'pending_secret_id' - 'pending_last4' - 'pending_fingerprint'
         || jsonb_build_object('prices', jsonb_build_object('input', m.price_input, 'output', m.price_output, 'cacheRead', m.price_cache_read, 'cacheWrite', m.price_cache_write), 'model_label', m.label)
  from public.ai_settings s join public.ai_models m on m.provider = s.provider and m.model = s.model
  where s.id = 1;
$$;

-- A chave decifrada. SÓ o papel de serviço (ai-propose, teste de ligação).
create or replace function public.ai_provider_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret from vault.decrypted_secrets d
  where d.id = (select key_secret_id from public.ai_settings where id = 1);
$$;

-- ---------------------------------------------------------------------------
-- Reserva atómica (lê os limites da configuração central)
-- ---------------------------------------------------------------------------

create or replace function public.ai_reserve(
  p_request_id uuid,
  p_user_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_reserve_usd numeric,
  p_model text,
  p_prices jsonb
)
returns table (reservation_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  v_ttl interval;
  v_day timestamptz := date_trunc('day', now());
  v_month timestamptz := date_trunc('month', now());
  v_count integer;
  v_spent numeric;
  v_id uuid;
begin
  if p_request_id is null or p_reserve_usd is null or p_reserve_usd < 0 then
    raise exception 'reserva inválida';
  end if;
  -- Serializa as reservas: estado, contagens, orçamento e duplicados sem corridas.
  perform pg_advisory_xact_lock(hashtext('bolt_ai_reserve'));
  select * into s from public.ai_settings where id = 1;
  -- A configuração central decide, mesmo que a função tenha lido um estado anterior.
  if not s.enabled or s.key_status <> 'valid' then
    return query select null::uuid, 'disabled'::text;
    return;
  end if;
  if p_model is distinct from s.model then
    return query select null::uuid, 'config_changed'::text;
    return;
  end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'editor')
  ) then
    return query select null::uuid, 'forbidden'::text;
    return;
  end if;
  if exists (select 1 from public.ai_usage where user_id = p_user_id and request_id = p_request_id) then
    return query select null::uuid, 'duplicate'::text;
    return;
  end if;
  v_ttl := make_interval(secs => s.reservation_ttl_seconds);

  select count(*) into v_count from public.ai_usage
    where user_id = p_user_id and created_at >= v_day and status <> 'released';
  if v_count >= s.requests_per_user_day then
    return query select null::uuid, 'user_day'::text;
    return;
  end if;
  select count(*) into v_count from public.ai_usage
    where workspace_id = p_workspace_id and created_at >= v_day and status <> 'released';
  if v_count >= s.requests_per_workspace_day then
    return query select null::uuid, 'workspace_day'::text;
    return;
  end if;
  select count(*) into v_count from public.ai_usage
    where user_id = p_user_id and status = 'reserved' and created_at > now() - v_ttl;
  if v_count >= s.max_concurrent_per_user then
    return query select null::uuid, 'user_concurrency'::text;
    return;
  end if;
  select count(*) into v_count from public.ai_usage
    where workspace_id = p_workspace_id and status = 'reserved' and created_at > now() - v_ttl;
  if v_count >= s.max_concurrent_per_workspace then
    return query select null::uuid, 'workspace_concurrency'::text;
    return;
  end if;
  select coalesce(sum(case when status = 'reserved' then reserved_usd else cost_usd end), 0) into v_spent
    from public.ai_usage where created_at >= v_month;
  if v_spent + p_reserve_usd > s.monthly_budget_usd then
    return query select null::uuid, 'budget'::text;
    return;
  end if;

  insert into public.ai_usage (request_id, user_id, workspace_id, project_id, reserved_usd, model, prices)
    values (p_request_id, p_user_id, p_workspace_id, p_project_id, p_reserve_usd, p_model, p_prices)
    returning id into v_id;
  return query select v_id, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administração (só papel de serviço; cada função confirma também o administrador)
-- ---------------------------------------------------------------------------

create or replace function public.ai__assert_admin(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin(p_actor) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.ai__view(s public.ai_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled, 'provider', s.provider, 'model', s.model,
    'requests_per_user_day', s.requests_per_user_day, 'requests_per_workspace_day', s.requests_per_workspace_day,
    'max_concurrent_per_user', s.max_concurrent_per_user, 'max_concurrent_per_workspace', s.max_concurrent_per_workspace,
    'max_output_tokens', s.max_output_tokens, 'max_retries', s.max_retries, 'max_operations', s.max_operations,
    'overhead_tokens', s.overhead_tokens, 'timeout_ms', s.timeout_ms, 'reservation_ttl_seconds', s.reservation_ttl_seconds,
    'monthly_budget_usd', s.monthly_budget_usd,
    'key', jsonb_build_object('configured', s.key_secret_id is not null, 'last4', s.key_last4, 'fingerprint', s.key_fingerprint,
                              'status', s.key_status, 'tested_at', s.key_tested_at, 'updated_at', s.key_updated_at),
    'version', s.version, 'updated_at', s.updated_at,
    'updated_by_email', (select u.email from auth.users u where u.id = s.updated_by)
  );
$$;

create or replace function public.ai_admin_get(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1;
  return jsonb_build_object(
    'settings', public.ai__view(s),
    'models', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'label', label,
                 'prices', jsonb_build_object('input', price_input, 'output', price_output, 'cacheRead', price_cache_read, 'cacheWrite', price_cache_write))
                 order by provider, price_input), '[]'::jsonb) from public.ai_models where supported)
  );
end;
$$;

-- Campos que o painel pode alterar (a chave tem funções próprias).
create or replace function public.ai_admin_update(p_actor uuid, p_expected_version integer, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.ai_settings;
  v_new public.ai_settings;
  v_allowed text[] := array['enabled', 'provider', 'model', 'requests_per_user_day', 'requests_per_workspace_day',
    'max_concurrent_per_user', 'max_concurrent_per_workspace', 'max_output_tokens', 'max_retries', 'max_operations',
    'overhead_tokens', 'timeout_ms', 'reservation_ttl_seconds', 'monthly_budget_usd'];
  v_key text;
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.ai__assert_admin(p_actor);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'invalid_field: %', v_key;
    end if;
  end loop;
  select * into v_old from public.ai_settings where id = 1 for update;
  if v_old.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  for v_key in select jsonb_object_keys(p_patch) loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('de', to_jsonb(v_old) -> v_key, 'para', to_jsonb(v_new) -> v_key));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then
    return public.ai_admin_get(p_actor);
  end if;
  update public.ai_settings set
    enabled = v_new.enabled, provider = v_new.provider, model = v_new.model,
    requests_per_user_day = v_new.requests_per_user_day, requests_per_workspace_day = v_new.requests_per_workspace_day,
    max_concurrent_per_user = v_new.max_concurrent_per_user, max_concurrent_per_workspace = v_new.max_concurrent_per_workspace,
    max_output_tokens = v_new.max_output_tokens, max_retries = v_new.max_retries, max_operations = v_new.max_operations,
    overhead_tokens = v_new.overhead_tokens, timeout_ms = v_new.timeout_ms, reservation_ttl_seconds = v_new.reservation_ttl_seconds,
    monthly_budget_usd = v_new.monthly_budget_usd,
    version = v_old.version + 1, updated_by = p_actor, updated_at = now()
  where id = 1;
  insert into public.ai_settings_audit (actor_id, action, changes) values (p_actor, 'update', v_changes);
  return public.ai_admin_get(p_actor);
end;
$$;

-- Chave nova fica PENDENTE (a ativa não é tocada até o teste passar).
create or replace function public.ai_admin_stage_key(p_actor uuid, p_key text, p_last4 text, p_fingerprint text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_pending uuid;
  v_id uuid;
begin
  perform public.ai__assert_admin(p_actor);
  if p_key is null or length(p_key) < 20 or length(p_key) > 300 or p_key ~ '\s' then
    raise exception 'invalid_key_format';
  end if;
  select pending_secret_id into v_old_pending from public.ai_settings where id = 1 for update;
  if v_old_pending is not null then
    delete from vault.secrets where id = v_old_pending;
  end if;
  v_id := vault.create_secret(p_key, 'bolt_ai_key_' || replace(gen_random_uuid()::text, '-', ''), 'Bolt IA: chave do fornecedor de IA');
  update public.ai_settings
    set pending_secret_id = v_id, pending_last4 = left(p_last4, 4), pending_fingerprint = left(p_fingerprint, 16)
    where id = 1;
  return v_id;
end;
$$;

-- Troca ativa ← pendente (só depois de um teste bem-sucedido) e apaga a anterior do cofre.
create or replace function public.ai_admin_activate_key(p_actor uuid, p_secret_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  if s.pending_secret_id is distinct from p_secret_id then
    raise exception 'pending_mismatch';
  end if;
  update public.ai_settings
    set key_secret_id = s.pending_secret_id, key_last4 = s.pending_last4, key_fingerprint = s.pending_fingerprint,
        key_status = 'valid', key_tested_at = now(), key_updated_at = now(),
        pending_secret_id = null, pending_last4 = null, pending_fingerprint = null,
        version = s.version + 1, updated_by = p_actor, updated_at = now()
    where id = 1;
  if s.key_secret_id is not null then
    delete from vault.secrets where id = s.key_secret_id;
  end if;
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, case when s.key_secret_id is null then 'key_set' else 'key_replaced' end,
            jsonb_build_object('chave', jsonb_build_object('de', case when s.key_last4 is null then null else '…' || s.key_last4 end, 'para', '…' || s.pending_last4)));
  return public.ai_admin_get(p_actor);
end;
$$;

-- Chave nova recusada: descarta a pendente; a ativa mantém-se.
create or replace function public.ai_admin_discard_key(p_actor uuid, p_secret_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  if s.pending_secret_id is distinct from p_secret_id then
    return;
  end if;
  delete from vault.secrets where id = p_secret_id;
  update public.ai_settings set pending_secret_id = null, pending_last4 = null, pending_fingerprint = null where id = 1;
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_rejected', jsonb_build_object('chave', '…' || s.pending_last4, 'motivo', left(p_reason, 200)));
end;
$$;

create or replace function public.ai_admin_remove_key(p_actor uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  if s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  update public.ai_settings
    set enabled = false, key_secret_id = null, key_last4 = null, key_fingerprint = null, key_status = 'none',
        key_tested_at = null, key_updated_at = now(), version = s.version + 1, updated_by = p_actor, updated_at = now()
    where id = 1;
  if s.key_secret_id is not null then
    delete from vault.secrets where id = s.key_secret_id;
  end if;
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_removed', jsonb_build_object('chave', case when s.key_last4 is null then null else '…' || s.key_last4 end, 'assistente', 'desativado'));
  return public.ai_admin_get(p_actor);
end;
$$;

-- Resultado de um teste da chave ATIVA. Só resultados definitivos mudam o estado; uma chave
-- recusada desativa o assistente (a configuração válida nunca fica a apontar para uma chave má).
create or replace function public.ai_admin_record_test(p_actor uuid, p_ok boolean, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  if s.key_secret_id is null then
    raise exception 'no_key';
  end if;
  update public.ai_settings
    set key_status = case when p_ok then 'valid' else 'invalid' end,
        enabled = case when p_ok then s.enabled else false end,
        key_tested_at = now(), version = s.version + 1, updated_at = now()
    where id = 1;
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_tested', jsonb_build_object('chave', '…' || s.key_last4, 'resultado', case when p_ok then 'aceite' else 'recusada' end,
                                                      'detalhe', left(p_detail, 200), 'assistente', case when not p_ok and s.enabled then 'desativado' else null end));
  return public.ai_admin_get(p_actor);
end;
$$;

-- Consumo do mês: confirmado, desconhecido (contado pelo máximo) e reservado, em separado.
create or replace function public.ai_admin_usage(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month timestamptz := date_trunc('month', now());
  v jsonb;
begin
  perform public.ai__assert_admin(p_actor);
  select jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'requests', count(*) filter (where status <> 'released'),
    'confirmed_usd', coalesce(sum(confirmed_cost_usd) filter (where status in ('done', 'failed')), 0),
    'unknown_usd', coalesce(sum(unknown_cost_usd) filter (where status in ('done', 'failed', 'expired')), 0),
    'reserved_usd', coalesce(sum(reserved_usd) filter (where status = 'reserved'), 0),
    'in_flight', count(*) filter (where status = 'reserved'),
    'unknown_attempts', coalesce(sum(unknown_attempts), 0),
    'budget_usd', (select monthly_budget_usd from public.ai_settings where id = 1)
  ) into v
  from public.ai_usage where created_at >= v_month;
  return v;
end;
$$;

create or replace function public.ai_admin_audit(p_actor uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.ai__assert_admin(p_actor);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'changes', a.changes, 'actor_email', u.email) order by a.id desc), '[]'::jsonb)
    from (select * from public.ai_settings_audit order by id desc limit least(greatest(p_limit, 1), 200)) a
    left join auth.users u on u.id = a.actor_id
  );
end;
$$;

-- Administradores seguintes (nunca por autoatribuição; nunca remover o último).
create or replace function public.ai_admin_grant(p_actor uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai__assert_admin(p_actor);
  insert into public.platform_admins (user_id, granted_by, note) values (p_user_id, p_actor, 'atribuído pelo painel')
    on conflict (user_id) do nothing;
  insert into public.ai_settings_audit (actor_id, action, changes) values (p_actor, 'admin_granted', jsonb_build_object('utilizador', p_user_id));
end;
$$;

create or replace function public.ai_admin_revoke(p_actor uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai__assert_admin(p_actor);
  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'last_admin';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
  insert into public.ai_settings_audit (actor_id, action, changes) values (p_actor, 'admin_revoked', jsonb_build_object('utilizador', p_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------

revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;
revoke all on function public.ai__assert_admin(uuid) from public, anon, authenticated;
revoke all on function public.ai__view(public.ai_settings) from public, anon, authenticated;
revoke all on function public.ai_runtime_settings() from public, anon, authenticated;
revoke all on function public.ai_provider_key() from public, anon, authenticated;
revoke all on function public.ai_reserve(uuid, uuid, uuid, uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.ai_admin_get(uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_update(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ai_admin_stage_key(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_admin_activate_key(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_discard_key(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ai_admin_remove_key(uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_admin_record_test(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.ai_admin_usage(uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_audit(uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_admin_grant(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_revoke(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ai_whoami() from public, anon;
revoke all on function public.ai_status() from public, anon;

grant execute on function public.ai_whoami() to authenticated;
grant execute on function public.ai_status() to authenticated;
grant execute on function
  public.is_platform_admin(uuid), public.ai_runtime_settings(), public.ai_provider_key(),
  public.ai_reserve(uuid, uuid, uuid, uuid, numeric, text, jsonb),
  public.ai_admin_get(uuid), public.ai_admin_update(uuid, integer, jsonb), public.ai_admin_stage_key(uuid, text, text, text),
  public.ai_admin_activate_key(uuid, uuid), public.ai_admin_discard_key(uuid, uuid, text), public.ai_admin_remove_key(uuid, integer),
  public.ai_admin_record_test(uuid, boolean, text), public.ai_admin_usage(uuid), public.ai_admin_audit(uuid, integer),
  public.ai_admin_grant(uuid, uuid), public.ai_admin_revoke(uuid, uuid)
  to service_role;
