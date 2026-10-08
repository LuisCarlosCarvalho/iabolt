-- Bolt IA · Gemini 3.5 Flash-Lite como modelo de edição da Google na escolha automática.
-- Depende de 20261005120000 (preferências e ai__route) e 20261008120000 (Cloudflare).
--
-- Porquê (08/10/2026): com a chave GRATUITA da Google, o Gemini 3.8 Flash permite 20 pedidos por
-- dia (HTTP 429 «limit: 20 requests per day on Free Tier») e respondeu várias vezes acima do tempo
-- limite. O Flash-Lite tem quota própria (separada da do 3.8 Flash), responde mais depressa e
-- custa menos. Até aqui não tinha preferência e nunca era escolhido sozinho.
--
-- Ordem da edição: Claude Sonnet 5.5 (10) → GPT-6.1 Sol (20) → Gemini 3.5 Flash-Lite (25)
-- → Gemini 3.8 Flash (30). Só contam os fornecedores ativos com a chave reconhecida.

update public.ai_models set preference = 25 where provider = 'google' and model = 'gemini-3.5-flash-lite';

-- Aplica já a nova ordem (em produção: só a Google ativa na edição → passa ao Flash-Lite).
select public.ai__route();
