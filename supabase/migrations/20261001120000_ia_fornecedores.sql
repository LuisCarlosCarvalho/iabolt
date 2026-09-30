-- Bolt IA · Vários fornecedores de IA (Anthropic, OpenAI, Google Gemini) e geração de imagens.
-- NÃO aplicada ao projeto Supabase (aplicar só com autorização). Depende de 20260929120000 e 20260930120000
-- (já aplicadas; NÃO são reescritas).
--
-- O que muda:
--  1. Cada fornecedor tem a SUA chave (tabela ai_provider_keys), cifrada no Supabase Vault, com o
--     seu estado. Trocar de fornecedor não apaga as outras chaves.
--     A chave Anthropic já configurada é PRESERVADA: o mesmo segredo do cofre passa para
--     ai_provider_keys (nada é decifrado nem recriado).
--  2. Modelos por fornecedor e por capacidade (edição / imagem); preço por imagem.
--  3. Configuração central: modelo de edição e, em separado, fornecedor/modelo de imagens.
--  4. ai_usage regista o fornecedor e o tipo (edição / imagem); a reserva confirma o fornecedor.
--
-- Transição COMPATÍVEL (sem janela de quebra):
--  - As funções SQL usadas pelas funções ai-propose/ai-admin JÁ PUBLICADAS mantêm os nomes, as
--    assinaturas e o formato das respostas (v1), agora lidas do armazenamento por fornecedor.
--  - As versões novas têm nomes próprios (_v2, ai_reserve com fornecedor e tipo, ai_provider_key_for).
--  - Nada é apagado: as colunas da chave única em ai_settings ficam CONGELADAS (deixam de ser usadas,
--    mantêm o valor de hoje) e nenhum segredo do cofre é removido pela migração.

-- ---------------------------------------------------------------------------
-- 1. Modelos
-- ---------------------------------------------------------------------------

alter table public.ai_models drop constraint ai_models_provider_check;
alter table public.ai_models add constraint ai_models_provider_check check (provider in ('anthropic', 'openai', 'google'));
alter table public.ai_models add column capability text not null default 'edit' check (capability in ('edit', 'image'));
-- Teto de custo por imagem (USD), usado na reserva e na estimativa mostrada antes de gerar.
alter table public.ai_models add column price_image numeric(10, 4) check (price_image is null or price_image >= 0);
alter table public.ai_models add column note text;
-- Um modelo de imagem só é suportado com um preço por imagem conhecido (a reserva precisa dele).
alter table public.ai_models add constraint ai_models_image_price check (capability <> 'image' or not supported or price_image is not null);

