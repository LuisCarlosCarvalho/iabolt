# Ativação do Assistente IA com as Configurações de IA (sequência para este projeto)

**Nada disto foi executado.** Os passos 1 a 5 fazem-se uma vez, fora da interface, no PowerShell do Windows (na pasta do projeto) e no painel do Supabase. A partir do passo 6, a gestão habitual (chave, modelo, limites, orçamento, ligar e desligar) faz-se **no painel «Configurações de IA»** do Bolt IA, com a sua conta administrativa. Não partilhe chaves nem senhas na conversa.

## 0. Destino e estado

- **Projeto Supabase:** `quihhoszhtivzwhcvnsd`, o mesmo de `VITE_SUPABASE_URL` em `.env.local`.
- **Frontend publicado:** Vercel `umbulab/bolt2`. O painel só aparece no site publicado depois de um deploy, que precisa da sua autorização.
- **Migrações:**

  | Migração | Estado registado (`docs/10`) |
  | --- | --- |
  | `20260928120000_projetos_e_revisoes.sql` | aplicada |
  | `20260928120100_storage_imagens.sql` | aplicada |
  | `20260928150000_biblioteca_templates.sql` | aplicada (validação pelos testes reais pendente) |
  | `20260929120000_assistente_ia_consumo.sql` | **pendente** (nova) |
  | `20260930120000_configuracoes_ia.sql` | **pendente** (nova) |

### O que as duas migrações novas fazem

- **`…_assistente_ia_consumo`:**
  - Tabela `ai_usage`: uma linha por pedido, com a reserva e o acerto (confirmado e desconhecido em separado), o instantâneo de modelo e preços e o `request_id` único.
  - Funções `ai_settle`, `ai_release` e `ai_expire_stale`, só para o papel de serviço.
  - RLS: cada pessoa lê só o próprio consumo.
- **`…_configuracoes_ia`:**
  - `platform_admins`: administradores da plataforma. Sem escrita pela API.
  - `ai_models`: modelos suportados e preços.
  - `ai_settings`: configuração **central**, numa só linha, **desativada por omissão**.
  - `ai_settings_audit`: quem alterou o quê e quando, sem segredos.
  - `ai_reserve`: lê os limites da configuração central.
  - Funções `ai_admin_*`: só papel de serviço, e cada uma volta a verificar o administrador.
  - `ai_provider_key`: decifra a chave do **Supabase Vault**; só papel de serviço.
  - `ai_status` e `ai_whoami`: para utilizadores autenticados, sem segredos.
- **Impacto:** não alteram nenhuma tabela, política nem função existente e não tocam em projetos, templates nem imagens.
- **Reverter** (antes de haver dados a guardar; pela ordem inversa):
  ```sql
  drop table public.ai_settings_audit, public.ai_settings, public.ai_models, public.platform_admins cascade;
  drop table public.ai_usage cascade;
  drop function if exists public.ai_reserve(uuid, uuid, uuid, uuid, numeric, text, jsonb), public.ai_settle(uuid, text, integer, integer, integer, integer, numeric, numeric, integer, integer, integer, text),
    public.ai_release(uuid), public.ai_expire_stale(integer), public.is_platform_admin(uuid), public.ai_whoami(), public.ai_status(),
    public.ai_runtime_settings(), public.ai_provider_key();
  -- e as funções ai_admin_* e ai__* (lista completa no fim da migração 20260930120000).
  ```

## 1. Confirmar o histórico de migrações (só leitura)

```powershell
npx supabase login
npx supabase link --project-ref quihhoszhtivzwhcvnsd
npx supabase migration list
```

**Esperado:**

- as três primeiras migrações nas duas colunas (local e remota);
- `20260929120000` e `20260930120000` só na coluna local.

**Se aparecer outra diferença** (uma migração remota que não existe no repositório, ou uma local antiga por aplicar), **pare e investigue antes de executar qualquer SQL:**

1. No SQL Editor, só leitura:
   ```sql
   select version, name, statements is not null as tem_sql from supabase_migrations.schema_migrations order by version;
   ```
2. Compare com `supabase\migrations` e com o histórico do repositório: `git log --oneline -- supabase/migrations`.
3. Descubra quem aplicou o quê e porquê.

**Não use `npx supabase migration repair` como atalho.** Marcar versões como aplicadas ou revertidas sem saber o que o SQL remoto contém pode esconder alterações reais. Só depois de perceber a diferença se decide, caso a caso, o que fazer.

## 2. Confirmar o Vault ANTES das migrações (só leitura)

A segunda migração cria `ai_provider_key`, uma função `language sql` que lê `vault.decrypted_secrets`. O Postgres valida esse corpo na criação, por isso **o Vault tem de existir antes**. No SQL Editor:

```sql
select extname, extversion from pg_extension where extname = 'supabase_vault';
select has_function_privilege('vault.create_secret(text, text, text)', 'execute') as criar,
       has_table_privilege('vault.decrypted_secrets', 'select') as ler,
       has_table_privilege('vault.secrets', 'delete') as apagar;
```

