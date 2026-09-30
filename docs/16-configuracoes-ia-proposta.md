# Configurações de IA pela interface

## Estado (30/09/2026): implementado localmente; nada aplicado nem publicado

| Parte | Implementado | Testado localmente | Supabase real |
| --- | --- | --- | --- |
| Migração `20260930120000_configuracoes_ia.sql`: administradores, configuração central, modelos, auditoria, Vault, `ai_reserve` pela configuração central | sim | sim (PGlite, com as migrações reais e o Vault simulado): autoatribuição recusada, utilizador comum sem acesso a tabelas nem funções, ator não administrador recusado mesmo pelo papel de serviço, versão antiga recusada, ativação sem chave recusada, chave pendente → ativa, substituição recusada mantém a anterior, remover apaga do cofre, auditoria sem segredos, último administrador protegido | **pendente** (não aplicada) |
| Função `ai-admin` (Deno) + lógica `_shared/ai/admin.ts` | sim | sim (unitário: 401/403 em todas as ações, sem chamadas às dependências; nenhuma resposta nem log contém a chave; erro interno com a chave não a devolve) | **pendente** (não publicada) |
| `ai-propose` lê a configuração central e a chave do Vault em cada pedido; `AI_FORCE_DISABLED` só desliga | sim | sim (unitário: desativado no painel → 503 sem reserva; trocar de modelo muda os preços da reserva) | **pendente** |
| Painel «Configurações de IA» (`/configuracoes/ia`, entrada só para administradores) | sim | sim (E2E em modo local com a mesma lógica em memória, sem rede) | pendente (depois do deploy) |
| Assistente no editor depende de `ai_status` (fim de `VITE_AI_ASSISTANT`) | sim | sim (modo local usa o simulador) | pendente |

- **Configuração:** é **central** (uma linha, `ai_settings`), gerida pelos administradores do Bolt IA, e aplica-se a todos os workspaces. Não há configuração por workspace nesta entrega.
- **Armazenamento da chave:** Supabase Vault.
  - A tabela guarda só o id do segredo, os últimos 4 caracteres e uma impressão SHA-256 (16 hex).
  - O browser envia a chave só em «Guardar/Substituir chave», por HTTPS, à função `ai-admin`. O campo é limpo logo a seguir e nenhuma resposta a devolve.
  - A chave não fica em localStorage, no documento do projeto, em logs nem em tabelas acessíveis ao cliente.
  - O papel de serviço existe só nas funções.
- **Privilégios efetivos de leitura da chave** (a afirmação anterior de que «só uma função» a lê era imprecisa):

  | Quem | Consegue ler a chave? |
  | --- | --- |
  | Utilizador comum ou administrador, pela interface (`anon`/`authenticated`) | **Não.** Nenhuma tabela ou função acessível a estes papéis a expõe, e `ai-admin` nunca a devolve (testado) |
  | Papel de serviço (`service_role`): qualquer código com a service_role key, hoje as funções `ai-propose` e `ai-admin` | **Sim**, por `ai_provider_key()`. O `ai-admin` usa-a só no teste de ligação e não a devolve. A service_role key tem de continuar só no servidor |
  | Infraestrutura: `postgres`, SQL Editor e secção Vault do painel do Supabase | **Sim**, como qualquer segredo do Vault. É o nível de quem administra o projeto Supabase |

- **Funções administrativas `ai_admin_*`:** executáveis só pelo papel de serviço, e cada uma volta a exigir que o ator seja administrador. O ator (`p_actor`) é o id que `ai-admin` obtém da sessão verificada. A fronteira de confiança é, por isso, a service_role key: quem a tiver pode agir como qualquer administrador.
- **Teste de ligação:** consulta o modelo (`GET /v1/models/{modelo}`). Valida a autenticação da chave e que o modelo é visível para ela, sem gerar texto. **Não prova que a geração funcione** (créditos, limites, permissões de mensagens): isso só se comprova no piloto pago. O painel di-lo.
- **Orçamento mensal:** é central, somado em **todos os workspaces**. É verificado e reservado dentro de `ai_reserve`, sob `pg_advisory_xact_lock(hashtext('bolt_ai_reserve'))`, um único bloqueio global de transação. A leitura das definições, a soma do mês, a comparação e o `insert` da reserva acontecem na mesma transação. Consequências:
  - dois pedidos simultâneos, de quaisquer workspaces, são serializados: o segundo já vê a reserva do primeiro;
  - a lógica está provada em PGlite, mas a **simultaneidade real** só se prova no Postgres do Supabase (o PGlite tem uma só ligação);
  - o acerto (`ai_settle`) não usa o bloqueio. Só baixa o valor, de «reservado» para «real», desde que o real não passe o reservado: é essa a condição que a bateria do piloto verifica (`withinReservation`).
