-- Bolt IA · Assistente IA: registo de consumo.
-- PARA REVISÃO: ainda não aplicada ao projeto Supabase.
--
-- Uma linha por pedido ao assistente. A reserva (`ai_reserve`) está na migração seguinte
-- (20260930120000_configuracoes_ia.sql), porque lê os limites da configuração central.
-- Todas as escritas são feitas pela função `ai-propose` com o cliente de serviço:
--   ai_reserve  → cria a linha com o custo MÁXIMO reservado e o instantâneo de modelo e preços;
--   ai_settle   → acerta: custo confirmado (tokens indicados pelo fornecedor) e custo desconhecido
--                 (tentativas sem dados de consumo, contadas pelo máximo), em separado;
--   ai_release  → só quando nenhuma tentativa foi enviada ao fornecedor;
--   ai_expire_stale → reservas sem acerto (função interrompida) fecham pelo valor RESERVADO.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed', 'released', 'expired')),
  reserved_usd numeric(12, 6) not null check (reserved_usd >= 0),
  -- Custo total acertado = confirmado + desconhecido (ou o reservado, se expirou).
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  confirmed_cost_usd numeric(12, 6) not null default 0 check (confirmed_cost_usd >= 0),
  unknown_cost_usd numeric(12, 6) not null default 0 check (unknown_cost_usd >= 0),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  attempts integer not null default 0,
  unknown_attempts integer not null default 0,
  latency_ms integer,
  -- Instantâneo do modelo e dos preços usados na reserva (o acerto usa os mesmos).
  model text,
  prices jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Um pedido (gerado pelo editor) só é aceite uma vez por utilizador.
  unique (user_id, request_id)
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_workspace_created_idx on public.ai_usage (workspace_id, created_at desc);
create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;

-- Cada utilizador vê só o seu próprio consumo. Ninguém escreve diretamente.
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- ---------------------------------------------------------------------------
-- Acerto, libertação e reservas sem acerto
-- ---------------------------------------------------------------------------

create or replace function public.ai_settle(
  p_id uuid,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer,
  p_cache_write_tokens integer,
  p_confirmed_cost_usd numeric,
  p_unknown_cost_usd numeric,
  p_attempts integer,
  p_unknown_attempts integer,
  p_latency_ms integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('done', 'failed') then
    raise exception 'estado inválido';
  end if;
  update public.ai_usage
    set status = p_status,
        input_tokens = greatest(p_input_tokens, 0),
        output_tokens = greatest(p_output_tokens, 0),
        cache_read_tokens = greatest(p_cache_read_tokens, 0),
        cache_write_tokens = greatest(p_cache_write_tokens, 0),
        confirmed_cost_usd = greatest(p_confirmed_cost_usd, 0),
        unknown_cost_usd = greatest(p_unknown_cost_usd, 0),
        cost_usd = greatest(p_confirmed_cost_usd, 0) + greatest(p_unknown_cost_usd, 0),
        attempts = greatest(p_attempts, 0),
        unknown_attempts = greatest(p_unknown_attempts, 0),
        latency_ms = p_latency_ms,
        error = left(p_error, 500),
        finished_at = now()
    where id = p_id and status = 'reserved';
end;
$$;

-- Só para reservas em que nenhuma tentativa chegou ao fornecedor (custo zero conhecido).
create or replace function public.ai_release(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage set status = 'released', cost_usd = 0, finished_at = now()
    where id = p_id and status = 'reserved' and attempts = 0;
$$;

-- Reservas sem acerto (função interrompida depois de enviar): fecham-se pelo valor RESERVADO,
-- contado como consumo desconhecido, nunca por zero. Devolve quantas fechou.
create or replace function public.ai_expire_stale(p_older_than_seconds integer default 900)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ai_usage
    set status = 'expired',
        cost_usd = reserved_usd,
        unknown_cost_usd = reserved_usd,
        error = coalesce(error, 'reserva sem acerto: contada pelo máximo reservado'),
        finished_at = now()
    where status = 'reserved' and created_at < now() - make_interval(secs => greatest(p_older_than_seconds, 60));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.ai_settle(uuid, text, integer, integer, integer, integer, numeric, numeric, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.ai_release(uuid) from public, anon, authenticated;
revoke all on function public.ai_expire_stale(integer) from public, anon, authenticated;
grant execute on function public.ai_settle(uuid, text, integer, integer, integer, integer, numeric, numeric, integer, integer, integer, text) to service_role;
grant execute on function public.ai_release(uuid) to service_role;
grant execute on function public.ai_expire_stale(integer) to service_role;
