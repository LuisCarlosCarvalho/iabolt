# Assistente IA · versão 2 (edição completa) — 30/09/2026

## Estado (atualizado a 30/09, depois da revisão)

| | Estado |
| --- | --- |
| **Implementado** | tudo o que está descrito abaixo, incluindo a transição compatível, a secção composta, o contexto das imagens e o progresso/cancelamento |
| **Testado com simulador** | unitários, base de dados (PGlite com as migrações reais) e E2E no browser (secção 6) |
| **Validado com fornecedor real** | **nada desta versão** (só o v1, a 29/09: uma resposta válida sem operações, no localhost) |
| **Publicado** | **nada desta versão.** Produção em `6744483`; migração `20261001120000` não aplicada; funções `ai-propose`/`ai-admin` na versão de 29/09; `ai-image` não existe |

Plano de publicação compatível, recuperação e piloto: `docs/19-publicacao-e-piloto.md`.

## 1. Atalho «Editar com IA»

- Ícone de IA na barra azul do elemento selecionado (`ct-ai`), com o título e o nome acessível «Editar com IA».
- Abre o **mesmo** painel do assistente, com o mesmo contexto e a mesma seleção, e põe o foco no pedido.
- Funciona com textos, imagens, botões e contentores.
- Abrir não altera o documento nem o histórico.
- Teste: `tests/e2e/ai-shortcut.spec.ts` (inclui o acesso por teclado).

## 2. Vários fornecedores

Adaptadores reais, cada um só com parâmetros confirmados na documentação oficial desse fornecedor (consultada a 30/09/2026). Nenhum parâmetro é partilhado entre fornecedores.

| Fornecedor | Edição | Imagens | Teste sem custo |
| --- | --- | --- | --- |
| Anthropic | Messages API; `tool_choice: auto` (o Sonnet 5.5 recusa forçar); `thinking: between_tools` só no Sonnet 5.5 | — (não gera imagens) | modelo + `count_tokens` (verifica também o formato do pedido) |
| OpenAI | Responses API (`/v1/responses`); função com `strict: false`; `tool_choice` forçado; `reasoning.effort: low`; `store: false` | Images API (`/v1/images/generations`), base64 | `GET /v1/models/{modelo}` (só credenciais) |
| Google Gemini | Interactions API (`/v1beta/interactions`); `tool_choice: any`; `thinking_level: low` só no 3.8 Flash; `store: false` | Interactions API com `response_format: image` (1K), base64 | `GET /v1beta/models/{modelo}` (só credenciais) |

- **Modelos e preços** (USD por milhão de tokens; imagens por unidade), em `ai_models`:
  - Anthropic: Claude Sonnet 5.5, Haiku 4.5, Opus 5.5.
  - OpenAI: GPT-6.1 Sol, GPT-6 Luna, GPT-6 Astra (preços de contexto curto).
  - Google: Gemini 3.8 Flash e Gemini 3.5 Flash-Lite. Para o 3.8 Flash usa-se o preço **mais alto**, em vigor a partir de 01/01/2027, para a reserva nunca ficar abaixo do custo real.
  - Imagens Google: Gemini 3.1 Flash Image (0,067 USD por imagem 1K) e Gemini 3 Pro Image (0,134 USD).
- **GPT-Image-2.5 Flare: adaptador implementado, mas o modelo fica NÃO suportado.** A documentação consultada só publica preços por token, sem o número de tokens por imagem; sem um teto seguro não há reserva correta. Para o ativar: confirmar o custo por imagem na calculadora oficial e definir `price_image` numa migração.
- **Cada fornecedor tem a sua chave cifrada** (tabela `ai_provider_keys`, Supabase Vault), com o seu estado.
  - Trocar o fornecedor de edição não apaga as outras chaves.
  - Remover uma chave só desativa o uso que dependia dela (edição ou imagens).
- **O modelo de edição e o fornecedor/modelo de imagens configuram-se em separado**, e as imagens ativam-se separadamente.
- **O painel mostra por fornecedor «Credenciais» e «Geração».** O teste sem custo só marca credenciais. «Geração validada» só aparece depois de uma utilização real bem-sucedida (`ai_usage` com estado `done`), por fornecedor, modelo e tipo.
- **Comum a todos:** validação das operações (zod no servidor e no editor), permissões, reserva atómica do custo máximo antes da chamada, consumo e auditoria (agora com o fornecedor e o tipo).
- **Sem troca automática:** uma falha nunca muda de fornecedor nem envia conteúdo a outro serviço.

### Acrescentar um fornecedor (extensão documentada)

Não há compatibilidade genérica com «qualquer API». Para um fornecedor novo:

1. Confirmar na documentação oficial: modelos, pedido, forma de forçar ou pedir a ferramenta, consumo devolvido, erros, preços e um teste sem custo.
2. Escrever um adaptador em `supabase/functions/_shared/ai/<fornecedor>.ts`:
   - `propose()`, que devolve `toolInput`, o consumo, `truncated` e `noToolCall`;
   - um teste sem custo (`check`);
   - opcionalmente `generate()`, para imagens em base64.
3. Registá-lo em `ids.ts` (identificador e nome) e `registry.ts` (`makeEditProvider`, `makeImageGenerator`, `checkProviderKey`, `sentTextFor`).
4. Criar uma migração que acrescente o fornecedor às restrições de `ai_models`/`ai_provider_keys` e os modelos com os preços oficiais.
5. Escrever testes do pedido enviado, das respostas com e sem ferramenta e dos erros, como em `tests/unit/aiProviders.test.ts`.

## 3. Âmbitos: elemento, secção, página, site inteiro

- **Escolha e verificação:**
  - O utilizador escolhe o âmbito no painel e vê-o antes de enviar (ex.: «Secção · Hero «…»», «Site inteiro · 2 páginas»), com o custo máximo estimado ou «Simulador: sem custo».
  - O contexto enviado tem os nós do âmbito (`inScope`) e, para um elemento ou uma secção, os antepassados só como contexto.
  - O servidor e o editor aceitam apenas operações sobre nós do âmbito, ou sobre elementos criados pela própria proposta (`newId`).
- **Âmbito nunca aumentado sozinho:** se o pedido exigir outro âmbito ou for ambíguo, o modelo devolve um **esclarecimento** com opções. Uma opção pode propor outro âmbito, que o utilizador escolhe (não é reenviado sozinho).
- **Operações:**
  - texto, ligação, nível e estilos próprios;
  - substituir imagem e imagem de fundo;
  - inserir blocos (secção, colunas, título, texto, botão, imagem), mover, duplicar e eliminar;
  - **`insertSection`**: cria uma secção **completa** numa só operação validada, com os elementos pedidos pela ordem (título, texto, botão com destino, imagem) e o texto concreto de cada um, sem os textos genéricos do bloco «Secção». Cada elemento tem uma referência temporária (`newId`, ex.: `ai-contactos-titulo`) que as operações seguintes da mesma proposta podem usar (ex.: estilos). O modelo é instruído a usar sempre esta operação para criar secções com conteúdo.
- **Pedidos grandes:**
  - são divididos em partes (por página e depois por grupos de secções), até ao máximo configurado (`max_parts`);
  - cada parte é um pedido com reserva própria;
  - a proposta é consolidada antes de aplicar e mostra as páginas afetadas, com antes/depois por página.
- **Aplicação:**
  - atómica, com um único desfazer, mesmo em várias páginas (confirmado: o histórico do motor agrupa alterações em várias páginas no mesmo ciclo);
  - uma falha repõe o documento e mantém o histórico anterior, incluindo «Refazer»;
  - a gravação é pela SaveQueue existente.

## 4. Imagens e fundos

- **Substituir a imagem e substituir o fundo são operações diferentes.** O contrato recusa `background-image` como estilo livre e recusa endereços de imagem vindos do modelo.
- **Cada imagem da proposta é um «espaço» que o utilizador preenche:**
  - escolher uma imagem da página ou do workspace (biblioteca existente);
  - carregar do computador;
  - **gerar**: mostra o custo e pede confirmação; a imagem volta em base64.
- **Nada é guardado nem substituído antes de aplicar.** Ao aplicar, as imagens carregadas ou geradas vão para o armazenamento existente, e só a referência permanente fica no documento.
- **O custo de uma geração fica registado** em `ai_usage`, tipo «image», mesmo que a proposta seja descartada.
- **Em modo local há um simulador de imagens**, que desenha uma imagem de teste identificada como «IMAGEM SIMULADA» (não é IA).
- **Caso dos prints** (painel de métricas selecionado, pedido sobre «o estacionamento»):
  - **O modelo NÃO vê as imagens.** Recebe só texto:
    - o texto alternativo da imagem selecionada («Painel do Nimbus com métricas de campanhas»);
    - para cada elemento da secção (fora do âmbito, só contexto): o tipo, o texto, o texto alternativo das imagens, se tem imagem de fundo (`backgroundImage`) e o nome do ficheiro quando é descritivo (`imageFile`/`backgroundFile`, ex.: «estacionamento.jpg»; nomes gerados e imagens dentro do documento não são enviados);
    - **nunca o endereço nem os dados da imagem** (testado).
  - **As instruções dizem-lhe isso** e que deve perguntar, com a secção como opção de âmbito, se as descrições não permitirem identificar a imagem com segurança.
  - **Quando falha:** se a fotografia do estacionamento foi carregada com um nome gerado e sem descrição, o modelo só sabe que a secção tem uma imagem de fundo e que a imagem selecionada é um painel de métricas; a decisão de perguntar depende do modelo.
  - **Pedido livre (sem marcadores):** o percurso da interface (esclarecimento → mudar de âmbito → nada alterado) está testado com o simulador, que precisa do marcador `[simulado:ambiguo]` porque não é um modelo. **Com texto livre, só um pedido real o comprova:** é o caso P3 do piloto (`docs/19`).