- **Simulação local:** sem servidor, o painel usa a mesma lógica de `ai-admin` em memória, com um fornecedor simulado (chaves com «invalida» são recusadas). Está identificada no painel; nada é guardado nem enviado.
- **Ativação:** `docs/15-ativacao-piloto-ia.md`.

---

A proposta original, que serviu de base, está a seguir.

# Configurações de IA pela interface · proposta

**Objetivo:** configurar a integração de IA no próprio Bolt IA, com a conta administrativa, sem colocar a chave no terminal a cada alteração.

## 1. Autorização administrativa: análise e solução

### O que existe hoje

- **Papéis por workspace:** `workspace_members.role` (owner, editor, viewer), verificados por `is_workspace_member`.
- **Limitação:** cada conta nova é **owner do seu workspace pessoal** (`handle_new_user`). «Owner» não distingue um administrador da plataforma.
- **Não existe papel administrativo global.** Não se deve usar o email nem nada guardado ou editável no browser (localStorage, `user_metadata`).

### Proposta

- **Tabela `platform_admins`:**
  - uma linha por administrador (`user_id`), com quem concedeu e quando;
  - RLS ativa, **sem políticas de escrita**: nenhum utilizador, nem um administrador, escreve na tabela diretamente.
- **Função `is_platform_admin(uid)`:** é a regra usada **no servidor**, em todas as operações.
- **Interface:** usa uma consulta só de leitura (`ai_whoami`) apenas para mostrar ou esconder a entrada «Configurações de IA». Esconder a entrada **não é** a proteção; a proteção está na função.
- **Primeira atribuição (uma vez, fora da interface):** no SQL Editor do Supabase, que corre com privilégios de infraestrutura:
  ```sql
  insert into public.platform_admins (user_id, note)
  select id, 'administrador inicial' from auth.users where email = '<o seu email de administrador>';
  ```
  O email serve só para **encontrar o id** nesse momento, num contexto privilegiado. A partir daí a autorização é pelo `user_id`.
- **Sem autoatribuição:**
  - as atribuições seguintes são feitas por um administrador existente (`ai-admin`, ação `grantAdmin`), que também não se pode remover a si próprio se for o último;
  - quem não é administrador não tem nenhum caminho de escrita.
- **Porquê uma tabela e não claims no JWT (`app_metadata`):** revogar tem efeito imediato. Um token antigo com o claim continuaria válido até expirar.

## 2. Armazenamento da chave

| Opção | Avaliação |
| --- | --- |
| Segredos das Edge Functions (atual) | Só se alteram com a CLI ou a Management API. Fazê-lo pela interface exigiria guardar um token de gestão da infraestrutura (poder sobre todo o projeto) no servidor. **Não recomendado.** |
| Tabela com a chave em texto | Proibido. |
| **Supabase Vault** (`vault.secrets`) | **Recomendado.** A chave é cifrada em repouso com uma chave raiz gerida pela Supabase, fora da base de dados, e a decifragem só acontece na vista `vault.decrypted_secrets`, sem acesso para `anon` nem `authenticated`. Já faz parte da infraestrutura Supabase existente. |

**Regras:**