-- Preços públicos (USD por milhão de tokens; por imagem quando indicado), consultados a
-- 30/09/2026 nas páginas oficiais de preços. Onde há preços com data de mudança, usa-se o MAIS ALTO
-- (a reserva nunca fica abaixo do custo real).
insert into public.ai_models (provider, model, label, price_input, price_output, price_cache_read, price_cache_write, capability, price_image, supported, note) values
  ('openai', 'gpt-6.1-sol', 'GPT-6.1 Sol', 2, 10, 0.1, 2, 'edit', null, true,
   'Preços de contexto curto; pedidos do assistente ficam muito abaixo do limite de contexto longo.'),
  ('openai', 'gpt-6-luna', 'GPT-6 Luna', 0.1, 0.5, 0.01, 0.1, 'edit', null, true, null),
  ('openai', 'gpt-6-astra', 'GPT-6 Astra', 10, 50, 1, 10, 'edit', null, true, null),
  ('google', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 1.5, 7.5, 0.15, 1.5, 'edit', null, true,
   'Preço a partir de 01/01/2027 (até lá 0,75/3,75): a reserva usa o mais alto.'),
  ('google', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite', 0.3, 2.5, 0.03, 0.3, 'edit', null, true, null),
  ('google', 'gemini-3.1-flash-image', 'Gemini 3.1 Flash Image', 0.5, 3, 0, 0.5, 'image', 0.067, true, 'Imagem 1K: 0,067 USD.'),
  ('google', 'gemini-3-pro-image', 'Gemini 3 Pro Image', 2, 12, 0, 2, 'image', 0.134, true, 'Imagem 1K/2K: 0,134 USD.'),
  -- Adaptador implementado, mas a documentação consultada só publica preços por token (saída de
  -- imagem 30 USD/milhão) sem o número de tokens por imagem: sem teto seguro, fica NÃO suportado.
  ('openai', 'gpt-image-2.5-flare', 'GPT-Image-2.5 Flare', 5, 30, 1.25, 5, 'image', null, false,
   'Sem preço por imagem publicado: confirmar na calculadora oficial e definir price_image antes de ativar.');

-- ---------------------------------------------------------------------------
-- 2. Chaves por fornecedor (preserva a chave Anthropic existente)
-- ---------------------------------------------------------------------------

create table public.ai_provider_keys (
  provider text primary key check (provider in ('anthropic', 'openai', 'google')),
  key_secret_id uuid,
  key_last4 text,
  key_fingerprint text,
  key_status text not null default 'none' check (key_status in ('none', 'valid', 'invalid')),
  key_tested_at timestamptz,
  key_updated_at timestamptz,
  pending_secret_id uuid,
  pending_last4 text,
  pending_fingerprint text,
  check ((key_secret_id is null) = (key_status = 'none'))
);
insert into public.ai_provider_keys (provider) values ('anthropic'), ('openai'), ('google');

update public.ai_provider_keys k
  set key_secret_id = s.key_secret_id, key_last4 = s.key_last4, key_fingerprint = s.key_fingerprint,
      key_status = s.key_status, key_tested_at = s.key_tested_at, key_updated_at = s.key_updated_at,
      pending_secret_id = s.pending_secret_id, pending_last4 = s.pending_last4, pending_fingerprint = s.pending_fingerprint
  from public.ai_settings s
  where s.id = 1 and k.provider = s.provider;

alter table public.ai_provider_keys enable row level security;
revoke all on public.ai_provider_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Configuração central
-- ---------------------------------------------------------------------------

alter table public.ai_settings
  add column image_enabled boolean not null default false,
  add column image_provider text,
  add column image_model text,
  add column image_requests_per_user_day integer not null default 10 check (image_requests_per_user_day between 1 and 200),
  -- Pedidos grandes (página, site inteiro) são divididos em partes; cada parte é um pedido.
  add column max_parts integer not null default 6 check (max_parts between 1 and 20),
  add foreign key (image_provider, image_model) references public.ai_models (provider, model);

-- Limites mais largos para propostas de secção, página e site (o valor configurado mantém-se).
alter table public.ai_settings drop constraint ai_settings_max_operations_check;
alter table public.ai_settings add constraint ai_settings_max_operations_check check (max_operations between 1 and 200);
alter table public.ai_settings drop constraint ai_settings_max_output_tokens_check;
alter table public.ai_settings add constraint ai_settings_max_output_tokens_check check (max_output_tokens between 100 and 16000);

-- As colunas da chave única deixam de ser usadas (a fonte passa a ser ai_provider_keys, já
-- copiada acima), mas NÃO são apagadas: ficam congeladas com o valor de hoje, como referência para
-- uma eventual reversão. A regra «não se ativa sem chave válida» deixa de ler estas colunas
-- (restrição ai_settings_check1) e passa para o gatilho abaixo, que lê a chave do fornecedor em uso.
alter table public.ai_settings drop constraint ai_settings_check1;
comment on column public.ai_settings.key_secret_id is 'Congelada desde 20261001120000: a chave vive em ai_provider_keys.';
comment on column public.ai_settings.key_status is 'Congelada desde 20261001120000: o estado vive em ai_provider_keys.';

create or replace function public.ai__check_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cap text;
  v_status text;
begin
  select capability into v_cap from public.ai_models where provider = new.provider and model = new.model and supported;
  if v_cap is distinct from 'edit' then
    raise exception 'ai_settings_check: modelo de edição não suportado';
  end if;
  if new.image_model is not null then
    select capability into v_cap from public.ai_models where provider = new.image_provider and model = new.image_model and supported;
    if v_cap is distinct from 'image' then
      raise exception 'ai_settings_check: modelo de imagem não suportado';
    end if;
  end if;
  if new.enabled then
    select key_status into v_status from public.ai_provider_keys where provider = new.provider;
    if v_status is distinct from 'valid' then
      raise exception 'ai_settings_check: o assistente só é ativado com a chave do fornecedor de edição reconhecida';
    end if;
  end if;
  if new.image_enabled then
    if new.image_model is null then
      raise exception 'ai_settings_check: escolha o modelo de imagem';
    end if;
    select key_status into v_status from public.ai_provider_keys where provider = new.image_provider;
    if v_status is distinct from 'valid' then
      raise exception 'ai_settings_check: a geração de imagens só é ativada com a chave desse fornecedor reconhecida';
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_settings_rules before insert or update on public.ai_settings
  for each row execute function public.ai__check_settings();

-- ---------------------------------------------------------------------------
-- 4. Consumo: fornecedor e tipo
-- ---------------------------------------------------------------------------

alter table public.ai_usage
  add column provider text,
  add column kind text not null default 'edit' check (kind in ('edit', 'image'));
update public.ai_usage set provider = 'anthropic' where provider is null;

-- ---------------------------------------------------------------------------
-- 5. Leitura (sem segredos) e chaves
-- ---------------------------------------------------------------------------

-- v1 (mesmas colunas de antes; usada pelo frontend em produção): lê a chave do fornecedor em uso.
create or replace function public.ai_status()
returns table (enabled boolean, provider text, model text, model_label text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled and ke.key_status = 'valid', s.provider, s.model, m.label
  from public.ai_settings s
  join public.ai_models m on m.provider = s.provider and m.model = s.model
  join public.ai_provider_keys ke on ke.provider = s.provider
  where s.id = 1;
$$;

-- v2: com imagens e o que o editor precisa para estimar o custo máximo antes de enviar.
create function public.ai_status_v2()
returns table (
  enabled boolean, provider text, model text, model_label text,
  image_enabled boolean, image_provider text, image_model text, image_label text, image_price_usd numeric,
  prices jsonb, max_output_tokens integer, overhead_tokens integer, max_retries integer, max_parts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled and ke.key_status = 'valid', s.provider, s.model, m.label,
         s.image_enabled and ki.key_status = 'valid', s.image_provider, s.image_model, mi.label, mi.price_image,
         jsonb_build_object('input', m.price_input, 'output', m.price_output, 'cacheRead', m.price_cache_read, 'cacheWrite', m.price_cache_write),
         s.max_output_tokens, s.overhead_tokens, s.max_retries, s.max_parts
  from public.ai_settings s
  join public.ai_models m on m.provider = s.provider and m.model = s.model
  join public.ai_provider_keys ke on ke.provider = s.provider
  left join public.ai_models mi on mi.provider = s.image_provider and mi.model = s.image_model
  left join public.ai_provider_keys ki on ki.provider = s.image_provider
  where s.id = 1;
$$;

-- Configuração em vigor + preços (para as funções; sem segredos). key_status = o do fornecedor de edição.
create or replace function public.ai_runtime_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(s) - 'key_secret_id' - 'key_last4' - 'key_fingerprint' - 'key_tested_at' - 'key_updated_at'
                     - 'pending_secret_id' - 'pending_last4' - 'pending_fingerprint')
         || jsonb_build_object(
              'prices', jsonb_build_object('input', m.price_input, 'output', m.price_output, 'cacheRead', m.price_cache_read, 'cacheWrite', m.price_cache_write),
              'model_label', m.label,
              'key_status', ke.key_status,
              'image_key_status', coalesce(ki.key_status, 'none'),
              'image_label', mi.label,
              'image_prices', case when mi.model is null then null else jsonb_build_object('input', mi.price_input, 'output', mi.price_output, 'image', mi.price_image) end)
  from public.ai_settings s
  join public.ai_models m on m.provider = s.provider and m.model = s.model
  join public.ai_provider_keys ke on ke.provider = s.provider
  left join public.ai_models mi on mi.provider = s.image_provider and mi.model = s.image_model
  left join public.ai_provider_keys ki on ki.provider = s.image_provider
  where s.id = 1;
$$;

-- Chave decifrada de um fornecedor. SÓ o papel de serviço.
create or replace function public.ai_provider_key_for(p_provider text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret from vault.decrypted_secrets d
  where d.id = (select key_secret_id from public.ai_provider_keys where provider = p_provider);
$$;

-- Compatibilidade: a chave do fornecedor de edição (funções publicadas antes desta migração).
create or replace function public.ai_provider_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.ai_provider_key_for((select provider from public.ai_settings where id = 1));
$$;

-- ---------------------------------------------------------------------------
-- 6. Reserva atómica por fornecedor e tipo
-- ---------------------------------------------------------------------------

create or replace function public.ai_reserve(
  p_request_id uuid,
  p_user_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_reserve_usd numeric,
  p_provider text,
  p_model text,
  p_prices jsonb,
  p_kind text
)
returns table (reservation_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  v_status text;
  v_ttl interval;
  v_day timestamptz := date_trunc('day', now());
  v_month timestamptz := date_trunc('month', now());
  v_count integer;
  v_spent numeric;
  v_id uuid;
begin
  if p_request_id is null or p_reserve_usd is null or p_reserve_usd < 0 or p_kind not in ('edit', 'image') then
    raise exception 'reserva inválida';
  end if;
  perform pg_advisory_xact_lock(hashtext('bolt_ai_reserve'));
  select * into s from public.ai_settings where id = 1;
  if p_kind = 'edit' then
    select key_status into v_status from public.ai_provider_keys where provider = s.provider;
    if not s.enabled or v_status is distinct from 'valid' then
      return query select null::uuid, 'disabled'::text;
      return;
    end if;
    if p_provider is distinct from s.provider or p_model is distinct from s.model then
      return query select null::uuid, 'config_changed'::text;
      return;
    end if;
  else
    select key_status into v_status from public.ai_provider_keys where provider = s.image_provider;
    if not s.image_enabled or v_status is distinct from 'valid' then
      return query select null::uuid, 'disabled'::text;
      return;
    end if;
    if p_provider is distinct from s.image_provider or p_model is distinct from s.image_model then
      return query select null::uuid, 'config_changed'::text;
      return;
    end if;
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
  if p_kind = 'image' then
    select count(*) into v_count from public.ai_usage
      where user_id = p_user_id and kind = 'image' and created_at >= v_day and status <> 'released';
    if v_count >= s.image_requests_per_user_day then
      return query select null::uuid, 'user_day'::text;
      return;
    end if;
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

  insert into public.ai_usage (request_id, user_id, workspace_id, project_id, reserved_usd, provider, model, prices, kind)
    values (p_request_id, p_user_id, p_workspace_id, p_project_id, p_reserve_usd, p_provider, p_model, p_prices, p_kind)
    returning id into v_id;
  return query select v_id, null::text;
end;
$$;

-- Compatibilidade: a assinatura antiga reserva uma edição no fornecedor de edição em vigor.
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
language sql
security definer
set search_path = ''
as $$
  select * from public.ai_reserve(p_request_id, p_user_id, p_workspace_id, p_project_id, p_reserve_usd,
    (select provider from public.ai_settings where id = 1), p_model, p_prices, 'edit');
$$;

-- ---------------------------------------------------------------------------
-- 7. Administração
-- ---------------------------------------------------------------------------
-- Duas versões lado a lado, para uma transição sem quebra:
--  - v1 (nomes e assinaturas ANTERIORES, respostas no formato anterior): usadas pela função ai-admin
--    já publicada e pelo painel em produção. Operam sobre a chave Anthropic (o único fornecedor que
--    o painel v1 conhece) e mostram só os modelos Anthropic de edição.
--  - v2 (sufixo _v2): usadas pela função ai-admin nova (pedidos com api = 2), com fornecedor.
-- Toda a lógica vive em funções internas (ai__*) partilhadas pelas duas versões.

create or replace function public.ai__key_view(k public.ai_provider_keys)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('configured', k.key_secret_id is not null, 'last4', k.key_last4, 'fingerprint', k.key_fingerprint,
                            'status', k.key_status, 'tested_at', k.key_tested_at, 'updated_at', k.key_updated_at);
$$;

-- v1: mesmo formato de antes; «key» é a chave Anthropic.
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
    'key', (select public.ai__key_view(k) from public.ai_provider_keys k where k.provider = 'anthropic'),
    'version', s.version, 'updated_at', s.updated_at,
    'updated_by_email', (select u.email from auth.users u where u.id = s.updated_by)
  );
$$;

create or replace function public.ai__view_v2(s public.ai_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled, 'provider', s.provider, 'model', s.model,
    'image_enabled', s.image_enabled, 'image_provider', s.image_provider, 'image_model', s.image_model,
    'image_requests_per_user_day', s.image_requests_per_user_day, 'max_parts', s.max_parts,
    'requests_per_user_day', s.requests_per_user_day, 'requests_per_workspace_day', s.requests_per_workspace_day,
    'max_concurrent_per_user', s.max_concurrent_per_user, 'max_concurrent_per_workspace', s.max_concurrent_per_workspace,
    'max_output_tokens', s.max_output_tokens, 'max_retries', s.max_retries, 'max_operations', s.max_operations,
    'overhead_tokens', s.overhead_tokens, 'timeout_ms', s.timeout_ms, 'reservation_ttl_seconds', s.reservation_ttl_seconds,
    'monthly_budget_usd', s.monthly_budget_usd,
    'keys', (select jsonb_object_agg(k.provider, public.ai__key_view(k)) from public.ai_provider_keys k),
    'version', s.version, 'updated_at', s.updated_at,
    'updated_by_email', (select u.email from auth.users u where u.id = s.updated_by)
  );
$$;

-- v1: modelos Anthropic de edição (o painel v1 só conhece este fornecedor).
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
                 order by provider, price_input), '[]'::jsonb)
               from public.ai_models where supported and provider = 'anthropic' and capability = 'edit')
  );