## 5. Migração nova e publicação (NÃO executadas; ver docs/19)

> Revisto a 30/09: a migração deixou de apagar colunas e passou a manter as funções SQL v1 (nomes, argumentos e respostas), e as funções novas aceitam o frontend v1. A transição não tem janela de quebra. Os pormenores abaixo sobre «ai_settings perde as colunas da chave» foram substituídos: as colunas ficam congeladas.

`supabase/migrations/20261001120000_ia_fornecedores.sql`:

- **Chaves e modelos:**
  - cria `ai_provider_keys` e copia a chave Anthropic existente: o **mesmo segredo do cofre**, nada é decifrado nem recriado;
  - acrescenta modelos (OpenAI, Google), capacidade e preço por imagem;
  - acrescenta à configuração: imagens (fornecedor, modelo, ativo, limite diário) e `max_parts`;
  - alarga os limites de operações (até 200) e de saída (até 16 000).
- **Regra de ativação:** «só se ativa com a chave válida do fornecedor em uso» passa para um gatilho.
- **Consumo:** `ai_usage` ganha `provider` e `kind`; o consumo existente fica atribuído à Anthropic.
- **Compatibilidade:** `ai_provider_key()`, `ai_runtime_settings()` e a assinatura antiga de `ai_reserve` continuam a responder para o fornecedor de edição.
- **Não reescreve migrações anteriores.**
- **Provado em PGlite** (`tests/db/ai_providers_migration.test.ts`): sobre uma configuração existente (chave pela API antiga, assistente ativo, consumo), a chave e a configuração ficam preservadas.

**Para publicar (cada passo pede autorização):**

1. Aplicar a migração (`npx supabase db push --dry-run`, depois `db push`). A partir daí, as funções atuais continuam a funcionar só em parte: a edição com Anthropic sim, o painel de administração não.
2. Republicar `ai-propose` e `ai-admin`, e publicar `ai-image` (nova).
3. Fazer commit, push e deploy do frontend (o contrato v2 exige as funções novas: publicar em conjunto).

## 6. Testes executados (todos locais; nenhum pago) · 30/09, depois da revisão

| Tipo | O quê | Resultado |
| --- | --- | --- |
| Verificação completa | `npm run check`: typecheck, lint, testes, build, diff-check | todos exit 0 |
| Unitários + base de dados | 20 ficheiros | 186/186 |
| PGlite · transição | painel v1 (em produção) e v2 sobre o mesmo estado migrado; funções SQL v1 | 3/3 (`tests/db/ai_transition.test.ts`) |
| PGlite · migração | chave, limites, consumo e histórico preservados; colunas congeladas | 3/3 |
| [simulado] ai-propose v1 → v2 → v1 | resposta v1 válida; operações v2 recusadas; esclarecimento como resumo | 1/1 |
| [simulado] assistente v2 | âmbitos, estrutura, `insertSection`, imagens, várias páginas, contexto das imagens | 29/29 |
| [simulado] adaptadores e administração | OpenAI/Gemini/imagens; vários fornecedores | 12/12 e 10/10 |
| E2E [simulado] | atalho; imagem e fundo; estacionamento; secção preservando as outras; secção nova com título, texto, botão e imagem; site com 2 páginas; amostras GrapesJS e Elementor (cópias); progresso, envios duplicados e cancelar; aplicar, desfazer, refazer, guardar e reabrir | suíte completa: 70 passaram, 2 ignorados (visual) |

## 7. Limitações atuais