- **Envio:** o browser envia a chave **uma vez**, por HTTPS, à função autenticada `ai-admin`. Não a guarda: nem em estado React depois do envio, nem em localStorage.
- **Escrita no cofre:** `ai-admin`, depois de verificar o administrador, chama funções `security definer` com o cliente de serviço. Essas funções escrevem no Vault e **só o papel de serviço** as pode executar.
- **Leitura:** só `ai-propose` e o teste de ligação leem a chave decifrada, pela função `ai_provider_key()`, restrita ao papel de serviço.
- **O que a interface vê:** só «Chave configurada», os últimos 4 caracteres, uma impressão digital (8 primeiros hex do SHA-256), a data e quem a alterou. **Nunca a chave.**
- **Logs:** nenhuma função escreve corpos de pedidos nem a chave. Os erros são reduzidos a mensagens genéricas. A chave nunca vai para o documento do projeto, para o repositório nem para o browser depois do envio.
- **Credenciais de infraestrutura:** a service role e a chave raiz do Vault nunca chegam ao browser. O browser só tem a sessão do próprio utilizador.

## 3. Fonte única de configuração

- **Tabela `ai_settings`** (uma só linha, sem acesso de clientes). Contém:
  - `enabled`, `provider` e `model`;
  - os limites e o orçamento;
  - o estado da chave (`key_secret_id`, `pending_secret_id`, `key_last4`, `key_fingerprint`, `key_status`, `key_tested_at`);
  - `version` (concorrência otimista), `updated_by` e `updated_at`.
- **Tabela `ai_models`:** fornecedor, modelo, nome, os quatro preços e `supported`.
  - Só entram modelos com **adaptador implementado** (hoje: Anthropic).
  - A interface lista só estes.
  - Os preços são editáveis por administradores, com auditoria.
- **`ai-propose` lê a configuração da base de dados em cada pedido** (uma linha, pelo papel de serviço). Consequências:
  - **Desativar no painel** bloqueia a chamada seguinte de qualquer browser, mesmo com uma sessão antiga aberta; a verificação é no servidor, antes da reserva.
  - **Trocar o modelo ou o fornecedor** muda os preços usados na reserva seguinte.
  - Cada reserva guarda `model` e `prices` (instantâneo). O acerto usa o **mesmo instantâneo**, por isso uma mudança a meio de um pedido não mistura preços.
- **Variáveis de ambiente:** deixam de configurar a IA. Ficam só:
  - as da infraestrutura (`SUPABASE_*`, fornecidas automaticamente);
  - `AI_ALLOWED_ORIGINS`;
  - `AI_FORCE_DISABLED=true`: interruptor de emergência que **só desliga** (ganha ao painel, nunca liga).

  Não há conflito possível: ou a base de dados manda, ou a emergência desliga.
- **`VITE_AI_ASSISTANT` deixa de existir.** O painel pergunta ao servidor (`ai_status()`: ativo, fornecedor e modelo, sem segredos) se o assistente está disponível.

## 4. Substituir, testar e remover sem perder a configuração válida

- **Substituir:**
  1. A nova chave é guardada como **pendente** (`pending_secret_id`), sem tocar na ativa.
  2. É feito o «Testar ligação» sobre a pendente.
  3. Só se o teste passar é que uma transação troca ativa ← pendente e apaga a antiga do Vault.
  4. Se falhar, a pendente é descartada, a **ativa continua** e a interface diz «A chave nova não foi aceite; mantém-se a anterior (…a1B2)».
- **Testar ligação** (duas opções, com o custo indicado no botão):
  - **Sem custo:** `GET /v1/models/{modelo}` (chave e modelo) e depois `POST /v1/messages/count_tokens` com o pedido REAL do assistente (instruções, ferramenta, esquema, parâmetros do modelo). Valida a chave, o modelo e o formato do pedido, sem gerar tokens. Se só o formato for recusado, a chave mantém-se e o assistente não é desativado: aparece um aviso com o motivo do fornecedor (é um problema do pedido, não da chave).
  - **Estado no painel, em linhas separadas:** «Chave e modelo: reconhecidos em …, sem gerar texto» e «Geração: validada em …» (última proposta real válida, `ai_usage.status = 'done'`, com o modelo ATUAL) ou «Por validar». O teste sem custo nunca marca a geração como validada.
  - **Pedido real mínimo** (opcional, pede confirmação): 1 mensagem com `max_tokens` 5, cerca de 0,0001 USD. Passa pela reserva e pelo acerto normais, e aparece no consumo.
