# Importação e biblioteca de templates · análise das amostras e entrega

Amostras (só leitura, não alteradas): `amostra/projeto-teste-2026-09-16-091529.grapesjs` e `amostra/[Modelo] [Elementor] Carla Santos.json`. O formato foi identificado **pelo conteúdo**, não pela extensão.

Estados usados neste documento: **implementado** (código feito), **testado** (com teste automático que passou), **parcial** (funciona com limitações descritas), **pendente** (por fazer).

## 1. As amostras

### GrapesJS Studio (`.grapesjs`, 156 KB)

- Exportação da app GrapesJS Studio: `custom.projectType: "web"`, plugins do Studio, `generator: GrapesJS Studio`. Uma página («Home»), 474 componentes, 416 regras CSS (breakpoints de 992, 768 e 480 px), 26 variáveis de tema (`globalStyles`) usadas em 117 valores.
- Fontes: Poppins e Barlow (Google Fonts, licença SIL Open Font License).
- Imagens: 44 em `cdn.grapesjs.com` (com CORS aberto, logo copiáveis pelo browser) e 1 recurso com `src` vazio (descartado e reportado).
- Tipos próprios do Studio: `heading`, `section`, `container`, `flex-row/column`, `linkBox`, `icon`, `navbar*`, `swiper*`, `input`.

### Elementor (`.json`, 137 KB)

- `type: page`, `version: "0.4"`, só containers flexbox (50) e widgets: heading 19, image 21, text-editor 21, image-box 1, button 4, image-carousel 4, icon-list 8, nested-accordion 1, html 1 (só `<style>`).
- Fonte: Bricolage Grotesque (Google Fonts, OFL).
- Imagens: 43 em `daniel-machado.site`, **domínio inexistente (NXDOMAIN)**: não carregam em lado nenhum; 1 em `joanapinho.pt`, que carrega mas **não permite cópia pelo browser (sem CORS)** e cujos direitos não estão verificados. Nenhuma foi substituída.

### Títulos: investigação da semântica original

O ficheiro Studio **não tem nenhum `h1`**. Tem 26 títulos com nível (h2, h4, h5, h6) e **2 títulos sem nível**: ambos são o logótipo «NexGame» (no menu e no rodapé), dentro de blocos de ligação. O título principal visível do hero («Unleash the Power of Competitive Gaming») é um `h2` com a classe de estilo `gjs-t-h1`.

Decisão: os 2 sem nível recebem o **padrão do próprio tipo `heading` do Studio (`h1`)**, que é o que o Studio produz para eles, e o relatório assinala a ambiguidade («2 título(s) sem nível… revisto no relatório»). **Não se criou nenhum `h1` artificial** e o hero continua `h2`. No editor, o painel tem «Tipo de texto» (Título 1–6, Parágrafo), para o utilizador corrigir a hierarquia se quiser (por exemplo, promover o título do hero e rebaixar os logótipos).

## 2. O que foi entregue

Percurso: **Importar ficheiro → analisar compatibilidade → confirmar → editar → guardar → reabrir → guardar como template → criar outro projeto independente.**

| Área | Estado |
| --- | --- |
| Deteção pelo conteúdo (Bolt, GrapesJS/Studio, Elementor, HTML, ZIP, desconhecido) | implementado e testado |
| Adaptador GrapesJS / Studio | implementado e testado com a amostra (unitário e E2E) |
| Adaptador Elementor (containers e os widgets presentes na amostra) | implementado e testado com a amostra (unitário e E2E) |
| HTML/CSS e ZIP | **pendente**: detetados e recusados com mensagem clara; não aparecem como disponíveis |
| Relatório antes de confirmar (preservado / convertido / parcial / não suportado, imagens, fontes, notas, removido por segurança) | implementado e testado |
| Pré-visualização isolada (computador 1280 px, tablet 820, telemóvel 390) | implementado e testado |
| Confirmação obrigatória de importação parcial; autorização explícita para copiar imagens | implementado e testado |
| Original guardado para recuperação | implementado e testado (local); servidor testado em PGlite |
| Menu móvel e carrossel funcionais (runtime próprio) | implementado e testado (prévia e editor) |
| Formulário (newsletter): estrutura e campos editáveis; aviso de «sem envio» no editor e na prévia | implementado e testado |
| Biblioteca de templates: guardar como template, versões imutáveis, nova versão, criar projeto de uma versão, retirar | implementado e testado (local E2E, PGlite); servidor **por testar no Supabase real** (depende da migração) |

