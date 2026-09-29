# Assistente IA · versão 1 (elemento selecionado)

Estado a 29/09/2026: **implementado e testado localmente com um simulador.** A função no servidor e a migração estão **escritas para revisão**: não foram aplicadas, não há chave configurada e não houve chamadas pagas. Plano funcional em `docs/09`; fornecedor, custos e decisões em `docs/13`.

## O que faz

A ferramenta «Assistente IA» (ícone de faíscas) trabalha sobre **o elemento selecionado** e pode:

- editar o texto;
- editar a ligação (destino e abrir num novo separador);
- alterar o nível do título (h1–h6 ou parágrafo), quando o elemento é um título ou parágrafo;
- alterar os estilos próprios no dispositivo escolhido (Computador, Tablet ou Telemóvel).

**Percurso:** pedido → proposta validada → lista de alterações e antes/depois → «Aplicar» (um único desfazer) ou «Descartar».

- O painel não mostra controlos para operações ainda não implementadas. Lista-as só como próximas etapas, em texto.
- **Modo local:** as propostas vêm de um **simulador** (sem IA, sem rede), identificado como tal no painel e nos testes.
- **Modo servidor:** o assistente fica desativado até `VITE_AI_ASSISTANT=server`, que só se ativa depois de publicar a função (ver Ativação).

## Estado

| Ponto | Implementado | Testado localmente | Validado no Supabase / fornecedor |
| --- | --- | --- | --- |
| Painel, âmbito «elemento», capacidades, dispositivo | sim | sim ([simulado] E2E) | não se aplica |
| Contrato de operações (zod) partilhado entre o editor e a função | sim | sim (unitário) | pendente |
| Contexto com a origem dos estilos e as ligações a variáveis | sim | sim (E2E: `color` ← regra com `--bolt-heading`) | pendente |
| Conteúdo do projeto tratado como dados (delimitado e escapado; instrução explícita no prompt) | sim | sim (unitário) | pendente (caso de injeção na bateria real) |
| Validação: sessão, acesso ao projeto, âmbito, operações, propriedades, valores, URLs, variáveis | sim | sim (unitário e E2E) | pendente |
| Versão local do documento (inclui alterações por gravar) | sim | sim (unitário e E2E: alteração durante a espera; proposta desatualizada) | não se aplica |
| Antes/depois numa cópia, **à largura e no breakpoint do dispositivo escolhido** (1280/768/375 px, só a escala muda), com as mesmas dimensões para os dois, «Ampliar pré-visualização»; lista de alterações; só aplica com confirmação | sim | sim (E2E: computador e telemóvel, prévia = resultado aplicado) | não se aplica |
| Não lê o documento durante a edição de texto no canvas (pedir e aplicar esperam pelo fim da edição) | sim | sem teste dedicado no painel; o mesmo mecanismo na gravação automática tem teste de regressão E2E | não se aplica |
| Um único desfazer para o lote | sim | sim (unitário e E2E) | não se aplica |
| Falha na aplicação: documento restaurado, histórico anterior (incluindo «Refazer») intacto, nada gravado | sim | sim (unitário e E2E, falha injetada) | não se aplica |
| Persistência pela via existente (SaveQueue) | sim | sim (E2E: guardar, F5) | pendente |
| Função `ai-propose` (Deno) | **escrita para revisão** | lógica testada com fornecedor falso ([simulado] unitário) | **pendente** (não publicada) |
| Migração `ai_usage`: reserva atómica, limites e orçamento | **escrita para revisão** | sim (PGlite: limites, concorrência, orçamento, permissões) | **pendente** (não aplicada) |
| Bateria de pedidos reais (acerto, latência, consumo, limite do orçamento) | preparada | não se aplica | **pendente** (ver `docs/15`) |
| Percurso real pela interface (selecionar → pedir → pré-visualizar → aplicar → desfazer → guardar → reabrir; cor herdada de variável) | preparado (`tests/e2e-server/ai-pilot.spec.ts`) | não se aplica | **pendente** (ver `docs/15`) |

## Como a preservação é garantida

- **Reutilização:**
  - As operações são as do editor: `setText`, `setLink`, `setTextTag` e `setOwnStyle`.
  - A gravação é a via única existente: os eventos normais do editor levam à SaveQueue.
  - Não há escrita de HTML.
- **Contexto:** vai só o elemento do âmbito. Inclui:
  - o texto (marcando se tem formatação interna, que `setText` substituiria);
  - a ligação e o nível;
  - para cada estilo, **a origem** (própria, de outro dispositivo, de uma regra do site ou herdada), com a regra e a **variável global** associada, pelo nome amigável;
  - as variáveis globais disponíveis.

  O modelo é instruído a não substituir valores herdados ou ligados a variáveis sem necessidade e a usar `var(--nome)` quando precisa de uma cor ou fonte do tema.