- A primeira consulta tem de devolver 1 linha.
- A segunda, corrida como `postgres` (o papel do SQL Editor e do `db push`), tem de dar `true` nas três colunas.
- Se a extensão faltar, ative-a em *Database → Extensions* (Vault) e repita.
- Se algum privilégio vier `false`, pare: as funções da migração não conseguiriam gerir a chave.

## 2b. Aplicar as duas migrações novas

Só se o passo 1 mostrar exatamente as duas pendentes:

```powershell
npx supabase db push --dry-run
npx supabase db push
```

O `--dry-run` tem de listar só `20260929120000` e `20260930120000`.

**Confirmar** (SQL Editor, só leitura):

```sql
select enabled, key_status, model from public.ai_settings;              -- false | none | claude-sonnet-5-5
```

## 3. Publicar as funções

```powershell
npx supabase secrets set AI_ALLOWED_ORIGINS=https://bolt2-lake.vercel.app,http://localhost:5173
npx supabase functions deploy ai-admin --project-ref quihhoszhtivzwhcvnsd
npx supabase functions deploy ai-propose --project-ref quihhoszhtivzwhcvnsd
```

- `AI_ALLOWED_ORIGINS` não é secreto: indica os sites que podem chamar as funções.
- **A chave do fornecedor NÃO vai para o terminal nem para os segredos:** é introduzida no painel e fica no Vault.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos automaticamente às funções.

## 4. Primeiro administrador (uma única vez, SQL Editor)

```sql
insert into public.platform_admins (user_id, note)
select id, 'administrador inicial' from auth.users where email = '<o seu email de administrador>';

select u.email from public.platform_admins a join auth.users u on u.id = a.user_id;   -- confirmar
```

- O email serve só para encontrar o id nesse momento, num contexto privilegiado. A autorização é pelo id.
- Ser owner de um workspace ou ter um email `admin@…` não dá administração.
- Não há outra forma de se autoatribuir.

## 5. Conta de fornecedor (fora do Bolt IA)

Crie a chave de API na consola do fornecedor e defina aí um **limite de gasto mensal**, como segunda proteção.

## 6. Configurar no painel (a partir daqui, tudo pela interface)

No Bolt IA, com a conta administrativa, abra **«Configurações de IA»** no topo:

1. **Chave:** cole a chave e escolha «Guardar chave».
   - É testada **sem custo** e só fica ativa se o fornecedor a aceitar.
   - O painel mostra apenas «Chave configurada …últimos 4».
2. **Fornecedor e modelo:** Anthropic · Claude Sonnet 5.5 (candidato do piloto).
3. **Limites e orçamento:** valores do piloto (por exemplo, orçamento de 25 USD).
4. **«Testar ligação (sem custo)»**, quando quiser confirmar.
5. **Ativar o assistente:** caixa «Assistente ativo».

## 7. Testes (por esta ordem)

1. **Supabase sem IA** (validações ainda pendentes):
   ```powershell
   npm run test:server
   npm run test:e2e:server
   ```
2. **Bateria de pedidos reais**: 10 pedidos, cerca de 0,07 USD. Exige o assistente ativo no painel. Mede o acerto, a latência, o consumo e o limite do orçamento.
   ```powershell
   $env:BOLT_AI_PILOT = "1"
   npm run test:ai-pilot
   Remove-Item Env:BOLT_AI_PILOT
   ```
   O relatório fica em `$env:TEMP\bolt-ia-playwright\ai-pilot.json`. Se `withinInputBound` ou `withinReservation` falharem, aumente «Margem de tokens do fornecedor» no painel e repita.
3. **Percurso real pela interface**: 1 pedido.
   - Confirma que o assistente está ativo antes de começar.
   - Segue Nimbus → título → cor principal do tema → `var(--bolt-primary)` no documento gravado → mudar a cor global e ver o título acompanhar → F5 → Dashboard.
   ```powershell
   $env:BOLT_AI_PILOT = "1"
   npx playwright test --config playwright.server.config.ts ai-pilot.spec.ts
   Remove-Item Env:BOLT_AI_PILOT
   ```

## 8. Desativar

- **Normal:** no painel, desmarque «Assistente ativo». O servidor recusa o pedido seguinte, mesmo em sessões já abertas.
- **Chave:** «Remover chave» apaga-a do cofre e desativa.
- **Emergência, sem painel e sem novo deploy:**
  ```powershell
  npx supabase secrets set AI_FORCE_DISABLED=true
  ```
  Só desliga; para voltar, `AI_FORCE_DISABLED=false`.

## 9. Acompanhar e reconciliar

- O painel mostra o consumo do mês, com o confirmado, o estimado (consumo desconhecido) e o reservado em separado, e o registo de alterações.
- Uma vez por semana, no SQL Editor, feche as reservas sem acerto pelo valor reservado:
  ```sql
  select public.ai_expire_stale(900);
  ```
- Compare o total do mês com a consola do fornecedor. As diferenças esperadas são a favor da margem.
