# Configurar o Supabase do Bolt IA

Preencher as variáveis de ambiente **não** chega. A configuração só está completa depois dos passos 1 a 6 e com a validação do passo 8 a passar.

Nunca partilhe a palavra-passe da base de dados, a chave `secret`/`service_role` nem palavras-passe de contas na conversa. Nada disto é necessário para eu ajudar.

## 0. Antes de ativar: guardar os projetos do modo local

Os projetos criados até agora estão só no IndexedDB deste browser.

1. Em http://localhost:5173/, na lista de projetos, clique em **«Exportar cópia de segurança»**. Fica um ficheiro `bolt-ia-copia-local-….json` com todos os projetos completos.
2. Ao ativar o servidor, esses projetos **não são apagados**. Continuam no browser e o Dashboard (já com sessão iniciada) mostra-os num aviso com **«Copiar para a minha conta»**. A cópia é idempotente: repetir não cria duplicados.
3. Limitação: o ficheiro de cópia de segurança ainda não pode ser importado de volta pela interface (os importadores são da fase 3). É uma salvaguarda dos dados, legível e completa.

## 1. Criar o projeto

supabase.com → **New project**:

- **Nome:** `bolt-ia`, ou outro à sua escolha.
- **Região:** UE, por exemplo Frankfurt (eu-central-1).
- **Palavra-passe da base de dados:** gerada, guardada no seu gestor de palavras-passe. Não é usada pela aplicação.
- **Plano:** o gratuito chega para esta fase. A escolha de plano é sua.

## 2. Executar as migrações (por esta ordem)

**Opção A, no browser (recomendada):** menu **SQL Editor** → **New query** → cole o conteúdo completo de cada ficheiro → **Run**, um de cada vez:

1. `supabase/migrations/20260928120000_projetos_e_revisoes.sql`
2. `supabase/migrations/20260928120100_storage_imagens.sql`

Cada um deve terminar com «Success. No rows returned».

**Opção B, pela linha de comandos:** `npx supabase login`, depois `npx supabase link --project-ref <ref>` (pede a palavra-passe da base de dados no seu terminal) e `npx supabase db push`.

**Confirmar:**

- **Table Editor** mostra `workspaces`, `workspace_members`, `projects` e `project_revisions`, todas com «RLS enabled».
- **Database → Functions** mostra `create_project`, `save_project`, `is_workspace_member`, `handle_new_user`, `validate_project_data` e `asset_workspace`.

## 3. Autenticação

- **Authentication → Sign In / Providers → Email:** ativo. Palavra-passe mínima: 8 caracteres, como na aplicação.
- **Confirm email:** ligado é o recomendado. O serviço de email incluído tem um limite baixo de envios por hora, o que é suficiente para testes.
- **Authentication → URL Configuration:**
  - **Site URL:** `http://localhost:5173`
  - **Redirect URLs:** acrescente `http://localhost:5173/**`
- **Contas de teste para a validação automatizada:** **Authentication → Users → Add user → Create new user**, com «Auto Confirm User» ligado. Crie duas contas, por exemplo `teste-a@…` e `teste-b@…`, com palavras-passe só de teste. Cada conta nova recebe automaticamente um workspace pessoal (trigger `on_auth_user_created`).

## 4. Armazenamento de imagens

A migração 2 cria o bucket `project-assets`.

- **Storage → Buckets → project-assets:** **Public bucket desligado** (é privado); limite de 8 MB; tipos PNG, JPEG, WebP, GIF e AVIF.
- **Storage → Policies:** devem existir `project_assets_select`, `project_assets_insert`, `project_assets_update` e `project_assets_delete`.
- As imagens ficam em `<workspace>/<projeto>/<ficheiro>`. O documento guarda `bolt-asset:<caminho>`, e o editor pede URLs assinados válidos por 12 horas, que só os membros do workspace conseguem obter.

## 5. Chaves de acesso

**Project Settings → API Keys:**

- **Project URL** → `VITE_SUPABASE_URL`
- **Publishable key** (`sb_publishable_…`) ou a chave legada **anon** → `VITE_SUPABASE_ANON_KEY`

A chave `secret`/`service_role` **não** é usada pelo Bolt IA e nunca deve estar no `.env.local`, porque todas as variáveis `VITE_` chegam ao browser.

## 6. Ficheiro `.env.local`

Na pasta do projeto, copie `.env.example` para `.env.local` e preencha:

| Variável | Para quê | Chega ao browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ligação ao projeto | sim (é pública) |
| `VITE_SUPABASE_ANON_KEY` | chave pública | sim (é pública; a proteção é a RLS) |
| `BOLT_TEST_USER_A_EMAIL`, `BOLT_TEST_USER_A_PASSWORD` | conta de teste A | não |
| `BOLT_TEST_USER_B_EMAIL`, `BOLT_TEST_USER_B_PASSWORD` | conta de teste B | não |

O `.env.local` está no `.gitignore`.

## 7. Arrancar em modo servidor

O Vite deteta o `.env.local` e reinicia sozinho o servidor em http://localhost:5173/. Se não reiniciar, pare-o e corra `npm run dev`. A aplicação passa a mostrar o ecrã **Entrar** e, depois do login, **«Guardado no servidor»**.

## 8. Validar no Supabase real

Estes comandos iniciam sessão com as contas de teste. Corra-os no **seu** terminal, na pasta do projeto:

```bash
npm run test:server
npm run test:e2e:server
```

- **`test:server`** (API, 9 casos): usa o código de produção (`SupabaseRepository`, `SupabaseAssetStore`) contra o Auth, PostgREST/RPC e Storage reais. Cobre:
  - criação idempotente, gravação com revisão e conflito;
  - imagem no bucket privado e URL público recusado;
  - conta B sem acesso a projeto, histórico e imagem;
  - cliente anónimo sem acesso.
- **`test:e2e:server`** (browser, 6 casos): cobre:
  - entrar, sair e voltar a entrar;
  - criar, editar, carregar imagem, guardar e reabrir, também num segundo browser autenticado;
  - outra conta não vê, não abre e não obtém a imagem;
  - falha de rede mostra erro e a repetição grava;
  - conflito entre duas abas;
  - cópia dos projetos locais para a conta, sem duplicar.

Os dados criados têm o nome «[teste automático] …» e ficam arquivados no fim.

**Manual (não automatizado):** criar uma conta pelo ecrã do Bolt IA («Criar conta»), confirmar o email recebido e entrar.