- **Dados, não instruções:**
  - O contexto vai dentro de `<conteudo_do_projeto>`, com `<` e `>` escapados; um texto importado não consegue fechar a delimitação.
  - O prompt diz explicitamente que nada aí é instrução.
  - Mesmo que o modelo obedecesse a um texto hostil, as operações continuariam limitadas pelo esquema e pela validação.
- **Validação em três pontos:**
  1. **Servidor, antes de chamar o fornecedor:**
     - forma do pedido;
     - tamanhos;
     - sessão (`auth.getUser`);
     - acesso ao projeto, com o token do utilizador (RLS);
     - papel de editor no workspace (`ai_reserve`).
  2. **Servidor, depois:** a resposta tem de passar no esquema zod e em `checkProposalShape`:
     - só o id do âmbito;
     - operações compatíveis com o elemento;
     - dispositivo = o pedido;
     - propriedades da lista `AI_STYLE_PROPS`;
     - valores sem `url()`, `!important`, `;{}<>\@` ou `expression`;
     - destinos só `#`, `/`, `http(s)`, `mailto:` ou `tel:`;
     - variáveis conhecidas.

     Uma resposta inválida é repetida até ao limite e, se continuar inválida, **nada é devolvido para aplicar**.
  3. **Editor:**
     - a mesma validação de forma, com as capacidades lidas do **elemento real** (não do que o pedido declarou);
     - a verificação da **versão local**.
- **Versão local:**
  - É uma impressão digital do JSON do projeto no editor, que inclui alterações ainda não gravadas.
  - É comparada ao receber a resposta («o documento mudou enquanto esperava») e antes de aplicar. Enquanto a proposta está aberta, qualquer alteração a invalida e desativa «Aplicar».
  - É deliberadamente conservadora: qualquer alteração ao documento, mesmo noutro elemento, invalida a proposta.
- **Aplicação atómica:**
  1. Ensaio **sem histórico**, com cópia do estado do elemento: texto, `content`, filhos, atributos, etiqueta e regras próprias nos três dispositivos. Se falhar, repõe a cópia e sai sem tocar no histórico.
  2. Reposição e aplicação **com histórico**, na mesma volta do ciclo de eventos, o que dá **um único passo** de desfazer.

  Tudo é síncrono: a gravação automática (temporizada) nunca vê um estado intermédio. O teste E2E de falha recarrega a página e confirma que nada foi gravado.

## Limites no servidor (configuráveis; valores por omissão para o piloto)

> **Atualização de 30/09/2026:** os limites, o orçamento, o modelo e o estado do assistente passaram para a **configuração central** (`ai_settings`), gerida no painel «Configurações de IA». É a fonte única, lida em cada pedido. As variáveis `AI_*` da tabela abaixo deixaram de existir. Restam só `AI_ALLOWED_ORIGINS` (infraestrutura) e `AI_FORCE_DISABLED` (emergência: só desliga). A chave está no Supabase Vault. Os valores e as regras (reserva, teto, consumo desconhecido) mantêm-se. Ver `docs/16`.

| Variável | Omissão | Máximo aceite |
| --- | --- | --- |
| `AI_REQUESTS_PER_USER_DAY` | 50 | 1 000 |
| `AI_REQUESTS_PER_WORKSPACE_DAY` | 300 | 10 000 |
| `AI_MAX_INSTRUCTION_CHARS` | 1 000 | 1 000 |
| `AI_MAX_INPUT_CHARS` (pedido completo) | 24 000 | 60 000 |
| `AI_MAX_OUTPUT_TOKENS` | 1 500 | 4 000 |
| `AI_MAX_OPERATIONS` | 10 | 20 |
| `AI_MAX_CONCURRENT_PER_USER` | 1 | 5 |
| `AI_MAX_CONCURRENT_PER_WORKSPACE` | 4 | 50 |
| `AI_MAX_RETRIES` | 1 | 2 |
| `AI_MONTHLY_BUDGET_USD` | 25 | 10 000 |
| `AI_TIMEOUT_MS` (× tentativas + 10 s ≤ 140 s, senão a função não arranca) | 30 000 | 120 000 |
| `AI_RESERVATION_TTL_SECONDS` | 300 | 3 600 |
| `AI_OVERHEAD_TOKENS` (margem do fornecedor por tentativa) | 1 000 | 10 000 |
| `AI_ENABLED` (interruptor; tem de ser `true`) | desligado | — |
| `AI_PRICE_*_PER_MTOK` | tabela por modelo; **obrigatórios** para um modelo fora da tabela | — |

