-- Bolt IA · Cloudflare Workers AI como fornecedor de IMAGENS (FLUX.1 schnell).
-- Depende de 20261001120000 e 20261005120000 (já aplicadas; NÃO são reescritas).
--
-- O que muda:
--  1. A Cloudflare passa a ser um fornecedor aceite: tem a sua chave (cofre) e o seu «Ativo».
--  2. Modelo de imagem @cf/black-forest-labs/flux-1-schnell com a MAIOR preferência para imagens
--     (preference 1; o Gemini 3.1 Flash Image tem 10). Com a Cloudflare ativa e a chave reconhecida,
--     a escolha automática (ai__route) passa a gerar as imagens por ela, sem passo manual.
--  3. Não há modelos de edição da Cloudflare: a edição continua com os outros fornecedores.
--
-- Preços (página oficial, 08/10/2026): plano gratuito com 10 000 neurons por dia. No plano pago,
-- 4,80 neurons por tile 512x512 e 9,60 por step, a 0,011 USD por 1 000 neurons. Uma imagem de
-- 1024 px com 4 steps fica em cerca de 0,0006 USD. O teto por imagem usado na reserva é
-- 0,001 USD (nunca abaixo do custo real).
--
-- Compatível com o que está publicado: as funções e o painel anteriores ignoram a chave nova
-- (a Cloudflare só é escolhida depois de ativada, o que só o painel novo faz).

alter table public.ai_models drop constraint ai_models_provider_check;
alter table public.ai_models add constraint ai_models_provider_check check (provider in ('anthropic', 'openai', 'google', 'cloudflare'));

alter table public.ai_provider_keys drop constraint ai_provider_keys_provider_check;
alter table public.ai_provider_keys add constraint ai_provider_keys_provider_check check (provider in ('anthropic', 'openai', 'google', 'cloudflare'));

insert into public.ai_models (provider, model, label, price_input, price_output, price_cache_read, price_cache_write, capability, price_image, supported, note, preference) values
  ('cloudflare', '@cf/black-forest-labs/flux-1-schnell', 'FLUX.1 schnell (Cloudflare)', 0, 0, 0, 0, 'image', 0.001, true,
   'Grátis até 10 000 neurons por dia (cerca de 170 imagens); acima disso, cerca de 0,0006 USD por imagem no plano pago. Imagens quadradas (1024 px).', 1);

-- Sem chave e inativa: nada muda até o administrador guardar a credencial no painel.
insert into public.ai_provider_keys (provider) values ('cloudflare');
