# Continuidade · ponto de situação (28/09/2026)

Documento para retomar o trabalho. O estado por fase está em `docs/00`.

## Onde está o trabalho

- **Repositório:** https://github.com/LuisCarlosCarvalho/iabolt
- **Ramo de trabalho:** `fase-1-primeira-versao`. `master` é avançado para o mesmo commit (sem merge nem force push) e é o ramo de produção na Vercel.
- **Vercel:** projeto `umbulab/bolt2`, ligado ao GitHub: cada push publica sozinho. Produção: https://bolt2-lake.vercel.app/
- **Supabase:** projeto `quihhoszhtivzwhcvnsd` (as chaves ficam só em `.env.local`, fora do git, e nas variáveis da Vercel).

## Funcionalidades concluídas

| Área | Estado |
| --- | --- |
| Dashboard, templates do produto, editor, gravação com revisões (local e Supabase), autenticação e login com vídeo | concluído (Fase 1) |
| Importação GrapesJS/Studio e Elementor: relatório, prévia isolada, imagens com autorização, original guardado | concluído; testado localmente |
| Biblioteca de templates da equipa: versões imutáveis, projeto derivado independente, retirar | concluído; testado localmente e em PGlite |
| Design system da interface (Blue Bolt), temas Claro/Escuro/Automático, logótipo e favicon | concluído; testado localmente |
| Barra de ferramentas no canvas, inserção pelo «+» (antes, dentro, depois), arrasto no canvas com o motor | concluído; testado localmente |
| Inspetor de estilos: tipografia, layout (flex e grelha), dimensões, espaçamento, fundo, bordas, efeitos, posição, origem dos valores, repor, edição por dispositivo | concluído; testado localmente |
| Assistente de IA | **só plano** (`docs/09`) |

## Testes

### Local (executados nesta sessão, no estado publicado)

Os números exatos da execução final estão no relatório de encerramento. Nas execuções anteriores de hoje:

- `npm run check` (typecheck, lint, 81 testes unitários e de base de dados, build, `git diff --check`): exit 0;
- `npx playwright test` (E2E local, browser real, modo local): 31 passaram e 2 foram ignorados de propósito (as capturas visuais, que só correm com `BOLT_VISUAL=1`).

Ficheiros E2E:

- `tests/e2e/app.spec.ts`
- `tests/e2e/import.spec.ts`
- `tests/e2e/editor-direct.spec.ts`
- `tests/e2e/inspector.spec.ts`
- `tests/e2e/poc.spec.ts`

### Supabase real

- **Executados pelo utilizador a 28/09/2026 (Fase 1):** `npm run test:server` 9/9 e `npm run test:e2e:server` 6/6.
- **Acrescentados depois e por executar:**
  - `test:server`: 2 casos da biblioteca de templates e do registo de importações (`tests/server/supabase.api.test.ts`);
  - `test:e2e:server`: 1 caso do inspetor, que verifica que a imagem de fundo carregada fica gravada como referência permanente dentro de `url(...)` e que o ajuste no telemóvel fica no breakpoint (`tests/e2e-server/server.spec.ts`).
- Estes testes **não** foram executados pelo agente: iniciam sessão no serviço remoto com as contas de teste, o que fica do lado do utilizador.

## Migrações

| Migração | Estado |
| --- | --- |
| `20260928120000_projetos_e_revisoes.sql` | aplicada (validada pelos testes reais 9/9 e 6/6) |
| `20260928120100_storage_imagens.sql` | aplicada (idem) |
| `20260928150000_biblioteca_templates.sql` | aplicada pelo utilizador. Evidência: a importação no site publicado deixou de dar «Could not find the function public.record_import» e gravou os projetos. Falta a validação pelos testes reais novos |

Não há migrações pendentes além desta validação.

## Limitações e problemas conhecidos

- **Por implementar:**
  - importação HTML/CSS, ZIP e JSON Bolt;
  - classes e estados (`:hover`);
  - editor de cores e fontes globais;
  - várias páginas por projeto;
  - vista de código e exportação;
  - publicação dos sites dos utilizadores;
  - IA.
- **Editor em telemóvel:** a barra superior do editor é mais larga do que o ecrã. O problema já existia e não foi corrigido para não reorganizar o editor.
- **Canvas:** na borda de 1 px à volta do canvas e nos cantos arredondados das miniaturas aparece o fundo da interface, que muda com o tema. O conteúdo dos sites fica igual (verificado ao pixel).
- **Barra de ferramentas:** quando o elemento está no topo da vista, a barra fica por dentro e pode tapar parte dele. O rótulo do próprio GrapesJS continua a aparecer ao passar o rato.
- **Inspetor:**
  - a origem «regra do site» é uma aproximação pela ordem das regras, não um cálculo completo de especificidade;
  - valores definidos com abreviaturas (ex.: `padding`) são reconhecidos, mas editados por lado.