### Arquitetura

- `src/importers/pipeline.ts`: pipeline único, `detectFormat` → adaptador → `normalize` (carrega no motor Bolt, garante ids, valida com zod) → imagens e fontes → relatório. `completeImport` só copia imagens na confirmação.
- Adaptadores isolados: `src/importers/grapesjs/studio.ts`, `src/importers/elementor/` (`settings.ts` para definições responsivas, `elementor.ts` para containers e widgets). HTML/CSS e ZIP entram como novos adaptadores com o mesmo contrato (`AdapterResult`: JSON de projeto + relatório).
- Os adaptadores reconhecem **estruturas** (tipos, chaves, relações), não textos nem ids das amostras. O menu do Studio, por exemplo, é identificado pelo tipo `navbar` e pelo contentor que tem o `navbar-nav-menu`.
- Resultado: sempre JSON de projeto do motor dentro do `BoltDocument`. Não há outro modelo de página.

### Fidelidade: o que é preservado e o que é convertido

- **Hierarquia, textos, classes e regras CSS** passam intactos. Regras `#id` continuam editáveis no painel.
- **Layout flex original preservado**: `flex-row`/`flex-column` passam a `bolt-row`/`bolt-col`, que **não acrescentam estilos**. Nada é convertido para grid.
- **Semântica**: `section` → `<section>`; `linkBox` → `<a>` com os filhos (antes saía `<div href>`, ligação partida); títulos mantêm o nível.
- **Variáveis de tema do Studio**: resolvidas para valores em `:root` (`--gjs-t-color-primary`, …) e a dataSource preservada. **Limitação:** o Bolt ainda não tem um editor de variáveis de tema; mudar uma cor do tema faz-se elemento a elemento.
- **Fontes**: `@font-face` gerados a partir da declaração do projeto (Studio) ou pedidos ao Google Fonts (Elementor), ambos com licença OFL, carregados no canvas, na prévia e nas miniaturas. Sem rede, o relatório diz «não carregada».
- **Elementor**: containers boxed (caixa interior com largura máxima), direção, alinhamento, espaçamentos e fundos por breakpoint (1366/1024/767 px); widgets convertidos para componentes Bolt, mantendo as classes do Elementor (`elementor-heading-title`, `elementor-button`, …). O CSS personalizado passa com `selector` trocado pelo `#id` do elemento; `@keyframes` preservados.
- **Carrosséis**: configuração convertida (slides por largura, espaço, ciclo, avanço automático, movimento contínuo, sentido inverso, pausa ao passar o rato). No Elementor, um valor de «Largura» guardado num container «boxed» é ignorado, como no Elementor, e o relatório diz isso.
- **Acordeão**: `<details>/<summary>` nativo (funciona sem script).

Conversões que limitam a edição futura (também listadas no relatório de cada importação):

1. Ícones do Studio ficam como SVG embutido: a ligação ao catálogo de ícones do Studio perde-se.
2. Definições de plugins de terceiros do Elementor (`eael_`, `premium_`, …) não têm equivalente: são ignoradas e contadas.
3. O widget `html` do Elementor só mantém CSS; qualquer script é removido.
4. Campos de formulário: sem integração de envio (ver abaixo).

### Segurança

- **Nenhum script do ficheiro é executado.** Na importação são removidos `<script>`, propriedades `script` do GrapesJS, manipuladores `on*` e URLs `javascript:`, e ficam listados em «Removido por segurança».
- O único script no canvas e na prévia é o runtime próprio (`public/assets/runtime/bolt-runtime.js`, sem dependências), que só lê atributos `data-bolt-*`.
- A prévia corre num `iframe sandbox="allow-scripts"` **sem** `allow-same-origin` (origem opaca, sem acesso à aplicação), com uma Content-Security-Policy que só autoriza esse ficheiro, e `form-action 'none'`.