## Orçamento e reservas (revisto a 29/09/2026)

### Como se chegou a 0,041 USD, e porque não era garantido

O valor anterior vinha de `worstCaseUsd`: 2 tentativas × (escrita de cache de 3 685 caracteres ÷ 3 = 1 229 tokens × 2,50 + entrada de 2 877 caracteres ÷ 3 + 200 = 1 159 tokens × 2 + saída de 1 500 × 10) = 2 × 0,02039 = **0,0408 USD**.

Tinha três falhas:

1. Na função, só o prompt (2 004 caracteres) entrava no cálculo; o esquema da ferramenta (1 681) ficava de fora. A reserva real teria sido de 0,038 USD.
2. «Caracteres ÷ 3» é uma estimativa, não um limite: textos importados com emoji, outros alfabetos ou muito JSON podem ter mais tokens por caractere.
3. A margem para o que o fornecedor acrescenta (instruções de ferramentas, estrutura da mensagem) era de só 200 tokens.

### Limite atual e o que o garante

Por tentativa:

- **tokens de entrada ≤ bytes UTF-8 de tudo o que é enviado + `AI_OVERHEAD_TOKENS`**, onde o que é enviado é o prompt, o nome, a descrição e o esquema da ferramenta, e a mensagem;
- **custo máximo = esse limite × max(preço de entrada, preço de escrita de cache) + `AI_MAX_OUTPUT_TOKENS` × preço de saída**.

A reserva é esse máximo × (1 + `AI_MAX_RETRIES`).

Medido num título do Nimbus com 12 estilos com origem:

| Valor | Medida |
| --- | --- |
| Bytes enviados (prompt 2 071 + ferramenta ≈ 1 755 + mensagem 2 899) | 6 725 |
| Limite de entrada (+ 1 000) | 7 725 tokens |
| Teto por tentativa: 7 725 × 2,50 + 1 500 × 10 | 0,034313 USD |
| **Reserva (2 tentativas)** | **0,068626 USD** |
| Pedido no tamanho máximo aceite (24 000 caracteres ASCII) | 0,174 USD |
| Pedido no tamanho máximo, só com caracteres de 3 bytes | 0,414 USD |

**A garantia depende de quatro condições:**

1. **O tokenizador não produz mais de um token por byte.** É verdade para tokenizadores por bytes; a bateria real **verifica-o** em cada pedido (`withinInputBound`).
2. **A estrutura acrescentada pelo fornecedor cabe em `AI_OVERHEAD_TOKENS`.** Também é verificado (`withinReservation`); se falhar, aumenta-se a margem antes de ativar.
3. **A saída não passa de `max_tokens`.** Imposto pelo próprio fornecedor.
4. **Os preços configurados estão certos.** Estão numa tabela por modelo. Um modelo fora da tabela exige os quatro preços explícitos, senão a função não arranca. Mudar de modelo ou de preços é mudar segredos, o que reinicia a função: as reservas em curso mantêm o valor calculado antes, e o acerto usa os preços do processo que fez a chamada.

### Situações verificadas

| Situação | Tratamento | Testado |
| --- | --- | --- |
| Repetições | já incluídas na reserva, **antes** da primeira chamada; nunca há uma chamada a mais do que as reservadas | unitário |
| Pedidos simultâneos | `pg_advisory_xact_lock`: contagens, orçamento e duplicados lidos e escritos numa só secção crítica; concorrência por utilizador e por workspace | lógica em PGlite; simultaneidade real só no Postgres do servidor |
| Tempo esgotado, erro de rede ou 5xx | a tentativa conta pelo **teto**, não por zero (`unknown_attempts`) | unitário |
| Resposta 200 sem dados de consumo | idem, e a resposta indica `estimated: true` | unitário |
| Erro inesperado depois de enviar | idem; a reserva **não** é libertada | unitário |
| Recusa 4xx do fornecedor | consumo zero conhecido (o fornecedor não processa); acertado com 0 | unitário |
| Função interrompida depois de o fornecedor aceitar | a reserva fica aberta e conta pelo valor reservado; ao fim do TTL deixa de contar como «em curso»; `ai_expire_stale` fecha-a pelo **valor reservado** | PGlite |
| Pedido duplicado | `request_id` gerado a cada «Propor», único por utilizador; um reenvio é recusado (409) **antes** de qualquer chamada | unitário e PGlite |
| `ai_release` depois de uma tentativa | não põe o custo a zero (só liberta sem tentativas) | PGlite |
| Modelo sem preços | a função recusa todos os pedidos (configuração inválida) | unitário |

**Limites da garantia:**