- **Elementor:** uma «Largura» guardada num container «boxed» é ignorada, por interpretação do comportamento do Elementor (registado no relatório de cada importação).
- **Aviso em modo dev:** o `postcss` gera avisos «module externalized» na consola do Vite; não afetam o funcionamento.
- **Tamanho do bundle:** o principal tem cerca de 1,9 MB (aviso do Vite acima de 500 kB). A divisão do código fica por fazer.
- **Supabase:** os registos públicos devem estar desligados («Allow new users to sign up»). Confirmar no painel.

## Ficheiros e documentos principais

- `CLAUDE.md`: regras do projeto.
- **Documentação:**
  - `docs/00`: estado das fases;
  - `docs/07`: Supabase;
  - `docs/08`: importação e biblioteca;
  - `docs/09`: plano da IA e pontos de revisão.
- **Motor e editor:**
  - `src/engine/`: motor (tipos Bolt, operações, estilos, runtime, origem dos estilos);
  - `src/editor/`: editor (`EditorPage`, `CanvasToolbar`, `StyleInspector`, `PropertiesPanel`, `LayersPanel`, `ImageDialog`).
- **Importação e dados:**
  - `src/importers/`: pipeline e adaptadores;
  - `src/library/`: biblioteca de templates;
  - `src/persistence/`: gravação.
- **Aplicação:** `src/app/` (serviços, tema, interface).
- **Estáticos:**
  - `public/assets/runtime/`: runtime próprio (menu, carrossel);
  - `public/assets/brand/`: logótipo;
  - `public/favicon*`.
- **Supabase:** `supabase/migrations/`.

## Como iniciar localmente

```bash
npm install
npm run dev
```

Abre em http://localhost:5173/.

- Com `.env.local` preenchido (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), abre em modo servidor, com login.
- Sem essas variáveis, abre em modo local: os projetos ficam só no browser.

Verificação completa:

```bash
npm run check
npx playwright test
```

Testes contra o Supabase real (usam as contas de teste de `.env.local`):

```bash
npm run test:server
npm run test:e2e:server
```

## Atualização de 05/10/2026 (tarde, 2) · Gemini HTTP 400: diagnóstico progressivo publicado

**Tentativa analisada**
- Pedido `b32f88e5-a2bf-4cd9-8955-1908e36f8b7c`, 05/10 às 09:33:42 UTC.
- Processado pela `ai-propose` v11 (publicada às 09:08:42 UTC).
- `google / gemini-3.5-flash-lite`, endpoint `POST /v1beta/interactions`.
- 0 tokens e custo 0, mas isso não garante o resultado de uma tentativa seguinte.

**Resposta completa da Google**
- Os 89 caracteres que ficaram registados, sem corte (limite de 450):
  `{"error":{"message":"Request contains an invalid argument.","code":"invalid_request"}}`
- Não traz `details` nem caminho de campo.

**Conclusão:** a causa não se consegue isolar sem pedidos reais. Não fiz chamadas pagas.

**Publicado: diagnóstico progressivo (commit `94202f0`)**
- `ai-admin` v9 (verificada igual ao commit) e frontend `master` em `94202f0`. O `ai-propose` continua na v11.
- Executa até 9 degraus, cada um acrescentando um elemento ao anterior:
  1. geração mínima;
  2. `store: false`;
  3. `system_instruction` real;
  4. ferramenta mínima;
  5. `tool_choice: "any"`;
  6. esquema real com 1 operação;
  7. sem `anyOf` aninhado;
  8. esquema completo;
  9. pedido real do assistente, com projeto anonimizado e o pedido do print.
- Pára no primeiro recusado e guarda a resposta completa.
- Teto de 0,02 USD verificado no servidor antes de cada degrau, pelo pior caso. Estimativa total com os preços do Flash-Lite: 0,0118 USD.
- Só administrador, só Google. Corre apenas quando o administrador marca a autorização e clica, em Configurações de IA → cartão Google → «Diagnóstico do pedido».
- O custo do diagnóstico **não** entra em `ai_usage`: aparece no relatório mostrado no painel.

**Falta**
- Executar o diagnóstico (autorização do utilizador).
- Corrigir a conversão no adaptador Google conforme o degrau recusado.
- Publicar o `ai-propose` e fazer uma tentativa real com proposta válida.

## Atualização de 05/10/2026 (tarde) · Gemini HTTP 400 continua: causa ainda NÃO comprovada

