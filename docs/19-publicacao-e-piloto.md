# Publicação compatível e piloto real · Assistente IA v2 (30/09/2026)

Nada deste documento foi executado remotamente. Cada passo pede autorização. Nenhum segredo aparece aqui.

## 1. Estado de partida (confirmado)

| Onde | Estado |
| --- | --- |
| **Produção (Vercel, `master`)** | commit `6744483`: frontend v1 |
| **Ramo de trabalho no GitHub** | `6744483` até aos commits de 30/09 (ver o fim do documento) |
| **Supabase: migrações** | até `20260930120000` aplicadas; `20261001120000_ia_fornecedores.sql` **não aplicada** |
| **Supabase: funções** | `ai-propose` e `ai-admin` na versão de 29/09 (republicadas pelo utilizador); `ai-image` não existe |
| **Chave** | Anthropic no Vault (…9wAA); assistente ativo |

**O push para o ramo de trabalho não publica em produção.** O histórico de deploys do GitHub mostra-o: cada commit enviado para os dois ramos gerou um deploy *Preview* (ramo de trabalho) e um *Production* (`master`); o commit `baa6789`, enviado só para o ramo de trabalho, gerou apenas *Preview*. O Preview tem um endereço próprio, que não está em `AI_ALLOWED_ORIGINS`, por isso as funções de IA recusam-no (CORS).

## 2. Porque a transição é compatível

**Problema da versão anterior do plano:** a migração apagava as colunas da chave e mudava as funções SQL de administração. O painel e a função `ai-admin` publicados deixariam de funcionar entre a migração e a nova publicação.

**Correção:**

- **A migração não apaga nada.** Só substitui duas restrições por versões mais largas ou por um gatilho.
  - As colunas da chave em `ai_settings` ficam **congeladas**, com o valor de hoje.
  - A chave Anthropic é copiada para `ai_provider_keys` com o **mesmo segredo** do Vault.
  - Nenhum segredo é removido.
- **As funções SQL que as funções publicadas usam mantêm nome, argumentos e formato de resposta (v1):**
  - `ai_admin_get/update/stage_key/activate_key/discard_key/remove_key/record_test`, `ai_admin_usage`, `ai_admin_audit`;
  - `ai_status`, `ai_runtime_settings`, `ai_provider_key` e `ai_reserve` (7 argumentos).
  
  Passam a ler e escrever a chave Anthropic no armazenamento novo. As novas têm nomes próprios (`*_v2`, `ai_status_v2`, `ai_provider_key_for`, `ai_reserve` com fornecedor e tipo).
- **As funções novas aceitam as duas versões do frontend:**
  - `ai-propose`: um pedido `contract: 1` é convertido para v2, passa pelo mesmo pipeline (reserva, fornecedor, validação) e volta no formato v1 (`compatV1.ts`). Operações que o editor v1 não sabe aplicar são recusadas, sem alterar nada.
  - `ai-admin`: pedidos sem `api: 2` seguem a lógica v1 congelada (`adminV1.ts`, igual à de `6744483`) sobre as funções SQL v1.
- **Provas (PGlite, migrações reais):**
  - `tests/db/ai_transition.test.ts` corre a lógica v1 em produção e a v2 sobre o **mesmo** estado migrado: ver, limites, substituir, recusar e testar a chave pelo v1; acrescentar Google pelo v2 sem tocar na Anthropic; o v1 continua coerente.
  - `tests/db/ai_providers_migration.test.ts` prova que a chave, os limites, o consumo e o histórico se preservam.
  - `tests/unit/aiAssistant.test.ts` («Transição») prova o `ai-propose` v1 → v2 → v1.

Assim, **qualquer ordem entre funções e frontend funciona** e o frontend pode voltar atrás sozinho.

## 3. Sequência de publicação (PowerShell, na pasta do projeto)

### Passo 0 · Verificações e cópia de segurança das funções (só leitura)

```powershell
npx supabase migration list
```

Esperado: `20261001120000` só na coluna local. Se aparecer outra diferença, parar (ver `docs/15`).