- **Geração real por validar**, com qualquer fornecedor, e **imagens reais por validar**. Os adaptadores OpenAI e Gemini nunca falaram com o fornecedor: o formato só fica comprovado com um pedido real.
- **Teste sem custo da OpenAI e da Gemini:** só confirma credenciais (não há contagem gratuita confirmada).
- **GPT-Image-2.5:** não suportado até haver um teto por imagem confirmado.
- **Blocos simples inseridos com `insertBlock` «section»** trazem os textos genéricos do bloco. Para secções com conteúdo usa-se `insertSection` (os elementos criados têm referências próprias).
- **Escolher imagens do workspace:** o modelo não escolhe imagens concretas (não as vê e os nomes originais não são guardados); indica «escolher» com uma sugestão, e o utilizador escolhe.
- **Imagens carregadas ou geradas e aplicadas** ficam no armazenamento. Se a aplicação falhar depois do envio, o ficheiro fica sem uso.
- **Tempos medidos** (browser, um processo, pedido de página «títulos: cor», 3 repetições; a validação e o antes/depois são medidos em separado):

  | Documento | Elementos | Validação | Antes/depois | Proposta visível |
  | --- | --- | --- | --- | --- |
  | Nimbus (template) | 75 | 43–52 ms | 107–120 ms | ~0,5 s (inclui 250 ms do simulador) |
  | GrapesJS Studio (importado; 2 partes) | 385 | 312–418 ms por parte | 797–834 ms | ~1,3–1,4 s |
  | Elementor (importado) | 351 | 254–294 ms | 607–629 ms | ~0,6–0,7 s |

  - A lista de alterações aparece logo depois da validação; o antes/depois é construído a seguir, com a indicação «A preparar a pré-visualização…».
  - Durante a espera, o progresso mostra a fase (pedir / validar) e a parte.
  - Não há envios duplicados, e cancelar descarta a resposta mesmo que chegue depois.
  - Os 20 s de espera nos testes E2E das amostras cobrem só a carga de 4 processos de teste em paralelo na mesma máquina (onde chegou a passar de 5 s); **não são uma correção de desempenho**.

## 8. Próximo passo

1. Autorizar o plano de publicação (secção 5).
2. Teste real mínimo (pago, cerca de 0,01–0,03 USD): um pedido de edição a um título. Depois, se autorizar, **uma** imagem gerada com Gemini 3.1 Flash Image (0,067 USD).

## Janela rápida «Editar com IA» (01/10/2026, não publicado)

- **O quê:** o botão «Editar com IA» da barra do elemento abre uma janela pequena junto ao elemento (por baixo; por cima se não couber; nunca fora do canvas), com o pedido, «Alterar» e «Mais opções».
- **«Alterar»** (ou Ctrl+Enter): pede a proposta para o âmbito «Elemento» e, se passar na validação, **aplica logo**, num só «Desfazer» (também disponível na própria janela). Mostra o que mudou (antes → depois).
- **Mesmas regras do painel:** o mesmo contrato, validação, limites e custo (custo máximo estimado mostrado antes de enviar; simulador sem custo no modo local). Sem geração de imagens.
- **Não aplica** o que precisa de decisão: esclarecimento, imagens a escolher/carregar, pedido grande, proposta inválida ou documento alterado durante a espera. Diz «Nada foi alterado» e oferece «Continuar no assistente» (o painel abre com o mesmo texto).
- **Estilos que não se veem:** depois de aplicar (na janela e no painel), o canvas é verificado. Se uma regra do site prevalecer (ex.: `.text-muted` do Bootstrap com `!important`), aparece «Parte da alteração não se vê na página», com a regra e o valor visível, em vez de dar a alteração como feita.
- **Testes (locais, simulador):** `tests/unit/aiQuickEdit.test.ts` (3), `tests/e2e/ai-shortcut.spec.ts` (2, reescrito: o botão passou a abrir a janela), `tests/e2e/import-static.spec.ts` (janela no site importado e aviso de `!important`). Sem chamadas pagas; o fornecedor real não foi testado com a janela.

## Imagem de fundo pela janela rápida e valores financeiros só para administradores (01/10/2026, não publicado)

### Causa do print («Esta alteração precisa de escolher ou carregar imagens»)

1. **Janela rápida:** enviava sempre `imageGeneration: false`. O modelo era informado de que não podia gerar e propunha «escolher uma imagem»; a janela mandava escolher/carregar.
2. **Configuração do servidor:** os únicos modelos de imagens suportados são os Gemini da Google (Gemini 3.1 Flash Image, 0,067 USD por imagem; Gemini 3 Pro Image, 0,134 USD). O OpenAI GPT-Image fica não suportado por falta de preço publicado. No servidor não há chave Google (`google | none` na verificação de 30/09), por isso a geração estava indisponível mesmo no painel.

### Correção

- A janela rápida envia `imageGeneration: true` quando há gerador. Uma proposta com imagens abre o painel completo **com a mesma proposta**, sem novo pedido ao assistente, e com a confirmação «Gerar imagem» já aberta (descrição proposta pelo modelo, editável).
- Percurso: confirmar → imagem gerada como proposta → antes/depois → aplicar ao fundo (regra própria `#id`; textos, botões e estrutura intactos) → um desfazer → guardar com referência permanente (Storage `bolt-asset:`; no modo local, dentro do documento).
- Sem gerador configurado, a janela e o painel dizem a **causa**:
  - ao administrador: o que configurar (fornecedor e modelo de imagens, chave Google, ativar), com «Abrir Configurações de IA»; o pedido fica guardado e reaparece ao reabrir a janela no mesmo elemento;
  - ao utilizador comum: «não está disponível; contacte o administrador».
  
  Escolher uma imagem existente fica como opção separada e nunca como resposta a «gerar».