### Formulário sem integração

A newsletter do Studio mantém a estrutura: campo `<input>` e botão de subscrição. O campo é editável (texto de exemplo, tipo, nome, obrigatório). O editor mostra uma faixa: «Esta página tem campos de formulário sem integração de envio configurada: nada é enviado nem subscrito». O painel do campo repete o aviso, e a prévia mostra «Formulário sem envio configurado». **Nunca é mostrado sucesso de subscrição**, e a prévia bloqueia o envio.

### Imagens: falhas, autorização e posse

- Cada imagem é verificada na análise, e o relatório mostra o estado de cada uma com a causa:
  - **pode ser copiada**;
  - **fica no endereço original**: o site não permite cópia (sem CORS), a imagem é SVG, ou a cópia não foi autorizada;
  - **em falta**: site ou ficheiro inexistente;
  - **recusada**: tipo não suportado ou mais de 8 MB.
- As imagens em falta ficam assinaladas a vermelho na prévia. **Nunca há substituição silenciosa.**
- **Autorização:** as imagens só são copiadas se o utilizador marcar «Tenho autorização para usar as N imagem(ns)…». Sem isso ficam no endereço original, e o relatório diz porquê. Não há restrições identificáveis nos ficheiros (nem metadados de direitos, nem créditos) e os direitos não são verificáveis automaticamente. Por isso a decisão é explícita, em cada importação.
  - Nas amostras: as 44 imagens do Studio (`cdn.grapesjs.com`) são copiáveis se o utilizador confirmar.
  - As 43 do Elementor **não podem ser copiadas** porque o domínio não existe.
  - A do `joanapinho.pt` **não pode ser copiada** pelo browser (sem CORS) e tem direitos por verificar. Fica no endereço original.
- **Importação parcial** (imagens por resolver, ou elementos parciais ou não suportados): o botão só fica ativo depois de o utilizador o confirmar. O ficheiro original fica guardado.
- **Posse e duração:**
  - no servidor, cada imagem pertence ao **workspace** (`project-assets/<workspace>/library/<uuid>`), não a um projeto;
  - o documento guarda uma referência durável (`bolt-asset:<caminho>`). URLs assinados só servem para mostrar e nunca são gravados;
  - arquivar ou remover um projeto não apaga imagens, por isso templates e projetos derivados continuam a mostrá-las;
  - com a nova migração, só o **owner** do workspace pode apagar ficheiros, para evitar que um editor parta templates;
  - em modo local, as imagens copiadas ficam embutidas no documento (data URL), e cada cópia é independente.

### Biblioteca de templates

- **Guardar como template** (editor): cria um template com a versão 1, a partir do estado atual e com referências duráveis.
- Se o projeto veio de um template da equipa, é possível **acrescentar uma versão** (controlo otimista: se entretanto outra pessoa guardou, nada é substituído e o utilizador é avisado).
- As versões são **imutáveis**: no servidor, um trigger impede alterá-las mesmo por funções privilegiadas.
- **Criar projeto a partir de um template** (página Templates → «Templates da equipa») copia a versão escolhida. O projeto fica independente, com `templateId = team:<id>@<versão>` apenas informativo.
- Editar o projeto derivado não altera o template, e editar o projeto de origem também não. Ambos foram provados em E2E.
- **Retirar** um template esconde-o da biblioteca sem apagar versões.

## 3. Validação