Cópia das funções publicadas, numa pasta **fora do projeto**. Não descarregar dentro do projeto: substituiria o código novo.

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\bolt-backup-funcoes" | Out-Null
npx supabase functions download ai-propose --project-ref quihhoszhtivzwhcvnsd --workdir "$env:TEMP\bolt-backup-funcoes"
npx supabase functions download ai-admin --project-ref quihhoszhtivzwhcvnsd --workdir "$env:TEMP\bolt-backup-funcoes"
```

(Se a versão da CLI não aceitar `--workdir`, correr os dois comandos dentro de uma pasta vazia fora do projeto.)

### Passo 1 · Migração

```powershell
npx supabase db push --dry-run
npx supabase db push
```

`--dry-run` tem de listar só `20261001120000_ia_fornecedores.sql`.

Verificação no SQL Editor (só leitura):

```sql
select provider, key_status, key_last4 from public.ai_provider_keys order by provider;  -- anthropic | valid | 9wAA
select enabled, provider, model, max_operations, monthly_budget_usd from public.ai_settings;  -- iguais a antes
select * from public.ai_status();  -- true | anthropic | claude-sonnet-5-5 | Claude Sonnet 5.5
select count(*) from public.ai_usage where provider is null;  -- 0
```

No site em produção (ainda v1): abrir «Configurações de IA». Deve mostrar a chave …9wAA; «Testar ligação (sem custo)» deve responder.

### Passo 2 · Funções

```powershell
npx supabase functions deploy ai-propose --project-ref quihhoszhtivzwhcvnsd
npx supabase functions deploy ai-admin --project-ref quihhoszhtivzwhcvnsd
npx supabase functions deploy ai-image --project-ref quihhoszhtivzwhcvnsd
```

Verificação no site em produção (ainda v1): o painel continua a carregar e «Testar ligação (sem custo)» responde. `AI_ALLOWED_ORIGINS` não muda.

### Passo 3 · Frontend (produção)

Fast-forward de `master` para o commit validado e push (Vercel publica). Depois, com a conta administrativa, no painel v2:

- confirmar os cartões por fornecedor (Anthropic …9wAA, «Credenciais: reconhecidas»);
- **para o piloto:** «Máximo de operações por proposta» 40 e «Máximo de tokens de saída» 3000 (o caso de duas páginas precisa de mais do que os valores atuais, 10 e 1500).

## 4. Recuperação (nunca apagar tabelas nem segredos)

| Falha | O que fazer |
| --- | --- |
| **Passo 1 falha** | A migração corre numa transação: nada fica aplicado. Corrigir e repetir. |
| **Depois do passo 1, algo errado nas funções ou no painel publicados** | Parar novos pedidos: `npx supabase secrets set AI_FORCE_DISABLED=true` (só desliga). Corrigir com uma migração nova (para a frente). A chave e o seu segredo continuam no Vault e o ponteiro antigo fica congelado em `ai_settings`. |
| **Passo 2: as funções novas falham** | `AI_FORCE_DISABLED=true`, e voltar a publicar as funções guardadas no passo 0 (`npx supabase functions deploy <nome>` a partir da pasta da cópia). Funcionam sobre o esquema migrado, porque as funções SQL v1 foram mantidas. |
| **Passo 3: o frontend novo falha** | Vercel → Deployments → promover o deploy de produção anterior (`6744483`). O frontend v1 funciona com as funções novas (compatibilidade v1). |
| **Voltar a ligar a IA** | `npx supabase secrets set AI_FORCE_DISABLED=false`. |

## 5. Piloto real (pago, a executar com autorização)

- **Pré-requisitos:** passos 1–3 concluídos e limites do piloto definidos.
- **Custos estimados:** calculados com o tamanho real dos pedidos no template Nimbus e a fórmula de reserva do servidor.
  - O **típico** conta cerca de 3,5 bytes por token de entrada e a saída esperada.
  - O **máximo** é o reservado (margem de 1000 tokens, saída máxima e 2 tentativas). Nunca é gasto por inteiro, e a diferença volta ao orçamento.

| # | Caso | Fornecedor · modelo | Custo típico | Máximo reservado | Sucesso quando |
| --- | --- | --- | --- | --- | --- |
| P1 | Título → «Põe este título na cor principal do tema.» (elemento) | Anthropic · Claude Sonnet 5.5 | ≈ 0,012 USD | ≈ 0,12 USD | Proposta `setOwnStyle` com `var(--bolt-primary)`; aplicar muda a cor; um só desfazer; guardar, F5, reabrir mantêm. «Geração validada» passa a aparecer para o Sonnet 5.5. |
| P2a | Igual a P1 | OpenAI · GPT-6.1 Sol (ou GPT-6 Luna) | ≈ 0,012 (Luna ≈ 0,0006) USD | ≈ 0,10 (Luna ≈ 0,005) USD | Igual a P1, com o fornecedor OpenAI escolhido no painel (depois de configurar a chave). |
| P2b | Igual a P1 | Google · Gemini 3.8 Flash | ≈ 0,009 USD | ≈ 0,07 USD | Igual a P1, com o Gemini. |
| P3 | Imagem do painel de métricas selecionada, com fotografia de estacionamento no fundo da secção: «a imagem que tem um estacionamento, troca por um parque infantil» (texto livre, sem marcadores) | Anthropic · Sonnet 5.5 | ≈ 0,012 USD | ≈ 0,12 USD | O modelo **pergunta** (sem operações) e oferece a secção como âmbito. Se trocar o painel sem perguntar, o caso **falha** e fica registado. |
| P4a | Imagem selecionada: «Troca esta imagem» → escolher uma imagem do workspace | Anthropic · Sonnet 5.5 | ≈ 0,012 USD | ≈ 0,12 USD | `replaceImage` (não um fundo); escolher existente; aplicar; desfazer/refazer; reabrir mantém a referência permanente. |
| P4b | Secção: «Muda a imagem de fundo desta secção» → escolher uma imagem | Anthropic · Sonnet 5.5 | ≈ 0,012 USD | ≈ 0,11 USD | `setBackgroundImage` na secção; a imagem do elemento não muda; reabrir mantém. |
| P5 | Gerar **uma** imagem no espaço de P4a (ou de P6) | Google · Gemini 3.1 Flash Image | 0,067 USD | 0,067 USD | O custo aparece antes e pede confirmação; a imagem aparece na proposta **sem** mudar o documento; o Storage só a recebe ao aplicar; «Imagens» no consumo mostra 0,067. |
| P6 | Página: «Cria, depois da primeira secção, uma secção de contactos com título, um texto curto, um botão “Marcar reunião” para /contactos e uma imagem» | Anthropic · Sonnet 5.5 | ≈ 0,024 USD | ≈ 0,18 USD | `insertSection` com os quatro elementos e os textos pedidos, sem textos genéricos; o botão aponta para /contactos. |
| P7 | Site com 2 páginas: «Põe todos os títulos de todas as páginas na cor principal do tema» | Anthropic · Sonnet 5.5 | ≈ 0,038 USD | ≈ 0,29 USD (com saída 3000) | Páginas afetadas (2) listadas; aplicar; **um** desfazer reverte as duas; refazer; guardar; reabrir mantém nas duas. |

- **Total típico:** cerca de 0,20 USD com as três primeiras linhas (Anthropic, OpenAI e Google), mais 0,067 da imagem. As reservas somam cerca de 1,2 USD no pior caso, dentro do orçamento de 25 USD, e ficam só como reserva.
- **Registo:** para cada caso, em `docs/18`: resultado (sucesso/falha), consumo mostrado no painel e latência.

## 6. Imagens: quando vão para o Storage

1. **Gerar** (depois de confirmar o custo): a imagem volta à página em base64 e fica **só na memória do browser** (endereço `blob:` desta sessão).
   - Aparece na proposta e no antes/depois, **sem mudar o documento**.
   - O custo fica registado em `ai_usage` (tipo `image`) nesse momento.
2. **Aplicar:** só então a imagem é enviada para o Storage do workspace, pelo mesmo serviço dos carregamentos manuais, e o documento recebe a **referência permanente** (`bolt-asset:…`), nunca um endereço do fornecedor. O mesmo acontece com uma imagem carregada do computador.
3. **Descartar a proposta** (ou fechar a página antes de aplicar):
   - nada vai para o Storage e o documento não muda;
   - a imagem é libertada da memória;
   - **o custo da geração mantém-se registado**, porque o fornecedor cobrou.
4. **Aplicar falha depois do envio para o Storage:** o documento é reposto; o ficheiro fica no Storage sem uso (aparece em «Disponíveis no workspace»).

## 7. Commits de 30/09 (ramo de trabalho)

Os hashes estão na mensagem final da sessão e em `git log`.