end;
$$;

create or replace function public.ai_admin_get_v2(p_actor uuid)
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
    'settings', public.ai__view_v2(s),
    'models', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'label', label, 'capability', capability,
                 'price_image', price_image, 'note', note,
                 'prices', jsonb_build_object('input', price_input, 'output', price_output, 'cacheRead', price_cache_read, 'cacheWrite', price_cache_write))
                 order by provider, capability, price_input), '[]'::jsonb) from public.ai_models where supported)
  );
end;
$$;

-- Atualização comum: só os campos permitidos pela versão que chama.
create or replace function public.ai__update(p_actor uuid, p_expected_version integer, p_patch jsonb, p_allowed text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.ai_settings;
  v_new public.ai_settings;
  v_key text;
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.ai__assert_admin(p_actor);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (p_allowed)) then
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
    return;
  end if;
  update public.ai_settings set
    enabled = v_new.enabled, provider = v_new.provider, model = v_new.model,
    image_enabled = v_new.image_enabled, image_provider = v_new.image_provider, image_model = v_new.image_model,
    image_requests_per_user_day = v_new.image_requests_per_user_day, max_parts = v_new.max_parts,
    requests_per_user_day = v_new.requests_per_user_day, requests_per_workspace_day = v_new.requests_per_workspace_day,
    max_concurrent_per_user = v_new.max_concurrent_per_user, max_concurrent_per_workspace = v_new.max_concurrent_per_workspace,
    max_output_tokens = v_new.max_output_tokens, max_retries = v_new.max_retries, max_operations = v_new.max_operations,
    overhead_tokens = v_new.overhead_tokens, timeout_ms = v_new.timeout_ms, reservation_ttl_seconds = v_new.reservation_ttl_seconds,
    monthly_budget_usd = v_new.monthly_budget_usd,
    version = v_old.version + 1, updated_by = p_actor, updated_at = now()
  where id = 1;
  insert into public.ai_settings_audit (actor_id, action, changes) values (p_actor, 'update', v_changes);
