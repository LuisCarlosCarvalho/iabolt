# Páginas e camadas · compatibilidade e decisões (29/09/2026)

## Análise antes de alterar

- **Motor (GrapesJS 0.23.6):** tem gestor de páginas (`editor.Pages`: `add`, `remove`, `select`, `move`, `getMain`) e cada página tem a sua moldura no canvas.
  - As regras CSS são partilhadas por todas as páginas. Como o Bolt estiliza por `#id`, os ids têm de ser únicos no projeto inteiro.
- **Documento guardado:** o `project_data` já é `{ pages: [{ id, name?, type?, frames: [...] }], styles, … }`.
  - O esquema do Bolt aceita várias páginas e mantém os campos extra de cada uma.
  - A função do servidor (`validate_project_data`) só exige pelo menos uma página.
- **Projetos e templates existentes:** têm exatamente uma página, sem nome e com `type: "main"`.
- **Importações:**
  - GrapesJS/Studio: o adaptador converte **todas** as páginas do ficheiro e mantém `id` e `name` (a amostra tem uma, «Home»);
  - Elementor: produz uma página.
  - Há um teste unitário com um ficheiro GrapesJS de duas páginas.
- **Experiência no motor (sonda descartável):**
  - `name` e campos próprios de página (ex.: `slug`) são gravados e voltam ao reabrir;
  - criar e eliminar páginas entram no histórico (desfazer/refazer repõe a página com o conteúdo);
  - **selecionar** uma página também entraria no histórico, pelo que o Bolt muda de página sem registar;
  - criar ou eliminar páginas **não** emite o evento `update`, pelo que a gravação passou a escutar também `page:add`, `page:remove` e `page:update`;
  - clonar copia as regras `#id` (com breakpoints) com ids novos, mas **não** as regras compostas que referem ids (ver abaixo);
  - o motor junta num só passo de desfazer o que acontece no mesmo ciclo de eventos. Cada ação da interface é um passo; uma ação composta (eliminar a inicial e promover a seguinte) também é um passo.

## Solução (sem migração)

- **Base de dados:** não há migração nem alteração ao Supabase. O formato do documento já suporta várias páginas; mantém-se a via única de gravação (`SaveQueue` → repositório).
- **Página inicial:** é a primeira da lista **e** a marcada `type: "main"`, que andam sempre juntas. As pré-visualizações e miniaturas mostram a inicial. «Definir como inicial» move a página para o início e transfere a marca.
- **Nome e caminho:** cada página tem `name` e um `slug` estável.
  - Projetos antigos: o nome mostrado é «Página inicial» e o caminho `/inicio`.
  - Nome e slug **só são gravados na primeira ação sobre páginas**, nunca por abrir o projeto.
- **Mudar o nome não muda o slug.**
- **Eliminar:**
  - nunca a última página;
  - se for a inicial, o diálogo diz qual passa a ser a inicial (a seguinte);
  - o diálogo diz quantas ligações apontam para a página e ficam sem destino;
  - desfazer repõe a página.
- **Duplicar:**
  - a cópia fica a seguir à origem, com ids novos e únicos em todo o projeto;
  - as regras `#id` são copiadas pelo motor, e as compostas que referem os ids (ex.: `#menu[data-bolt-menu-open] #itens`, `::before`, CSS importado `#el .swiper-wrapper`) são copiadas pelo Bolt com os ids trocados;
  - a mesma correção aplica-se a «Duplicar» um elemento, que tinha este defeito;
  - as regras originais não são alteradas.
- **Mudar de página:** não altera o documento nem cria passos de desfazer (testado).

## Ligações entre páginas (comportamento definido)

- Uma ligação para uma página do projeto usa `href="/<slug>"`. Escolhe-se no painel de propriedades da ligação ou do botão, em «Página do projeto».
- A página inicial também tem slug. «Definir como inicial» não parte ligações.
- Mudar o nome da página não parte ligações, porque o slug é fixo.
- Eliminar uma página deixa as ligações para ela com o mesmo `href`, sem destino. O diálogo de eliminação diz quantas são.
- No canvas, clicar numa ligação seleciona-a para edição. Não navega.
- **Pré-visualização** (botão «Pré-visualizar»; sem publicar):
  - mostra as páginas do projeto num iframe isolado (sandbox, sem acesso à aplicação);
  - uma ligação `/<slug>` mostra essa página na própria pré-visualização. `/` mostra a inicial;
  - «Voltar» regressa à página anterior;
  - um destino que não é página do projeto mostra o aviso «Destino inexistente» e fica na página atual. Nunca abre rotas do Bolt IA;
  - âncoras `#id` deslocam dentro da página;
  - endereços externos mantêm o comportamento habitual.
  - Tecnicamente, o runtime envia `{bolt:'navigate', href}` à janela-mãe, que só aceita mensagens do próprio iframe.
- A navegação entre páginas publicadas fica para a fase de publicação, que servirá cada página em `/<slug>` e a inicial também em `/`.

## Identidade e referências ao duplicar

- **Slugs:**
  - são únicos ao criar, duplicar e importar (nomes repetidos dão `home`, `home-2`, …);
  - não mudam quando se muda o nome da página;
  - numa página de um projeto antigo, o slug implícito `inicio` conta como ocupado. Uma nova página «Início» recebe `inicio-2`.
- **Cópias (elemento ou página):** cada elemento copiado tem um id novo. As referências a elementos da própria cópia passam para os novos ids:
  - `href="#id"`;
  - `for`, `form`, `list`, `aria-activedescendant`;
  - listas `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-owns`, `aria-flowto`, `aria-details`, `aria-errormessage` e `headers`.
- A substituição é feita atributo a atributo e token a token, só com os ids copiados. Não há substituição de texto no documento nem no CSS.
- As referências a elementos fora da cópia ficam iguais.
- As regras CSS são clonadas como modelos (com media e estado), não reescritas como texto.

## Onde está

- **Motor:**
  - `src/engine/pages.ts`: operações e convenções;
  - `src/engine/cloneRules.ts`: cópia das regras compostas.
- **Interface:** `src/editor/PagesPanel.tsx`, dentro da ferramenta «Páginas e camadas». A árvore é a mesma (`LayersPanel`) e mostra a página atual.
- **Testes:**
  - `tests/unit/pages.test.ts`: compatibilidade, operações, histórico, eventos, gravação e reabertura, imagens, importação com duas páginas, regras compostas;
  - `tests/e2e/pages.spec.ts`: percurso completo no browser, incluindo template e as duas importações.

## Limitações

- Desfazer ou refazer uma alteração feita noutra página não muda a página à vista. Aparece um aviso com o nome da página e a ação «Ver página». Essa ação não cria passo no histórico.
- Regras de CSS de elementos eliminados (numa página ou com a página) ficam na folha, como já acontecia ao eliminar elementos. Não afetam o aspeto.
- Sem SEO por página (título, descrição) nesta entrega.