- **Remover:** pede confirmação; desativa a IA (`enabled=false`) e apaga o segredo do Vault. Fica registado.
- **Concorrência:** cada gravação envia a `version` lida. Se outra pessoa alterou entretanto, a gravação é recusada com «As configurações mudaram; recarregue». Não há sobreposição silenciosa.

## 5. Auditoria

- **Tabela `ai_settings_audit`:** `at`, `actor_id`, `action` e `changes` (jsonb com antes/depois dos campos alterados).
- **Segredos nunca entram:** a chave aparece como `{"key": "substituída: …a1B2 → …c3D4"}`.
- **Escrita:** só pelas funções `security definer`, na mesma transação da alteração.
- **Leitura:** administradores, através de `ai-admin`.

## 6. Consumo no painel (valores separados)

A migração pendente do assistente passa a dividir o custo acertado:

- `confirmed_cost_usd`: tokens indicados pelo fornecedor × preços do instantâneo;
- `unknown_cost_usd`: teto de cada tentativa de consumo desconhecido.

O painel mostra, para o mês:

| Indicador | Origem |
| --- | --- |
| Consumo confirmado | `sum(confirmed_cost_usd)` dos pedidos acertados |
| Consumo desconhecido (contado pelo máximo) | `sum(unknown_cost_usd)` + `sum(cost_usd)` dos pedidos `expired` |
| Reservado (pedidos em curso) | `sum(reserved_usd)` com estado `reserved` |
| Orçamento restante | orçamento − (confirmado + desconhecido + reservado) |

Mostra também os pedidos por dia e o top de workspaces, sem conteúdo dos pedidos.

## 7. Alterações de base de dados (esboço da migração nova, por rever)

```sql
-- Administradores da plataforma
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  note text
);
alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create function public.is_platform_admin(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.platform_admins where user_id = p_user_id) $$;

-- Modelos suportados e preços
create table public.ai_models (
  provider text not null check (provider in ('anthropic')),
  model text not null,
  label text not null,
  price_input numeric(10,4) not null, price_output numeric(10,4) not null,
  price_cache_read numeric(10,4) not null, price_cache_write numeric(10,4) not null,
  supported boolean not null default true,
  primary key (provider, model)
);
insert into public.ai_models values
  ('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 10, 0.2, 2.5, true),
  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1, 5, 0.1, 1.25, true),
  ('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5', 4, 20, 0.2, 5, true);

-- Configuração única
create table public.ai_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  provider text not null default 'anthropic',
  model text not null default 'claude-sonnet-5-5',
  requests_per_user_day int not null default 50,
  requests_per_workspace_day int not null default 300,
  max_concurrent_per_user int not null default 1,
  max_concurrent_per_workspace int not null default 4,
  max_output_tokens int not null default 1500 check (max_output_tokens between 100 and 4000),
  max_retries int not null default 1 check (max_retries between 0 and 2),
  max_operations int not null default 10 check (max_operations between 1 and 20),
  overhead_tokens int not null default 1000,
  monthly_budget_usd numeric(10,2) not null default 25 check (monthly_budget_usd >= 0),
  key_secret_id uuid, pending_secret_id uuid,
  key_last4 text, key_fingerprint text,
  key_status text not null default 'none' check (key_status in ('none', 'valid', 'invalid')),
  key_tested_at timestamptz,
  version int not null default 1,
  updated_by uuid references auth.users (id), updated_at timestamptz not null default now(),
  foreign key (provider, model) references public.ai_models (provider, model),
  -- Não se ativa sem chave válida.
  check (not enabled or (key_secret_id is not null and key_status = 'valid'))
);
insert into public.ai_settings default values;

create table public.ai_settings_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid not null references auth.users (id),
  action text not null,
  changes jsonb not null
);

alter table public.ai_models enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_settings_audit enable row level security;
revoke all on public.ai_models, public.ai_settings, public.ai_settings_audit from anon, authenticated;

-- Funções só para o papel de serviço (chamadas por ai-admin depois de verificar o administrador):
--   ai_admin_update_settings(p_actor, p_expected_version, p_patch jsonb)   -- valida, grava, audita
--   ai_admin_stage_key(p_actor, p_key text) -> (secret_id, last4, fingerprint)  -- vault.create_secret
--   ai_admin_activate_key(p_actor, p_secret_id)  -- troca ativa ← pendente; vault: apaga a antiga
--   ai_admin_discard_key(p_actor, p_secret_id)
--   ai_admin_remove_key(p_actor)                 -- desativa e apaga do vault
--   ai_admin_grant(p_actor, p_user_id) / ai_admin_revoke(p_actor, p_user_id)  -- nunca o último
--   ai_provider_key() -> text                    -- decifra (só ai-propose / teste)
--   ai_runtime_settings() -> jsonb               -- configuração + preços para ai-propose
-- Para utilizadores autenticados (sem segredos):
--   ai_status() -> (enabled, provider_label, model_label)
--   ai_whoami() -> (is_admin)

-- ai_usage (na migração pendente, ainda não aplicada): model, prices jsonb (instantâneo),
-- confirmed_cost_usd, unknown_cost_usd.
```

