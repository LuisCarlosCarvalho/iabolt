-- Valores financeiros do assistente (preços, custos, reservas, orçamento) só para administradores
-- da plataforma (`platform_admins`). Os limites, a reserva, o acerto e a auditoria continuam iguais
-- para todos: só muda O QUE cada utilizador consegue LER.
--
-- 1. ai_status_v2(): mesma assinatura e colunas (o frontend publicado continua a funcionar); para
--    quem não é administrador, `prices` e `image_price_usd` vêm a NULL. Os restantes campos (limites
--    técnicos de tokens e de partes) não são valores financeiros e mantêm-se.
-- 2. ai_usage (custos, reservas e preços de cada pedido): deixa de ser legível pelo próprio
--    utilizador; só administradores. Ninguém escreve diretamente (sem alteração).

create or replace function public.ai_status_v2()
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
  with me as (select public.is_platform_admin(auth.uid()) as admin)
  select s.enabled and ke.key_status = 'valid', s.provider, s.model, m.label,
         s.image_enabled and ki.key_status = 'valid', s.image_provider, s.image_model, mi.label,
         case when me.admin then mi.price_image end,
         case when me.admin then jsonb_build_object('input', m.price_input, 'output', m.price_output, 'cacheRead', m.price_cache_read, 'cacheWrite', m.price_cache_write) end,
         s.max_output_tokens, s.overhead_tokens, s.max_retries, s.max_parts
  from public.ai_settings s
  cross join me
  join public.ai_models m on m.provider = s.provider and m.model = s.model
  join public.ai_provider_keys ke on ke.provider = s.provider
  left join public.ai_models mi on mi.provider = s.image_provider and mi.model = s.image_model
  left join public.ai_provider_keys ki on ki.provider = s.image_provider
  where s.id = 1;
$$;

revoke all on function public.ai_status_v2() from public, anon;
grant execute on function public.ai_status_v2() to authenticated;

drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_admin on public.ai_usage
  for select to authenticated
  using (exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid()));