- **Configurações de IA › Imagens:** mantém o fornecedor e o modelo próprios (independentes da edição) e a chave por fornecedor (guardar, substituir, remover, testar; cifrada no Vault, só o servidor a lê). Distingue «credencial reconhecida» de «geração validada». Passa a dizer explicitamente que credencial usa: a chave do fornecedor do passo 1, a mesma da edição quando o fornecedor é o mesmo. Não há uma segunda chave para o mesmo fornecedor, por desenho. Se a chave faltar ou tiver sido recusada, diz onde a pôr.

### Valores financeiros

Os custos, preços, reservas, orçamento e o consumo por pedido ficam visíveis **só para administradores** (`platform_admins`). Os limites, as reservas, o acerto e a auditoria continuam iguais para todos.

| Onde | Antes | Agora |
| --- | --- | --- |
| `ai_status_v2()` | preços e preço por imagem para qualquer utilizador | `prices` e `image_price_usd` a NULL para quem não é administrador (mesma assinatura) |
| tabela `ai_usage` | cada utilizador lia o próprio consumo (custos, reservas, preços) | só administradores |
| `ai-propose` (resposta) | `usage` com `costUsd` | `usage` só para administradores |
| `ai-image` (resposta) | `costUsd`/`estimated` | só para administradores (campos opcionais no contrato) |
| limite mensal | «O orçamento mensal … foi atingido» | administrador: igual; outros: «Limite de utilização (do assistente) atingido.» |
| interface (janela, painel, confirmação, imagem escolhida) | custos para todos | custos só para administradores; a confirmação antes de gerar mantém-se para todos |

**Modo local** (sem servidor e sem segurança, só para testar a interface): `localStorage` `bolt-local-papel = utilizador` simula um utilizador comum; `bolt-local-imagens = desligadas` simula a geração não configurada.

### Alterações remotas necessárias (NÃO executadas)

1. **Migração** `20261002120000_ia_financeiro_so_admin.sql` (`db push`). Substitui `ai_status_v2()` com a mesma assinatura e troca a política de leitura de `ai_usage`.
2. **Republicar** as funções `ai-propose` e `ai-image` (`ai-admin` não muda).
3. **Ordem obrigatória:** primeiro o **frontend novo** (Vercel), depois a migração e as funções.
   - O frontend em produção (`7a98efe`) exige `costUsd` na resposta de `ai-image`.
   - Também só ativa as imagens quando recebe o preço.
   - Na ordem inversa, utilizadores comuns ficariam sem geração de imagens no frontend antigo. O frontend novo funciona com o servidor antigo e com o novo.

### Testes (locais; simulador; sem chamadas pagas)

| Ficheiro | O que cobre |
| --- | --- |
| `tests/unit/aiQuickEdit.test.ts` | pedido do print com gerador → gerar; sem gerador → escolher; nada é aplicado |
| `tests/unit/aiAssistant.test.ts`, `tests/unit/aiProviders.test.ts` | resposta sem `usage`/`costUsd` para o utilizador comum, com a mesma contabilização; mensagem de limite sem orçamento |
| `tests/db/ai_usage.test.ts`, `tests/db/ai_settings.test.ts` | PGlite com as migrações reais: o utilizador não lê `ai_usage`, o administrador lê; `ai_status_v2` só tem preços para o administrador |
| `tests/e2e/ai-image-background.spec.ts` | pedido do print numa cópia do template importado (fundo vindo do CSS original); confirmação, pré-visualização, aplicar, desfazer/refazer, guardar e F5; utilizador comum sem valores; geração não configurada (administrador e utilizador) |

**A geração real NÃO está validada.** Só o simulador foi usado.

### Teste real proposto (pago; precisa de autorização e configuração)

1. Guardar a chave Google no passo 1.
2. Escolher **Gemini 3.1 Flash Image** e ativar a geração.
3. Gerar **uma** imagem pelo pedido do print. O custo estimado é de 0,067 USD por imagem (tarifa publicada), mais o pedido de edição, cuja reserva máxima o painel mostra ao administrador (cerca de 0,12 USD com o Claude Sonnet 5.5, segundo o print). O custo real costuma ser menor.

## Bloco com imagem («Stationary»), compatibilidade de versões e publicação (01/10/2026)

### Caso do print: bloco «Stationary» + «Troca a imagem por um livro de matemática.»

- **Não estava coberto.** Com um bloco selecionado (a legenda que cobre a fotografia), o âmbito «Elemento» só abrange o próprio bloco. A imagem estava fora do âmbito.
- **Agora, na janela rápida, ANTES de enviar** (`src/ai/imageTargets.ts`):
  - se o pedido fala de uma imagem, procuram-se as imagens dentro do bloco. Se não houver, procura-se no antepassado mais próximo que as tenha, até à secção;
  - os fundos entram quando o pedido fala de «fundo» ou quando não há imagens;
  - **uma** candidata: «Vai alterar: Imagem · Stationary…», com miniatura;
  - **várias**: escolha com miniaturas; «Alterar» só fica ativo depois de escolher.