## 8. Funções no servidor

**`ai-admin`** (nova, Edge Function; todas as ações por POST):

1. Verifica a sessão (`auth.getUser`) e `is_platform_admin(user_id)` pelo papel de serviço, **em todas as ações**.
2. Ações: `get`, `update`, `setKey` (pendente → teste gratuito → ativar ou descartar), `removeKey`, `test` (gratuito ou real mínimo), `usage`, `audit`, `grantAdmin` e `revokeAdmin`.
3. Respostas sem segredos. Erros genéricos nos logs, sem o corpo do pedido.

**`ai-propose`** (existente, alterações):

- lê `ai_runtime_settings()` em cada pedido, em vez das variáveis de ambiente;
- `AI_FORCE_DISABLED` só desliga;
- a reserva guarda o instantâneo de preços;
- o acerto separa o custo confirmado do desconhecido.

## 9. Interface

- **Entrada «Configurações de IA»:** no menu da conta ou da Dashboard, só quando `ai_whoami()` indica administrador.
- **Secções:**
  - **Estado:** ligado/desligado; a chave (configurada …a1B2, testada em …) com «Testar ligação»;
  - **Fornecedor e modelo:** só os suportados, com os preços;
  - **Chave:** inserir, substituir e remover;
  - **Limites e orçamento;**
  - **Consumo do mês:** confirmado, desconhecido e reservado, separados;
  - **Registo de alterações.**
- **Campo da chave:** `type="password"`, sem autocompletar. Limpo logo após o envio e nunca preenchido a partir do servidor.

## 10. Configuração inicial ainda fora da interface (uma vez)

1. Aplicar as migrações: a do consumo, já pendente, e a nova de configurações.
2. Confirmar que a extensão Vault está ativa no projeto (no Supabase é a predefinição):
   ```sql
   select extname from pg_extension where extname = 'supabase_vault';
   ```
3. Publicar `ai-admin` e `ai-propose`.
4. Conceder o primeiro administrador no SQL Editor (secção 1).
5. `AI_ALLOWED_ORIGINS` como segredo das funções (não é segredo, mas é configuração da infraestrutura).

A partir daí, a chave, o modelo, os limites, o orçamento e ligar ou desligar fazem-se pela interface. A sequência de ativação de `docs/15` será atualizada quando isto for implementado: os passos 3 (chave no terminal) e 6 (variável `VITE_*`) desaparecem.

## 11. Testes previstos

- **PGlite:**
  - ninguém se autoatribui;
  - não-administrador sem acesso a nenhuma função;
  - `ai_settings` sem leitura por clientes;
  - troca de chave que falha mantém a anterior;
  - `version` antiga recusada;
  - auditoria sem segredos;
  - `enabled` impossível sem chave válida.

  O Vault é simulado no PGlite; o real só se testa no Supabase.
- **Unitários de `ai-admin`:**
  - cada ação recusa sem administrador;
  - o segredo nunca aparece nas respostas nem nos logs (captura de `console`).
- **E2E local:** painel com servidor simulado (estados, mascaramento, confirmações).
- **Supabase real (pendente até autorização):** atribuição inicial, gravar, testar e trocar a chave, desativar com uma sessão antiga aberta.