end;
$$;

-- v1: os mesmos campos de antes (sem imagens nem partes).
create or replace function public.ai_admin_update(p_actor uuid, p_expected_version integer, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai__update(p_actor, p_expected_version, p_patch, array['enabled', 'provider', 'model', 'requests_per_user_day', 'requests_per_workspace_day',
    'max_concurrent_per_user', 'max_concurrent_per_workspace', 'max_output_tokens', 'max_retries', 'max_operations',
    'overhead_tokens', 'timeout_ms', 'reservation_ttl_seconds', 'monthly_budget_usd']);
  return public.ai_admin_get(p_actor);
end;
$$;

create or replace function public.ai_admin_update_v2(p_actor uuid, p_expected_version integer, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai__update(p_actor, p_expected_version, p_patch, array['enabled', 'provider', 'model', 'image_enabled', 'image_provider', 'image_model',
    'image_requests_per_user_day', 'max_parts', 'requests_per_user_day', 'requests_per_workspace_day',
    'max_concurrent_per_user', 'max_concurrent_per_workspace', 'max_output_tokens', 'max_retries', 'max_operations',
    'overhead_tokens', 'timeout_ms', 'reservation_ttl_seconds', 'monthly_budget_usd']);
  return public.ai_admin_get_v2(p_actor);
end;
$$;

create or replace function public.ai__bump(p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_settings set version = version + 1, updated_by = p_actor, updated_at = now() where id = 1;
$$;

-- Chave nova de um fornecedor fica PENDENTE (a ativa desse fornecedor não é tocada até o teste passar).
create or replace function public.ai__stage_key(p_actor uuid, p_provider text, p_key text, p_last4 text, p_fingerprint text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.ai_provider_keys;
  v_id uuid;
begin
  perform public.ai__assert_admin(p_actor);
  if p_key is null or length(p_key) < 20 or length(p_key) > 300 or p_key ~ '\s' then
    raise exception 'invalid_key_format';
  end if;
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found then
    raise exception 'invalid_provider';
  end if;
  if k.pending_secret_id is not null then
    delete from vault.secrets where id = k.pending_secret_id;
  end if;
  v_id := vault.create_secret(p_key, 'bolt_ai_key_' || p_provider || '_' || replace(gen_random_uuid()::text, '-', ''), 'Bolt IA: chave do fornecedor ' || p_provider);
  update public.ai_provider_keys
    set pending_secret_id = v_id, pending_last4 = left(p_last4, 4), pending_fingerprint = left(p_fingerprint, 16)
    where provider = p_provider;
  return v_id;
end;
$$;

create or replace function public.ai__activate_key(p_actor uuid, p_provider text, p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.ai_provider_keys;
begin
  perform public.ai__assert_admin(p_actor);
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found or k.pending_secret_id is distinct from p_secret_id then
    raise exception 'pending_mismatch';
  end if;
  update public.ai_provider_keys
    set key_secret_id = k.pending_secret_id, key_last4 = k.pending_last4, key_fingerprint = k.pending_fingerprint,
        key_status = 'valid', key_tested_at = now(), key_updated_at = now(),
        pending_secret_id = null, pending_last4 = null, pending_fingerprint = null
    where provider = p_provider;
  -- A chave substituída sai do cofre (como antes). A congelada em ai_settings.key_secret_id, se
  -- for a mesma, fica só como referência histórica sem segredo.
  if k.key_secret_id is not null then
    delete from vault.secrets where id = k.key_secret_id;
  end if;
  perform public.ai__bump(p_actor);
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, case when k.key_secret_id is null then 'key_set' else 'key_replaced' end,
            jsonb_build_object('fornecedor', p_provider,
                               'chave', jsonb_build_object('de', case when k.key_last4 is null then null else '…' || k.key_last4 end, 'para', '…' || k.pending_last4)));
end;
$$;

create or replace function public.ai__discard_key(p_actor uuid, p_provider text, p_secret_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.ai_provider_keys;
begin
  perform public.ai__assert_admin(p_actor);
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found or k.pending_secret_id is distinct from p_secret_id then
    return;
  end if;
  delete from vault.secrets where id = p_secret_id;
  update public.ai_provider_keys set pending_secret_id = null, pending_last4 = null, pending_fingerprint = null where provider = p_provider;
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_rejected', jsonb_build_object('fornecedor', p_provider, 'chave', '…' || k.pending_last4, 'motivo', left(p_reason, 200)));
end;
$$;

-- Remove a chave de UM fornecedor (pedido explícito do administrador). O que a usava fica desativado.
create or replace function public.ai__remove_key(p_actor uuid, p_provider text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  k public.ai_provider_keys;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  if s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found then
    raise exception 'invalid_provider';
  end if;
  update public.ai_settings
    set enabled = case when s.provider = p_provider then false else s.enabled end,
        image_enabled = case when s.image_provider = p_provider then false else s.image_enabled end
    where id = 1;
  update public.ai_provider_keys
    set key_secret_id = null, key_last4 = null, key_fingerprint = null, key_status = 'none', key_tested_at = null, key_updated_at = now()
    where provider = p_provider;
  if k.key_secret_id is not null then
    delete from vault.secrets where id = k.key_secret_id;
  end if;
  perform public.ai__bump(p_actor);
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_removed', jsonb_build_object('fornecedor', p_provider, 'chave', case when k.key_last4 is null then null else '…' || k.key_last4 end,
            'assistente', case when s.provider = p_provider and s.enabled then 'desativado' else null end,
            'imagens', case when s.image_provider = p_provider and s.image_enabled then 'desativadas' else null end));
end;
$$;

-- Resultado de um teste da chave ATIVA de um fornecedor. Uma chave recusada desativa o que a usa.
create or replace function public.ai__record_test(p_actor uuid, p_provider text, p_ok boolean, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  k public.ai_provider_keys;
begin
  perform public.ai__assert_admin(p_actor);
  select * into s from public.ai_settings where id = 1 for update;
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found or k.key_secret_id is null then
    raise exception 'no_key';
  end if;
  if not p_ok then
    update public.ai_settings
      set enabled = case when s.provider = p_provider then false else s.enabled end,
          image_enabled = case when s.image_provider = p_provider then false else s.image_enabled end
      where id = 1;
  end if;
  update public.ai_provider_keys
    set key_status = case when p_ok then 'valid' else 'invalid' end, key_tested_at = now()
    where provider = p_provider;
  perform public.ai__bump(p_actor);
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, 'key_tested', jsonb_build_object('fornecedor', p_provider, 'chave', '…' || k.key_last4,
            'resultado', case when p_ok then 'aceite' else 'recusada' end, 'detalhe', left(p_detail, 200),
            'assistente', case when not p_ok and s.enabled and s.provider = p_provider then 'desativado' else null end,
            'imagens', case when not p_ok and s.image_enabled and s.image_provider = p_provider then 'desativadas' else null end));
end;
$$;

-- v1: mesmas assinaturas e respostas de antes, sobre a chave Anthropic.
create or replace function public.ai_admin_stage_key(p_actor uuid, p_key text, p_last4 text, p_fingerprint text)
returns uuid language sql security definer set search_path = ''
as $$ select public.ai__stage_key(p_actor, 'anthropic', p_key, p_last4, p_fingerprint); $$;

create or replace function public.ai_admin_activate_key(p_actor uuid, p_secret_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__activate_key(p_actor, 'anthropic', p_secret_id); return public.ai_admin_get(p_actor); end; $$;

create or replace function public.ai_admin_discard_key(p_actor uuid, p_secret_id uuid, p_reason text)
returns void language sql security definer set search_path = ''
as $$ select public.ai__discard_key(p_actor, 'anthropic', p_secret_id, p_reason); $$;

create or replace function public.ai_admin_remove_key(p_actor uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__remove_key(p_actor, 'anthropic', p_expected_version); return public.ai_admin_get(p_actor); end; $$;

create or replace function public.ai_admin_record_test(p_actor uuid, p_ok boolean, p_detail text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__record_test(p_actor, 'anthropic', p_ok, p_detail); return public.ai_admin_get(p_actor); end; $$;

-- v2: com fornecedor.
create or replace function public.ai_admin_stage_key_v2(p_actor uuid, p_provider text, p_key text, p_last4 text, p_fingerprint text)
returns uuid language sql security definer set search_path = ''
as $$ select public.ai__stage_key(p_actor, p_provider, p_key, p_last4, p_fingerprint); $$;

create or replace function public.ai_admin_activate_key_v2(p_actor uuid, p_provider text, p_secret_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__activate_key(p_actor, p_provider, p_secret_id); return public.ai_admin_get_v2(p_actor); end; $$;

create or replace function public.ai_admin_discard_key_v2(p_actor uuid, p_provider text, p_secret_id uuid, p_reason text)
returns void language sql security definer set search_path = ''
as $$ select public.ai__discard_key(p_actor, p_provider, p_secret_id, p_reason); $$;

create or replace function public.ai_admin_remove_key_v2(p_actor uuid, p_provider text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__remove_key(p_actor, p_provider, p_expected_version); return public.ai_admin_get_v2(p_actor); end; $$;

create or replace function public.ai_admin_record_test_v2(p_actor uuid, p_provider text, p_ok boolean, p_detail text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform public.ai__record_test(p_actor, p_provider, p_ok, p_detail); return public.ai_admin_get_v2(p_actor); end; $$;

-- Consumo do mês (as mesmas chaves de antes + o custo das imagens em separado).
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
    'image_usd', coalesce(sum(cost_usd) filter (where kind = 'image' and status <> 'released'), 0),
    'budget_usd', (select monthly_budget_usd from public.ai_settings where id = 1)
  ) into v
  from public.ai_usage where created_at >= v_month;
  return v;
end;
$$;

-- «Geração validada» por fornecedor/modelo/tipo: a última utilização REAL bem-sucedida.
create or replace function public.ai_admin_generation(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.ai__assert_admin(p_actor);
  return (
    select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'model', model, 'kind', kind, 'validated_at', at)), '[]'::jsonb)
    from (select provider, model, kind, max(finished_at) as at from public.ai_usage
          where status = 'done' and finished_at is not null and provider is not null
          group by provider, model, kind) g
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Permissões (as funções v1 mantêm as permissões que já tinham)
-- ---------------------------------------------------------------------------

revoke all on function public.ai__check_settings() from public, anon, authenticated;
revoke all on function public.ai__key_view(public.ai_provider_keys) from public, anon, authenticated;
revoke all on function public.ai__view_v2(public.ai_settings) from public, anon, authenticated;
revoke all on function public.ai__update(uuid, integer, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.ai__bump(uuid) from public, anon, authenticated;
revoke all on function public.ai__stage_key(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ai__activate_key(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ai__discard_key(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.ai__remove_key(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ai__record_test(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.ai_provider_key_for(text) from public, anon, authenticated;
revoke all on function public.ai_reserve(uuid, uuid, uuid, uuid, numeric, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ai_admin_get_v2(uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_update_v2(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ai_admin_stage_key_v2(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_admin_activate_key_v2(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.ai_admin_discard_key_v2(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.ai_admin_remove_key_v2(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ai_admin_record_test_v2(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.ai_admin_generation(uuid) from public, anon, authenticated;
revoke all on function public.ai_status_v2() from public, anon;

grant execute on function public.ai_status_v2() to authenticated;
grant execute on function
  public.ai_provider_key_for(text),
  public.ai_reserve(uuid, uuid, uuid, uuid, numeric, text, text, jsonb, text),
  public.ai_admin_get_v2(uuid), public.ai_admin_update_v2(uuid, integer, jsonb),
  public.ai_admin_stage_key_v2(uuid, text, text, text, text), public.ai_admin_activate_key_v2(uuid, text, uuid),
  public.ai_admin_discard_key_v2(uuid, text, uuid, text), public.ai_admin_remove_key_v2(uuid, text, integer),
  public.ai_admin_record_test_v2(uuid, text, boolean, text), public.ai_admin_generation(uuid)
  to service_role;