- O pedido segue para a imagem escolhida. Com gerador disponível, o painel abre com a **mesma** proposta (sem segunda chamada de edição), o âmbito mostra a imagem e a confirmação «Gerar imagem» já está aberta. A imagem gerada é proposta, aplica-se explicitamente e as outras imagens, a ligação, os textos e a estrutura do cartão não mudam.

### Separadores abertos com versões anteriores

- O pedido de imagem do frontend novo leva `client: 2`.
- A função `ai-image` nova recusa os pedidos **sem** esse campo de utilizadores comuns, **antes** de reservar, com: «Esta página está numa versão anterior do Bolt IA. Espere por «Alterações guardadas» e recarregue a página (F5)… Nada foi gerado nem cobrado.» O frontend anterior exigia o custo, que o servidor já não lhes envia. Os administradores não são afetados. A proteção dos custos não é desativada.
- Para publicações futuras: o build grava `version.json`. Um separador com uma versão anterior mostra «Há uma versão nova… recarregue», sem recarregar sozinho.
- Ordem de publicação: **funções → frontend → migração**.
  - Funções primeiro: o frontend novo envia `client: 2`, que o esquema estrito da função antiga recusaria.
  - Migração por último: no frontend anterior, sem preço, as imagens ficariam desativadas para utilizadores comuns.

### Testes desta ronda (locais, simulador)

| Ficheiro | Resultado |
| --- | --- |
| `tests/unit/imageTargets.test.ts` | 3 testes: amostra real; legenda «Stationary» → 1 imagem; secção do portfólio → 4 |
| `tests/e2e/ai-image-background.spec.ts` | 5 testes: caso do print com gerar, aplicar, desfazer/refazer, guardar e F5; escolha entre várias imagens; fundo do cabeçalho; utilizador comum; geração não configurada |
| `tests/unit/aiProviders.test.ts` | separador antigo recusado antes de reservar |
| `tests/db/ai_settings.test.ts` | sem acesso direto a `ai_models`/`ai_settings`/`ai_settings_audit` |
| `tests/server/ai.financeiro.test.ts` | NOVO, Supabase real, sem chamadas pagas: conta A sem preços, sem acesso às tabelas, `ai-image` antiga recusada |

### Publicação (01/10/2026)

- **Publicado:** `ff9553e` (Vercel).
  - Funções `ai-image` e `ai-propose` republicadas.
  - Migração `20261002120000` aplicada (ordem: funções → frontend → migração).
- **Validado no Supabase real, sem chamadas pagas** (conta de teste A, utilizador comum):
  - sem preços em `ai_status_v2`;
  - sem acesso a `ai_usage`, `ai_models`, `ai_settings`, `ai_settings_audit` e `ai_provider_keys`;
  - `ai-image` sem `client` → 409 antes de reservar;
  - geração desativada → 503, sem valores.
- **Não validado:**
  - a geração real (desativada no servidor: falta a chave Google e ativar o modelo);
  - a vista de administrador no site publicado.

  O que configurar está em `docs/10`.

## Fornecedores ativos e escolha automática por função (05/10/2026, por publicar)

**Pedido:** colocar a chave em qualquer fornecedor, um só botão ativo/inativo por fornecedor, vários ativos ao mesmo tempo e o melhor usado para cada função.

**Diagnóstico.** O servidor já aceitava chaves de qualquer fornecedor. A interface dava a ideia contrária:
- «Guardar chave» ficava desativado até haver 20 caracteres;
- os cartões sem chave diziam «Nada deste fornecedor pode ser ativado»;
- a configuração tinha um único fornecedor/modelo de edição, um de imagens e um interruptor geral.

**Agora:**
- **Cada fornecedor:**
  - chave: guardar, testar sem custo, substituir e remover, como antes, cifrada no Vault;
  - botão **«Ativo»**, que só liga com a chave reconhecida;
  - «Guardar chave» fica disponível assim que se escreve; uma chave incompleta é explicada.
- **Escolha automática no servidor**, migração `20261005120000_ia_fornecedores_ativos.sql`:
  - para cada função, o servidor usa o melhor fornecedor ativo com chave reconhecida, por `ai_models.preference`;
  - edição: Claude Sonnet 5.5 → GPT-6.1 Sol → Gemini 3.8 Flash;
  - imagens: Gemini 3.1 Flash Image → Gemini 3 Pro Image (só a Google gera imagens);
  - a escolha é recalculada quando um fornecedor é ativado/desativado ou a chave muda de estado: guardada, recusada num teste ou removida;
  - um fornecedor desativado ou com a chave recusada passa a função para o ativo seguinte;
  - não há troca a meio de um pedido nem repetição noutro fornecedor depois de um erro.