| Verificação | Resultado |
| --- | --- |
| `npm run check` (typecheck, lint, testes unitários e de base de dados, build, `git diff --check`) | todos exit 0; 75 testes |
| Unitários dos adaptadores com as duas amostras (`tests/unit/importers.test.ts`) | 11/11 |
| Biblioteca local (`tests/unit/templateLibrary.test.ts`), incluindo a atualização da base local v1 → v2 sem perder projetos | 7/7 |
| Migração em PGlite (`tests/db/db.rls.test.ts`): versões imutáveis, conflito, isolamento entre workspaces, anónimo, registo de importação, só o owner apaga imagens | 14/14 (5 novos) |
| E2E local (`npx playwright test`) | 20 passaram (16 anteriores + 4 novos), 2 ignorados (captura visual sob pedido) |
| Captura visual com rede real (`BOLT_VISUAL=1 npx playwright test tests/e2e/import.visual.spec.ts`) | 2/2 |

Os E2E novos (`tests/e2e/import.spec.ts`) cobrem:

- **Studio**, o percurso completo:
  - relatório com a ambiguidade dos títulos;
  - prévia com runtime (3 carrosséis com 3/4/3 slides à largura de 1280 px) e menu móvel a abrir a 390 px;
  - confirmação e editor com 10 `<section>` e zero `<div href>`;
  - edição de título, imagem e campo;
  - menu móvel no editor;
  - guardar, recarregar e confirmar tudo;
  - nenhuma imagem dependente do CDN de origem;
  - guardar como template, criar um projeto derivado e editá-lo;
  - novo projeto a partir do template com o conteúdo da versão 1, e projeto de origem intacto;
  - original registado.
- **Elementor**:
  - mais de 10 imagens assinaladas em falta;
  - confirmação de importação parcial obrigatória;
  - acordeão presente;
  - carrossel contínuo em movimento;
  - editar, guardar e reabrir;
  - template e projeto derivado independente.
- **Versões**: a versão 2 é criada a partir de um projeto derivado, a 1 continua disponível e com o conteúdo original.
- **Erros**: HTML (ainda não suportado) e JSON desconhecido dão erro claro sem criar projeto.

**Comparação visual** (capturas guardadas em `test-results/import.visual-*`):

- **Studio**: a página convertida mostra o menu completo a 1280 px, as fontes Barlow e Poppins, as imagens, os cartões e carrosséis lado a lado, os testemunhos com setas e o rodapé. A 390 px o menu fecha, e o botão abre-o com as ligações e «Join Now».
  - A referência crua (JSON original no GrapesJS Core, com o CSS do ficheiro e sem os plugins do Studio) mostra os slides empilhados em tamanho total e setas gigantes. Isto confirma que o comportamento de carrossel vem do runtime e não do CSS.
  - **Limitação honesta:** a renderização original do Studio (SDK comercial) não está disponível aqui. A comparação foi feita contra a estrutura e o CSS do próprio ficheiro, não contra uma captura do Studio.
- **Elementor**: textos, cores, tipografia (Bricolage Grotesque), preços, acordeão de perguntas e secções com fundo em toda a largura. Todas as imagens aparecem como em falta, porque o site de origem não existe. **Não foi possível comparar com o site original.**
  - Durante esta comparação apareceram dois erros de conversão, corrigidos e cobertos por teste:
    - os carrosséis ficavam com largura 0;
    - um container «boxed» aplicava a «Largura» à caixa exterior.

## 4. Pendente e limitações conhecidas

- **Servidor:** a migração `20260928150000_biblioteca_templates.sql` tem de ser aplicada por si (ver `docs/07`, passo 2). Depois disso é preciso correr `npm run test:server`, que inclui 2 testes novos da biblioteca, e `npm run test:e2e:server`. Até lá, a biblioteca e o registo de importações em modo servidor não estão provados no Supabase real.
- HTML/CSS e ZIP: por implementar.
- Editor de variáveis de tema: por implementar (as variáveis são preservadas, mas editam-se elemento a elemento).
- Formulários: sem integração de envio.
- Aviso de desenvolvimento: o `postcss` (usado para ler CSS) gera avisos «module externalized» na consola do Vite em modo dev. Não afetam o funcionamento nem o build.
- O bundle principal passou os 500 kB (aviso do Vite). Dividir o código (importadores e editor em carregamento diferido) fica para a fase seguinte.
