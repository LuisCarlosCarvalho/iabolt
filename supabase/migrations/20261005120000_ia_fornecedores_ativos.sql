-- Fornecedores ATIVOS e escolha automática do melhor por função.
--
-- Antes: o administrador escolhia UM fornecedor/modelo de edição e UM de imagens, e um interruptor
-- geral. Agora: cada fornecedor tem a sua chave e um botão «Ativo»; para cada função (edição,
-- imagens) o servidor usa o melhor fornecedor ativo com chave reconhecida, segundo a ordem de
-- preferência dos modelos (`ai_models.preference`, menor = melhor). As funções (ai-propose,
-- ai-image) continuam a ler `ai_settings` (provider/model/enabled e image_*), que passa a ser
-- calculado aqui; não precisam de mudar.
--
-- A escolha é recalculada sempre que um fornecedor é ativado/desativado ou a chave muda de estado
-- (guardada, recusada num teste, removida). Uma chave recusada passa a função para o fornecedor
-- ativo seguinte (nunca para um desativado). Não há troca a meio de um pedido.

alter table public.ai_provider_keys add column enabled boolean not null default false;
comment on column public.ai_provider_keys.enabled is 'O administrador ativou este fornecedor (só conta com a chave reconhecida).';

alter table public.ai_models add column preference integer;
comment on column public.ai_models.preference is 'Ordem de escolha automática por função (menor = melhor); NULL = nunca escolhido automaticamente.';

-- Edição: o modelo já validado em produção primeiro; depois o principal de cada fornecedor.
update public.ai_models set preference = 10 where provider = 'anthropic' and model = 'claude-sonnet-5-5';
update public.ai_models set preference = 20 where provider = 'openai' and model = 'gpt-6.1-sol';
update public.ai_models set preference = 30 where provider = 'google' and model = 'gemini-3.8-flash';
-- Imagens: o de tarifa publicada mais baixa primeiro.
update public.ai_models set preference = 10 where provider = 'google' and model = 'gemini-3.1-flash-image';
update public.ai_models set preference = 20 where provider = 'google' and model = 'gemini-3-pro-image';

-- Estado atual preservado: o fornecedor em uso (edição e/ou imagens, se ativos) fica ativo.
update public.ai_provider_keys k
  set enabled = true
  from public.ai_settings s
  where s.id = 1
    and k.key_status = 'valid'
    and ((s.enabled and s.provider = k.provider) or (s.image_enabled and s.image_provider = k.provider));

-- Recalcula a escolha por função a partir dos fornecedores ativos.
create or replace function public.ai__route()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edit record;
  v_image record;
begin
  select m.provider, m.model into v_edit
    from public.ai_models m join public.ai_provider_keys k on k.provider = m.provider
    where m.capability = 'edit' and m.supported and m.preference is not null and k.enabled and k.key_status = 'valid'
    order by m.preference
    limit 1;
  select m.provider, m.model into v_image
    from public.ai_models m join public.ai_provider_keys k on k.provider = m.provider
    where m.capability = 'image' and m.supported and m.preference is not null and k.enabled and k.key_status = 'valid'
    order by m.preference
    limit 1;
  update public.ai_settings s
    set provider = coalesce(v_edit.provider, s.provider),
        model = coalesce(v_edit.model, s.model),
        enabled = v_edit.provider is not null,
        image_provider = coalesce(v_image.provider, s.image_provider),
        image_model = coalesce(v_image.model, s.image_model),
        image_enabled = v_image.provider is not null
    where s.id = 1
      and (s.enabled is distinct from (v_edit.provider is not null)
        or s.image_enabled is distinct from (v_image.provider is not null)
        or (v_edit.provider is not null and (s.provider, s.model) is distinct from (v_edit.provider, v_edit.model))
        or (v_image.provider is not null and (s.image_provider, s.image_model) is distinct from (v_image.provider, v_image.model)));
end;
$$;

create or replace function public.ai__route_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai__route();
  return null;
end;
$$;

create trigger ai_provider_keys_route after update of enabled, key_status on public.ai_provider_keys
  for each statement execute function public.ai__route_trigger();

-- Compatibilidade com o painel anterior (interruptor geral e escolha manual, pela ação «update»):
-- ligar a edição ou as imagens por esse caminho marca o fornecedor como ativo, para a escolha
-- automática não o desligar na mudança de chave seguinte.
create or replace function public.ai__sync_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.enabled and not old.enabled then
    update public.ai_provider_keys set enabled = true where provider = new.provider and not enabled;
  end if;
  if new.image_enabled and not old.image_enabled and new.image_provider is not null then
    update public.ai_provider_keys set enabled = true where provider = new.image_provider and not enabled;
  end if;
  return null;
end;
$$;

create trigger ai_settings_sync_enabled after update of enabled, image_enabled on public.ai_settings
  for each row execute function public.ai__sync_enabled();

-- Ativar / desativar um fornecedor (pedido explícito do administrador).
create or replace function public.ai_admin_set_provider_enabled_v2(p_actor uuid, p_provider text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.ai_provider_keys;
  s public.ai_settings;
begin
  perform public.ai__assert_admin(p_actor);
  select * into k from public.ai_provider_keys where provider = p_provider for update;
  if not found then
    raise exception 'invalid_provider';
  end if;
  if p_enabled and k.key_status is distinct from 'valid' then
    raise exception 'key_not_valid';
  end if;
  update public.ai_provider_keys set enabled = p_enabled where provider = p_provider;
  select * into s from public.ai_settings where id = 1;
  perform public.ai__bump(p_actor);
  insert into public.ai_settings_audit (actor_id, action, changes)
    values (p_actor, case when p_enabled then 'provider_enabled' else 'provider_disabled' end,
            jsonb_build_object('fornecedor', p_provider,
                               'edição', case when s.enabled then s.provider || ' · ' || s.model else 'desativada' end,
                               'imagens', case when s.image_enabled then s.image_provider || ' · ' || s.image_model else 'desativadas' end));
  return public.ai_admin_get_v2(p_actor);
end;
$$;

-- A vista de cada chave passa a dizer se o fornecedor está ativo.
create or replace function public.ai__key_view(k public.ai_provider_keys)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('configured', k.key_secret_id is not null, 'last4', k.key_last4, 'fingerprint', k.key_fingerprint,
                            'status', k.key_status, 'tested_at', k.key_tested_at, 'updated_at', k.key_updated_at,
                            'enabled', k.enabled);
$$;

-- Os modelos da vista de administração levam a ordem de preferência.
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
                 'price_image', price_image, 'note', note, 'preference', preference,
                 'prices', jsonb_build_object('input', price_input, 'output', price_output, 'cacheRead', price_cache_read, 'cacheWrite', price_cache_write))
                 order by provider, capability, price_input), '[]'::jsonb) from public.ai_models where supported)
  );
end;
$$;

revoke all on function public.ai__route(), public.ai__route_trigger(), public.ai__sync_enabled(), public.ai_admin_set_provider_enabled_v2(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.ai_admin_set_provider_enabled_v2(uuid, text, boolean) to service_role;