- **As funções `ai-propose` e `ai-image` não mudam:** continuam a ler `ai_settings`, agora calculado pela escolha automática.
- **O assistente está ativo quando há pelo menos um fornecedor ativo para edição.** O interruptor geral deixa de existir na interface; para desligar tudo, desativam-se os fornecedores.
- **Compatibilidade com o painel anterior:** ligar a edição ou as imagens pela ação «update» marca esse fornecedor como ativo (gatilho `ai__sync_enabled`).
- **Estado de produção preservado pela migração:** o Anthropic, em uso, fica ativo e a edição continua com o Claude Sonnet 5.5.

**Publicação necessária (por autorizar):**
1. migração `20261005120000`;
2. função `ai-admin`, com a ação nova `setEnabled`;
3. frontend.

`ai-propose` e `ai-image` não são republicadas.

**Testes (locais, sem chamadas pagas):**
- `tests/db/ai_routing.test.ts` (6, PGlite com as migrações reais): estado de produção preservado; chave noutro fornecedor com o Claude ativo; ativar, desativar e passar para o seguinte; chave recusada ou removida; só administradores; auditoria; painel anterior;
- `tests/e2e/ai-settings.spec.ts` (2, reescrito para a interface nova);
- `npm run check` exit 0 (220 testes).

## Gemini HTTP 400, responsivo automático e Google Fonts (05/10/2026, por publicar)

### Gemini: «Request contains an invalid argument» (HTTP 400)
- Causa: o esquema da ferramenta enviado à API Interactions usava palavras de JSON Schema que o Gemini não aceita (`const`, `pattern`, `minLength`, `maxLength`) e um objeto `style` sem `properties`. O teste de chave no painel passava porque não envia o esquema.
- Correção: `geminiToolSchema()` (`supabase/functions/_shared/ai/google.ts`) converte `const` em `enum` de um valor, retira as palavras não suportadas e dá ao `style` as propriedades de `AI_STYLE_PROPS`. A proposta continua a ser validada no servidor com o contrato completo.
- Teste unitário: «Gemini: esquema no subconjunto aceite…». Falta validar com um pedido real depois de republicar `ai-propose`.

### Responsivo automático (sem «Estilos no dispositivo»)
- O seletor de dispositivo foi retirado do painel e da edição rápida: o pedido é sempre sobre a base (`desktop`, todos os ecrãs).
- As instruções (regra 7) exigem que o modelo acrescente, na mesma proposta, ajustes `tablet` (≤ 992 px) e `mobile` (≤ 480 px) quando muda tamanhos, larguras, espaçamentos ou colunas. Se o pedido referir um ecrã («no telemóvel»), só esse muda.
- O contrato deixou de exigir `op.device === req.device` (o v1 mantém a regra antiga).
- A pré-visualização tem os separadores Computador/Tablet/Telemóvel. A verificação «alteração invisível» usa o ecrã visível no canvas.
- Simulador: `telemóvel: tamanho 30px` / `tablet: …` geram operações só desse ecrã.

### Google Fonts no seletor de fonte
- O inspetor e os Estilos globais usam `FontPicker`, com fontes do sistema, do projeto (@font-face) e do Google Fonts (36 populares, ou «Outra do Google Fonts…» pelo nome).
- Ao escolher uma família, `ensureGoogleFont` (`src/engine/googleFonts.ts`) pede o CSS a `fonts.googleapis.com` e acrescenta ao projeto as regras @font-face (ficheiros em `fonts.gstatic.com`), uma vez por família. Só depois grava `font-family`. Assim, o canvas, as pré-visualizações e o site publicado usam a mesma fonte.
- Os nomes são validados (letras, números, espaços, hífenes). Uma família inexistente mostra um erro e não altera o projeto.

### Testes desta ronda (locais; sem chamadas pagas)
- Unitários: `googleFonts.test.ts` (novo), `aiProviders.test.ts` (esquema Gemini) e `aiAssistant.test.ts`. Nesta última, a expectativa antiga de recusar ajustes de telemóvel foi substituída pela regra nova.
- E2E:
  - `inspector.spec.ts`: Google Fonts com o CSS da Google simulado por `page.route`, mantém-se depois de recarregar;
  - `ai-assistant.spec.ts`: base + telemóvel na mesma proposta e separadores da pré-visualização.

### Publicação necessária (não feita; precisa de autorização)
- Migração `20261005120000_ia_fornecedores_ativos.sql` (fazer primeiro um dry-run).
- Funções `ai-admin` e `ai-propose`.
- Frontend: push para `master`.

## Gemini: HTTP 400 resolvido no adaptador (08/10/2026)