**Verificação do que está publicado**
- Frontend: `master` em `58c2fd1` (Vercel).
- Funções: `ai-propose` v10 até às 08:57:39 UTC, depois v11 (`3998aa9`); `ai-admin` v8.
- Migração `20261005120000` aplicada.
- Fornecedor e modelo: `google / gemini-3.5-flash-lite`. Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions`.

**Tentativas reais (`ai_usage`)**
- 08:47, 08:49 e 08:56 UTC na v9; 08:58 na v10.
- Todas com HTTP 400 «Request contains an invalid argument.», 0 tokens e custo 0.
- Ambas as versões já tinham o esquema corrigido (`a9647e3`). **A hipótese anterior (`const`/`pattern`/`minLength`/`maxLength`) não era a causa, ou não era a única.**

**O que se comprovou**
- Os campos de topo (`model`, `system_instruction`, `input`, `tools`, `generation_config`, `store`) e o `generation_config` (`tool_choice: "any"`, `max_output_tokens`) estão conformes à referência oficial da Interactions API.
- A ferramenta tem `type`, `name`, `description` e `parameters`, também conforme.
- O esquema tem só palavras do subconjunto documentado, todos os nós com `type`, profundidade 8 e cerca de 6 KB, com `anyOf` de 11 ramos e `anyOf` aninhado em `image`. A documentação avisa que esquemas grandes ou muito aninhados podem ser recusados.
- O registo não tem «INVALID_ARGUMENT:», ao contrário de um erro Google normal. A Interactions API devolve o erro noutro formato e o servidor descartava o resto da resposta: estado, código e detalhes.
- Sem chave não é possível validar: a Google responde 403 antes de validar o corpo.

**Alteração publicada (v11, `3998aa9`)**
- A resposta de erro completa do fornecedor (sem chaves, até 450 caracteres) passa a ficar em `ai_usage.error`, após «| resposta do fornecedor:». O ecrã mantém a mensagem curta.
- Não muda o pedido enviado.

**Falta**
- Uma tentativa real, que não custa nada se voltar a dar 400.
- Ler a resposta completa e corrigir o campo indicado.
- Se a resposta não trouxer o campo, usar o diagnóstico pago por bissecção, com variantes do pedido e custo máximo estimado inferior a 0,01 USD, só com autorização.

## Atualização de 05/10/2026 · Gemini HTTP 400: primeira hipótese publicada (não resolveu; ver acima)

**Causa (com evidência)**
- `ai_usage` mostra 3 tentativas com `google / gemini-3.5-flash-lite` (05/10, às 07:46, 07:55 e 08:15 UTC). Todas falharam com HTTP 400 «Request contains an invalid argument», com 0 tokens e custo 0: a Google recusou o pedido antes de o processar.
- A Interactions API (`POST /v1beta/interactions`) aceita só um subconjunto de JSON Schema nos `parameters` da função (documentação oficial). O esquema enviado tinha `const` ×19, `maxLength` ×33, `minLength` ×20, `pattern` ×3 e o objeto `style` sem `properties`.
- O resto do corpo (`model`, `system_instruction`, `input`, `tools`, `generation_config.tool_choice: "any"`, `max_output_tokens`, `store`) está conforme a referência. O identificador `gemini-3.5-flash-lite` consta da documentação.
- O teste de chave no painel (`GET /v1beta/models/{modelo}`) não envia o esquema, por isso não prova a geração.

**Correção (commit `a9647e3`)**
- `geminiToolSchema()` converte `const` em `enum` de um valor, omite `pattern`/`minLength`/`maxLength` e dá ao `style` as propriedades de `AI_STYLE_PROPS`. A proposta continua validada pelo contrato completo no servidor.
- `providerErrorDetail` grava em `ai_usage.error` o campo recusado (`error.details[].fieldViolations`), sem chaves.

**Publicação (05/10/2026)**
- `ai-propose` passou de v8 para v9, publicada a partir de um worktree limpo em `a9647e3`. A versão descarregada é idêntica ao commit.
- Sem alterações em `ai-admin` (v7), `ai-image` (v3) ou na base de dados, e sem migração.
- Frontend sem alterações: o push foi só ao ramo `fase-1-primeira-versao`. `master` e a Vercel continuam em `0e56273`.
- O contrato não mudou, por isso os separadores já abertos continuam compatíveis.

**Pendente**
- Uma tentativa real do utilizador. Se falhar, o motivo detalhado fica em `ai_usage.error`.

**Imagens em falta no projeto do print**
- 43 endereços distintos (69 referências) apontam para `https://daniel-machado.site/wp-content/uploads/…`.
- O domínio não existe: NXDOMAIN no DNS da Google (8.8.8.8) e da Cloudflare (1.1.1.1).
- Não há referências ao Storage nem relativas. A única imagem de `joanapinho.pt` responde 200.
- Nada foi substituído.

**Ainda local (não publicado)**
- Fornecedores ativos e escolha automática, com a migração `20261005120000`.
- Responsivo automático.
- Google Fonts.
- Limitação conhecida do responsivo: os ajustes da IA gravam-se nos breakpoints da plataforma (≤ 992 px e ≤ 480 px). Os breakpoints importados (ex.: Elementor, 1024 e 767) ficam intactos, mas entre 481 e 767 px uma regra `#id` da base prevalece sobre a regra móvel importada (de classe).

## Atualização de 01/10/2026 · Seleção sincronizada entre o canvas e «Páginas e camadas» (publicada)