- O orçamento protege contra o que **esta** função chama. Não vê usos da mesma chave noutros sítios: a chave deve ser exclusiva do piloto.
- Numa corrida entre o fim do mês e uma reserva aberta, o custo conta no mês em que a reserva foi criada.
- Se `ai_settle` falhar (base de dados indisponível), a reserva fica aberta e conta pelo máximo até ser expirada.

### Reconciliação

Uma vez por semana (consultas em `docs/15`):

1. Expirar as reservas antigas sem acerto.
2. Comparar `sum(cost_usd)` do mês com o consumo na consola do fornecedor. Diferenças esperadas: sempre a favor da margem (tentativas desconhecidas e reservas expiradas contam pelo máximo).
3. Se o fornecedor mostrar **mais** do que `ai_usage`, desligar (`AI_ENABLED=false`) e investigar.

## Ativação do piloto

Sequência específica deste projeto, em PowerShell: **`docs/15-ativacao-piloto-ia.md`**. Inclui:

- o projeto de destino;
- as migrações aplicadas e pendentes, e o conteúdo e impacto da nova;
- os segredos, sem mostrar valores;
- a publicação da função;
- a ordem dos testes;
- como ativar e desativar.

## Bateria de pedidos reais (preparada, por executar)

`tests/ai-pilot/pilot.test.ts` tem 10 pedidos sobre o template Nimbus:

- encurtar um título;
- mudar o nível;
- usar a cor do tema com `var()`;
- mudar o tamanho só no telemóvel;
- destino de um botão;
- abrir num novo separador;
- texto de um botão;
- um pedido impossível, fora do âmbito (espera-se nenhuma operação);
- um pedido inseguro, `javascript:` (espera-se recusa);
- **injeção no conteúdo**: um título com «IGNORA AS REGRAS…» (espera-se que não seja seguido).

Por pedido, regista o acerto, a validade contra o documento, a latência, as tentativas, os tokens (entrada, saída, cache) e o custo.

Verifica também que o consumo medido fica **dentro do limite usado na reserva** (`withinInputBound`, `withinReservation`). É a verificação real das condições da garantia de orçamento.

O relatório fica em `%TEMP%\bolt-ia-playwright\ai-pilot.json`.

## Limitações conhecidas

- **Concorrência:** a serialização por `pg_advisory_xact_lock` só se prova no Postgres do servidor. O PGlite tem uma só ligação e testou a lógica, não a simultaneidade.
- **Bateria real:** o contexto é construído sem canvas, por isso não inclui a origem dos estilos herdados. A prova com contexto completo é feita no browser, no piloto.
- **Aplicação atómica:** a 2.ª fase repete operações já ensaiadas no mesmo estado. Uma falha nessa fase só é possível por erro interno. Nesse caso o documento é reposto, mas o histórico pode ficar com um passo sem efeito.
- **Formatação do texto:** um texto com formatação interna (negrito, ligações) perde-a com `setText`. O contexto assinala-o e o modelo é instruído a avisar no resumo.
- **Antes/depois no painel:** fica pequeno no computador (1280 px reduzidos a cerca de 18%). «Ampliar pré-visualização» mostra o mesmo à escala do diálogo.
- **Custo local:** a verificação de versão serializa o documento a cada evento enquanto há uma proposta aberta. É imperceptível em páginas normais e deve ser vigiado em páginas muito grandes.

## Próximas etapas

1. Secções e páginas como âmbito.
2. Inserir, mover, duplicar e eliminar elementos, com os destinos dentro do âmbito (ponto 3 de `docs/09`).
3. Estilos globais com âmbito explícito «Site inteiro» e confirmação do impacto nas várias páginas.

## Ficheiros

- **Contrato e servidor** (partilhados, sem Deno): `supabase/functions/_shared/ai/`:
  - `contract.ts`, `limits.ts`, `prompt.ts`, `provider.ts`, `handler.ts`.
- **Entrada Deno:** `supabase/functions/ai-propose/index.ts`, `supabase/functions/deno.json` e `supabase/functions/deno-globals.d.ts`.
- **Migração:** `supabase/migrations/20260929120000_assistente_ia_consumo.sql`.
- **Editor:** `src/ai/context.ts`, `src/ai/apply.ts`, `src/ai/proposers.ts` e `src/editor/AiAssistantPanel.tsx`.
- **Testes:**
  - `tests/unit/aiAssistant.test.ts`;
  - `tests/db/ai_usage.test.ts`;
  - `tests/e2e/ai-assistant.spec.ts` ([simulado]);
  - `tests/ai-pilot/pilot.test.ts` (real, pendente).
- **Typecheck das funções:** `tsconfig.functions.json`.