- A Interactions API recusa `maxItems`/`minItems` nos `parameters` das funções. Isto foi comprovado com o diagnóstico progressivo; a evidência está em `docs/10`.
- `geminiToolSchema()` retira-os. O limite de operações continua no servidor e no editor.
- Painel: Configurações de IA → cartão Google → «Diagnóstico do pedido». É só para administradores, pago, com teto de 0,02 USD, e sonda o esquema palavra a palavra até ao pedido real.

## Cloudflare Workers AI: imagens gratuitas e automáticas (08/10/2026)

**O que é**
- Fornecedor só de imagens: `@cf/black-forest-labs/flux-1-schnell` (licença Apache 2.0).
- Plano gratuito de 10 000 neurons por dia, cerca de 170 imagens de 1024 px; no plano gratuito, ao passar o limite o pedido é recusado em vez de cobrado.
- No plano pago, cerca de 0,0006 USD por imagem; o teto usado na reserva é 0,001 USD.
- As imagens saem quadradas: o modelo não aceita largura nem altura.

**Credencial**
- É o Account ID mais um API Token com a permissão «Workers AI».
- O painel junta os dois como `ACCOUNT_ID:TOKEN` antes de enviar; o cofre guarda-os como uma chave e o token nunca volta ao browser.
- O teste sem custo (botão «Testar ligação» e ao guardar) tem dois passos:
  1. `GET /user/tokens/verify` (o comando que a Cloudflare indica ao criar o token) e, para tokens de conta, `GET /accounts/{id}/tokens/verify`. O token tem de estar `active`.
  2. `GET /accounts/{id}/ai/models/search?per_page=1`, que confirma o Account ID e a permissão «Workers AI».

**Escolha automática**
- O FLUX tem `preference 1` nas imagens (o Gemini Image tem 10).
- Ao guardar uma credencial reconhecida, a Cloudflare fica ativa sozinha, por ser um fornecedor só de imagens. A escolha automática (`ai__route`) passa as imagens para ela.
- Se for desativada ou a chave for recusada, as imagens voltam ao fornecedor ativo seguinte.
- A edição não muda.

**Código**
- `supabase/functions/_shared/ai/cloudflare.ts` (adaptador e teste da credencial).
- `registry.ts`, `ids.ts` e `limits.ts`.
- Migração `20261008120000_ia_cloudflare.sql`.
- Cartão no painel com os campos «Account ID» e «API Token».

**Publicação (por esta ordem)**
1. A migração.
2. As funções `ai-propose`, `ai-image` e `ai-admin`. Todas leem `ai_settings`, e as versões anteriores não conhecem o fornecedor `cloudflare`.
3. O frontend.
4. Só depois guardar o token no painel.

Separadores abertos com a versão anterior do painel precisam de F5 depois de a Cloudflare ficar ativa.

**Testes**
- Unitários: `aiCloudflare.test.ts` e `aiAdmin.test.ts` (ativação automática e compatibilidade).
- Base de dados: `ai_cloudflare.test.ts`.
- E2E: `ai-settings.spec.ts`.
- Todos com respostas simuladas. A primeira imagem real valida a integração.

## Imagens no formato do espaço, identidade do site e bug da confirmação repetida (08/10/2026)

**Formato da imagem pelo espaço**
- `src/ai/imageSlot.ts` mede no canvas o espaço onde a imagem fica:
  - num fundo, o próprio elemento;
  - numa imagem, o contentor quando ela é o seu único conteúdo (ex.: o widget de imagem do Elementor no projeto Carla Santos, cerca de 546×700, que dá 3:4); senão, a própria imagem.
- Essa proporção passa a ser a escolha por omissão («(espaço)» na lista).
- A imagem gerada é recortada ao centro para essa proporção quando o fornecedor devolve outra. O FLUX.1 schnell da Cloudflare só gera quadrados; antes, o espaço vertical recebia um quadrado pequeno. O recorte mantém o formato do ficheiro (PNG continua PNG).

**Identidade do site**
- A regra 9 das instruções exige que o prompt da imagem, em inglês, siga o tema e o público dos textos, as cores das variáveis e um estilo consistente, sem assuntos alheios ao tema, texto ou marcas.
- O `aspect` proposto segue a forma do espaço.
- O texto é curto de propósito: o pior caso do diagnóstico do Gemini, que inclui as instruções em todos os degraus, está em 0,01993 USD, com o teto de 0,02. **Aumentar as instruções obriga a rever esse teto** (o teste `googleDiagnose` falha se passar).

**Bug: «Gerar imagem?» reaparecia ao abrir o assistente**
- O texto e a proposta passados pela janela rápida ficavam guardados no editor.
- O painel é recriado a cada abertura e voltava a aplicá-los, reabrindo a proposta e a confirmação.
- Agora o painel avisa quando os usou (`onConsumed`), e o editor só lhe passa os mais recentes (contadores que só crescem).
- Regressão em `tests/e2e/ai-shortcut.spec.ts`. Confirmado que falha sem a correção.