**Publicada:** correção no commit `49c0ad9` (`master`, Vercel, produção https://bolt2-lake.vercel.app, `version.json` = `49c0ad9…`). Esta secção foi corrigida num commit seguinte de documentação, porque a primeira versão perdeu os trechos entre acentos graves ao ser escrita pela linha de comandos. Sem alterações no Supabase e sem chamadas de IA.

**Causa do print.**
- O GrapesJS importa um `div` que só tem um título e um botão (ex.: o «callout» do Stylish Portfolio) como componente de **texto**.
- As camadas escondiam os filhos dos textos, por isso o título «Welcome to your next website!» não tinha linha e não podia ser destacado.
- Faltava também deslocar a lista até à linha selecionada.

**Correção** (`src/editor/LayersPanel.tsx`):
- A seleção é a do motor (fonte única) e a linha é a do componente real (`data-layer-id`).
- Os filhos dos textos:
  - a formatação (`em`, `strong`, `span`…) e o conteúdo de parágrafos, títulos e ligações continuam escondidos;
  - um «texto» que é um contentor (`div` com títulos, parágrafos ou botões) mostra-os.
- Uma seleção sem linha própria (ex.: um `<em>`) marca a linha que a contém (estilo próprio).
- Só o caminho até à linha é aberto. Os ramos que o utilizador abriu ou fechou ficam como estavam (os detalhes SVG continuam fechados por omissão).
- Deslocamento **só da lista de camadas**, com `scrollTop` (não `scrollIntoView`): nunca o canvas nem a página. Não há deslocamento se a linha já estiver visível, e o foco não muda.
- A linha volta a ser revelada quando a seleção muda e quando se volta ao painel. Noutra ferramenta, o painel não abre sozinho.
- Destaque com fundo, contorno e barra, nos tokens do tema (claro e escuro).

**Testes:**
- `tests/e2e/layers-sync.spec.ts`, com a página importada, cobre:
  - o título do print;
  - títulos com o mesmo nome;
  - um elemento aninhado;
  - uma imagem escolhida pela árvore;
  - selecionar o pai, duplicar, eliminar e desfazer/refazer;
  - outra ferramenta e regresso;
  - a mudança de página.
- O mesmo teste confirma que a revisão, o histórico e a gravação não mudam ao só selecionar, e que o canvas e a página da aplicação não se deslocam.
- `npm run check` exit 0 (214 testes); Playwright: 79 passaram, 3 ignorados (visuais).

## Atualização de 01/10/2026 · Publicação: importação ZIP, janela «Editar com IA», imagens e custos só para administradores

**Publicado em 01/10/2026** (commit `ff9553e`; `master` avançado sem force push; os commits de documentação posteriores ficam só no ramo de trabalho até à próxima entrega, para não mostrar o aviso de versão nova aos separadores abertos sem necessidade).

| | Estado |
| --- | --- |
| **Produção (Vercel `umbulab/bolt2`)** | https://bolt2-lake.vercel.app — `version.json` = `ff9553e…`; bundle verificado (`client:2`, «Vai alterar», aviso de versão nova) |
| **Funções (Supabase `quihhoszhtivzwhcvnsd`)** | `ai-image` (era v2) e `ai-propose` (era v7) republicadas; `ai-admin` (v7) sem alterações, não republicada |
| **Migração** | `20261002120000_ia_financeiro_so_admin.sql` aplicada (o `dry-run` só listava esta; histórico remoto igual ao local, sem reparação) |
| **Ordem seguida** | funções → frontend → migração (ver `docs/18`, compatibilidade com separadores abertos) |

**Implementado e testado com simulador (local):**
- importação ZIP/HTML (`docs/20`);
- janela «Editar com IA»;
- imagem dentro do bloco selecionado (caso «Stationary»);
- fundo gerado (caso do cabeçalho);
- valores financeiros só para administradores;
- aviso de versão nova.

Testes: `npm run check` exit 0 (214); Playwright 78 passaram, 3 ignorados (visuais, só com rede).

**Validado no Supabase real (sem chamadas pagas):**
- `npm run test:server`: 17/17. Inclui `ai.financeiro.test.ts`, com a conta A, que não é administradora:
  - `ai_whoami` = false;
  - `ai_status_v2` sem preços;
  - `ai_usage` vazio;
  - `ai_models`/`ai_settings`/`ai_settings_audit`/`ai_provider_keys` recusados;
  - `ai-image` antiga recusada antes de reservar;
  - `ai-image` atual → `disabled`.
- `npm run test:e2e:server`: 11 passaram, 1 ignorado (piloto pago). Inclui a importação do ZIP no servidor (imagens e fundos no Storage, F5, Dashboard, template e cópia independente).

**Ainda pendente:**
- **geração real de imagens:** a geração está desativada no servidor e não há chave Google;
- validação visual do perfil de administrador no site publicado (precisa da sessão do administrador);
- piloto pago (`docs/19`).

**Para UMA geração real** (pelo administrador, no painel):
1. Em «Configurações de IA › Credenciais», guardar a chave **Google** (Gemini API) no cartão Google e usar «Testar» (sem custo).
2. Em «Geração de imagens», escolher Google / **Gemini 3.1 Flash Image** (0,067 USD por imagem), «Guardar modelo de imagens» e ativar «Geração de imagens».
3. No editor, selecionar o bloco «Stationary», «Editar com IA» e escrever «Troca a imagem por um livro de matemática.». Confirmar «Gerar imagem», rever o antes/depois e aplicar.

Custo estimado: até 0,067 USD da imagem, mais o pedido de edição (reserva máxima ≈ 0,12 USD com o Claude Sonnet 5.5; o custo real costuma ser menor). A geração só conta como validada depois deste teste.

## Atualização de 01/10/2026 · Importação de sites estáticos (ZIP e HTML/CSS)

- Implementada e testada localmente (modo local): ver `docs/20-importacao-sites-estaticos.md`.
- Sem migrações nem alterações remotas. Sem commit, push ou deploy.
- Por validar no servidor: cópia das imagens e fundos do ZIP para o Storage e referências permanentes (F5, reabrir, template, cópia).
- Correções pendentes: duplicar elementos sem perder regras da folha importada; aviso quando `!important` impede uma edição; barra contextual a tapar o botão do menu (ver `docs/20`).

## Atualização de 29/09/2026 · painel esquerdo por ferramentas (não publicado)

Trabalho **ainda sem commit** no ramo `fase-1-primeira-versao` (a produção continua em `c50ed79`).

| Área | Estado |
| --- | --- |
| Barra vertical (Adicionar, Estrutura, Imagens), painel ao lado, recolher; canvas ganha o espaço sem mudar a largura do dispositivo | implementado e testado (local) |
| Adicionar: pesquisa por nome, categorias (Estrutura, Texto, Média, Ações), destino do «+» legível e cancelável. Se o destino for eliminado ou deixar de aceitar, avisa e não insere noutro sítio | implementado e testado (local) |
| Imagens: secções «Nesta página» e «Disponíveis no workspace» (servidor) ou «Carregadas nesta sessão» (local); «Substituir» e «Inserir» separados; abrir, listar e carregar não alteram o documento | implementado; local testado; servidor **por testar** |

**Imagens carregadas e não usadas:**

- **Servidor:** o ficheiro já ficava guardado em `project-assets/<workspace>/library/`; faltava listá-lo. `SupabaseAssetStore.listLibrary` lê essa pasta (e a pasta antiga do projeto) **só em leitura**. Não precisou de migração nem de mudar caminhos, referências ou políticas: a leitura já está limitada a membros do workspace pela política existente.
- **Local:** a imagem só existe dentro do documento quando é usada; se não for usada, perde-se ao recarregar. O painel di-lo explicitamente.
  - **Proposta, por aprovar:** uma loja «assets» na base IndexedDB local, que passa para a versão 3. É uma mudança do contrato de armazenamento local, por isso não foi feita.
- **Os nomes originais dos ficheiros não são guardados** (os caminhos usam um identificador), por isso não há pesquisa por nome de imagem. Guardá-los seria outra mudança de contrato (metadados no carregamento), para decidir.

**Testes novos no Supabase real (por executar):**

- `npm run test:server`: listagem da biblioteca e isolamento (a conta B não vê as imagens do workspace de A);
- `npm run test:e2e:server`: carregar sem inserir → F5 → disponível → inserir → guardar → reabrir, com referência estável.

### Proposta de estilos globais do site (entretanto implementada, ver `docs/12-estilos-globais.md`)

Entrega própria, a aprovar. Serve para editar o **tema do site** (o que os visitantes veem) e é independente do tema Claro/Escuro/Automático da interface do Bolt IA.

- **Onde vive:** variáveis do site dentro do documento: `--bolt-*` nos templates do produto e `--gjs-t-*` nos projetos importados do Studio, que já são preservadas. Nunca os tokens `--ui-*` da interface.
- **O que se edita:** cores (primária, texto, títulos, fundo), fontes (corpo, títulos), raio e espaçamentos base, com pré-visualização no canvas.
- **Variáveis importadas:** são editadas no lugar onde já existem, sem as renomear nem normalizar. As que não forem reconhecidas ficam listadas só para leitura.
- **Histórico e gravação:** o mesmo fluxo do inspetor (um passo por alteração), gravado no documento do projeto.
- **Na barra esquerda:** entra como nova ferramenta «Estilos globais» só quando estiver pronta.

## Atualização de 29/09/2026 · Páginas e camadas (não publicado)

Trabalho **sem commit** no ramo `fase-1-primeira-versao`. Análise e decisões em `docs/11-paginas.md`.

- **O que foi feito:**
  - várias páginas por projeto: criar, mudar o nome, duplicar, eliminar e escolher a inicial;
  - cada página mostra as suas camadas na mesma árvore;
  - ligações entre páginas por `/slug`.
- **Compatibilidade:** sem migração. Projetos e templates antigos abrem como uma página. As importações mantêm todas as páginas e os respetivos nomes.
- **Correção incluída:** ao duplicar (página ou elemento), as regras CSS compostas que referem ids passam também para a cópia. Antes, o menu móvel copiado não abria.

### Fecho de Páginas e camadas (29/09/2026)

| Ponto | Implementado | Testado localmente | Validado no Supabase |
| --- | --- | --- | --- |
| Pré-visualização: ligações entre páginas, «Voltar», destino inexistente, âncoras, externos | sim | sim (unitário e E2E) | não se aplica |
| Correção: âncora na pré-visualização saía do documento; agora desloca dentro da página | sim | sim (E2E) | não se aplica |
| Slugs únicos e estáveis; colisão com `/inicio` antigo; importação com nomes repetidos | sim | sim (unitário e E2E) | pendente (percurso abaixo) |
| Referências internas das cópias (`#id`, `for`, ARIA); externas preservadas | sim | sim (unitário e E2E) | não se aplica |
| Aviso de desfazer/refazer noutra página, com «Ver página» sem passo | sim | sim (unitário e E2E) | não se aplica |
| Várias páginas no servidor (gravação automática, F5, Dashboard, template) | teste escrito | não se aplica | **pendente**: `npm run test:e2e:server` |

- **Sondas temporárias:**
  - `tests/unit/zz-pages-probe.test.ts` foi removido e não existe.
  - Não ficaram outras sondas desta tarefa no projeto.
- **Testes permanentes mantidos:**
  - `tests/unit/pages.test.ts`;
  - `tests/e2e/pages.spec.ts`;
  - `tests/e2e/left-panel.spec.ts`;
  - o novo percurso em `tests/e2e-server/server.spec.ts`.

### Estado dos testes no Supabase real (pendentes, nenhum executado pelo agente)

| Comando | Casos por executar |
| --- | --- |
| `npm run test:server` | biblioteca de templates e registo de importações (2); listagem e isolamento da biblioteca de imagens (1) |
| `npm run test:e2e:server` | imagem de fundo no inspetor (1); imagem carregada sem inserir → F5 → disponível (1); **percurso de várias páginas** (1); **estilos globais** (1) |

O percurso de várias páginas está em `tests/e2e-server/server.spec.ts`, no teste «várias páginas: …». Cobre:

- criar a segunda página e mudar-lhe o nome, com gravação automática;
- conteúdo, estilo (padding) e imagem na segunda página, com gravação automática, sem «Guardar»;
- definir a página inicial;
- reabrir pela Dashboard e confirmar a ordem, a página inicial, os slugs, o texto, o estilo e a imagem assinada;
- no `project_data`: slugs, `type: main` e a referência `bolt-asset:` sem URL assinado;
- guardar como template e criar uma cópia pela biblioteca, com as duas páginas;
- confirmar que editar a cópia não altera o original.

Usa as contas de teste e a limpeza existentes. Os templates criados pelo teste são arquivados no fim (só esses, pelo nome).

O percurso de estilos globais está no teste «estilos globais: …». Cobre:

- abrir o painel sem gravar nada;
- mudar a cor dos títulos e a fonte dos títulos, cada uma com gravação automática;
- F5 e reabrir pela Dashboard;
- confirmar as variáveis no `project_data`;
- guardar como template;
- confirmar que uma cópia editada não altera o template nem o original.

Os templates criados pelo teste são arquivados pela mesma limpeza.

## Atualização de 29/09/2026 · Estilos globais (não publicado)

Trabalho **sem commit**. Análise, decisões e limitações em `docs/12-estilos-globais.md`.

| Ponto | Implementado | Testado localmente | Validado no Supabase |
| --- | --- | --- | --- |
| Ferramenta «Estilos globais» (paleta) com Cores, Tipografia e Elementos; aviso «afetam todas as páginas» | sim | sim (E2E) | não se aplica |
| Abrir o painel não altera o documento (Nimbus, Studio, Elementor) | sim | sim (unitário e E2E) | pendente (percurso remoto) |
| Variáveis do Studio editadas no registo, com a ligação, o nome e o âmbito preservados | sim | sim (unitário e E2E) | não se aplica |
| Cor e fonte partilhadas com efeito em duas páginas; valor próprio e regras de telemóvel preservados | sim | sim (unitário e E2E, nas 3 origens) | não se aplica |
| Aviso no inspetor quando uma regra própria ou mais específica prevalece | sim | sim (E2E) | não se aplica |
| «Criar estilos globais» explícito em projetos sem configuração (Elementor) | sim | sim (unitário e E2E) | não se aplica |
| Desfazer/refazer (um passo por arrasto de cor); «Repor» e «Repor tudo» sem apagar regras | sim | sim (unitário e E2E) | não se aplica |
| Guardar, F5, reabrir; template e cópia independente | sim | sim (E2E, modo local) | **teste escrito, por executar**: `npm run test:e2e:server` |
| Menus e carrosséis continuam funcionais | sim | sim (E2E, amostra Studio) | não se aplica |
| Correção: páginas novas ou duplicadas herdam as classes do corpo (ex.: `gjs-t-body`) | sim | sim (unitário e E2E) | não se aplica |
| Correção: Escape fecha a pré-visualização mesmo com o foco no iframe, respeita diálogos por cima e devolve o foco ao botão | sim | sim (E2E) | não se aplica |

- **Sondas temporárias:** as sondas desta tarefa foram removidas (`zz-global-probe.test.ts`, `zz-debug-temp.spec.ts` e `zz-capturas-temp.spec.ts`).
- **Testes permanentes novos:**
  - `tests/unit/globalStyles.test.ts`;
  - `tests/e2e/global-styles.spec.ts`;
  - o percurso remoto em `tests/e2e-server/server.spec.ts`.

### Refinamento visual (29/09/2026)

Cada campo mostra primeiro um nome amigável (ex.: «Cor principal», «Fonte usada nos títulos»). A variável, o seletor e o nome original do ficheiro ficam numa linha secundária. Os campos ligados a variáveis mostram «Segue «…»» em vez de `var(--…)`. As associações não mudaram. Está coberto pelos testes unitários e E2E.

### Próximas entregas

1. **Assistente IA** (plano em `docs/09`, com os pontos de revisão). As opções de fornecedor serão apresentadas antes de escolher, com o servidor a guardar a chave. Não há nada implementado.

## Atualização de 29/09/2026 · Assistente IA, versão 1 (não publicado, não ativado)

Trabalho **sem commit**. Detalhes em `docs/14-assistente-ia-v1.md`; fornecedor, custos revistos e decisões em `docs/13`.

- **Implementado e testado localmente, com o simulador:**
  - o painel «Assistente IA» sobre o elemento selecionado (texto, ligação, nível do título, estilos próprios por dispositivo);
  - o contrato de operações, o contexto com herança e variáveis, e a validação em três pontos;
  - a versão local do documento, o antes/depois, a confirmação, o desfazer único e a falha restaurada sem tocar no histórico.
- **Escrito para revisão, não aplicado:**
  - a função `ai-propose`, com o adaptador Anthropic e o modelo `claude-sonnet-5-5` como candidato;
  - a migração `ai_usage`, com reserva atómica, limites e orçamento.
- **Sem chaves, sem chamadas pagas.**
- **Correção incluída (erro anterior, encontrado nos testes):** desfazer uma mudança de texto num título de template deixava o canvas vazio.
  - Causa: `setText` deixava o texto antigo em `content`.
  - Agora é limpo no mesmo passo, o que também evita que o texto antigo e o novo coexistam na exportação.
  - Há um teste de regressão em `tests/e2e/editor-direct.spec.ts`.
- **Pendente:**
  - aplicar a migração;
  - publicar a função;
  - configurar a chave;
  - executar `BOLT_AI_PILOT=1 npm run test:ai-pilot`;
  - decidir os limites e ativar `VITE_AI_ASSISTANT=server`.

## Atualização de 29/09/2026 · Estabilização antes da ativação (sem novas capacidades)

- **Antes/depois do assistente** com a largura e o breakpoint do dispositivo escolhido:
  - só a escala muda; antes e depois têm as mesmas dimensões;
  - há «Ampliar pré-visualização»;
  - validado no computador e no telemóvel: a prévia corresponde ao resultado aplicado.
- **Falha real de texto — investigada e corrigida na aplicação:**
  - **Separação:**
    - os erros «UNKNOWN: open …trace» eram bloqueios do OneDrive sobre os artefactos do Playwright;
    - a asserção «Cópia editada» + texto antigo, ou texto «rodado» («ia editadaCóp»), era um erro real.
  - **Reprodução:** 5 falhas em 24 repetições com 8 workers.
  - **Causa:** a gravação automática, agendada por uma alteração anterior, disparava a meio da escrita. Ler o documento (`getProjectData` → `storeData` do GrapesJS) força `sync:content` do texto em edição e reconstrói o elemento, e o cursor saltava para o início.
  - **Correção:** a gravação automática espera pelo fim da edição de texto (`rte:disable`) e volta a agendar. A gravação explícita (botão, Ctrl+S) mantém-se. O painel do assistente também não lê o documento durante a edição.
  - **Resultado:** 24/24 com a mesma carga. Há um teste de regressão novo («escrita lenta com gravação automática pendente»), que **falha sem a correção** e passa com ela. No teste antigo, a espera passou a ser por um estado observável (foco no elemento em edição), sem atrasos nem asserções mais fracas.
- **Artefactos do Playwright** (traces nas falhas, vídeos, relatório) em `%TEMP%\bolt-ia-playwright`, fora do OneDrive. Pode mudar-se com `BOLT_PW_ARTIFACTS`.
- **Orçamento revisto** (`docs/14`):
  - a reserva passou a ter um limite com condições explícitas e verificadas na bateria real;
  - repetições reservadas antes;
  - consumo desconhecido conta pelo máximo;
  - pedidos duplicados recusados antes da chamada;
  - reservas sem acerto expiram pelo valor reservado;
  - preços por modelo obrigatórios;
  - interruptor `AI_ENABLED`.
- **Ativação:** a sequência para este projeto, em PowerShell, está em `docs/15-ativacao-piloto-ia.md`. Nada foi executado.
- **Instabilidade restante da suíte local, resolvida pela configuração:**
  - Com os artefactos fora do OneDrive, os traces das falhas passaram a ser gravados. Mostraram que as falhas restantes eram **tempos totais** de percursos longos (30 s por teste) e não asserções nem esperas presas.
  - Os testes afetados mudavam de corrida para corrida.
  - **Causa:** 8 workers em paralelo, mais o servidor Vite e o OneDrive na mesma máquina.
  - **Correção:** `workers: 4` em `playwright.config.ts`. Não houve alterações a testes nem a asserções (as tentativas de alargar tempos por teste foram revertidas).
  - **Resultado:** duas corridas completas seguidas, 58 passaram e 0 falharam.
- **Nenhuma migração foi aplicada nem nenhuma função publicada.**
  - A frase de trabalho «Now I'll apply that migration» estava errada: o passo seguinte foi editar o **ficheiro local** da migração (nunca aplicado) e executá-lo só no PGlite em memória.
  - Não houve nenhum comando `supabase` (CLI), `psql` nem SQL remoto, e a CLI nunca foi ligada a um projeto (não existe `supabase/.temp`).
  - O Supabase remoto não foi alterado.
- **Próxima entrega proposta:** Configurações de IA pela interface (administradores, chave no Vault, fonte única de configuração, auditoria). Ver `docs/16-configuracoes-ia-proposta.md`. Nada implementado.

## Atualização de 30/09/2026 · Configurações de IA (implementado localmente; nada aplicado)

- **Migração de consumo:** continua **só no código**. Não foi aplicada no Supabase remoto; confirmado sem comandos remotos.
- **Painel «Configurações de IA»:**
  - configuração central, só para administradores da plataforma;
  - chave no Vault;
  - teste de ligação sem custo;
  - ativar e desativar;
  - limites e orçamento;
  - consumo confirmado, estimado e reservado;
  - registo de alterações.
- **Detalhes e estado dos testes:** `docs/16`. **Ativação:** `docs/15`, que já não passa a chave pelo terminal.
- **Mudanças nas migrações pendentes** (nenhuma aplicada):
  - `ai_reserve` passou para `20260930120000` e lê a configuração central;
  - `ai_usage` ganhou o instantâneo de modelo e preços e o custo confirmado/desconhecido separado.
- **Teste do piloto real corrigido:**
  - Nimbus escolhido pelo nome;
  - `var(--bolt-primary)` confirmado no documento gravado;
  - mudar a cor global faz o título acompanhar;
  - reabertura pela Dashboard;
  - confirmação prévia de que o assistente está ativo (`ai_status`).
  - Há um espelho `[simulado]` do mesmo percurso no E2E local.

## Próximo passo para amanhã

1. Executar `npm run test:server` e `npm run test:e2e:server`, e registar aqui os resultados. Estes testes validam a biblioteca de templates, o registo de importações, a imagem de fundo, a listagem e o isolamento das imagens do workspace, o percurso de várias páginas e a persistência dos estilos globais, no Supabase real.
2. Rever a função `ai-propose` e a migração `ai_usage`. Se autorizar, seguir `docs/15-ativacao-piloto-ia.md` (aplicar só a nova migração, segredos, função, testes do Supabase, bateria real e percurso real pela interface). Nada foi contratado nem configurado.

## Atualização de 30/09/2026 · Estado da publicação (correção)

- A publicação autorizada no fim de 29/09 (commit, push, Vercel) **foi interrompida e não aconteceu**. Produção e ramo de trabalho continuaram em `6744483` até aos commits de 30/09.
- As funções `ai-propose` e `ai-admin` no Supabase são a versão de 29/09 (republicadas pelo utilizador), que até 30/09 não estava no Git.
- Plano de publicação compatível, recuperação e piloto: `docs/19-publicacao-e-piloto.md`.

## Atualização de 30/09/2026 · Assistente IA v2: edição completa (não publicado)

Resumo do dia anterior em `docs/17-resumo-2026-09-29.md`. Detalhe desta entrega em `docs/18-assistente-ia-v2.md`.

- **Implementado e testado localmente (simuladores):**
  - atalho «Editar com IA» na barra do elemento;
  - fornecedores Anthropic, OpenAI e Google Gemini, com chaves independentes e imagens configuradas à parte;
  - âmbitos elemento, secção, página e site inteiro (pedidos grandes em partes);
  - imagens e fundos: escolher, carregar ou gerar com confirmação do custo;
  - estrutura: inserir, mover, duplicar e eliminar;
  - esclarecimento em vez de adivinhar;
  - um só desfazer, mesmo em várias páginas.
- **Por fazer (com autorização):**
  - aplicar a migração `20261001120000_ia_fornecedores.sql`;
  - republicar `ai-propose` e `ai-admin` e publicar `ai-image`;
  - deploy do frontend, em conjunto com as funções (contrato v2).
- **Por validar (pago):** a geração real com cada fornecedor e a geração real de imagens.
