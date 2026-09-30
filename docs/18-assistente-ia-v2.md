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
