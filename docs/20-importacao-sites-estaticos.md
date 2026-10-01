# Importação de sites estáticos (ZIP e HTML/CSS) · 01/10/2026

## Estado

| | Estado |
| --- | --- |
| **Implementado** | Leitor ZIP próprio, páginas, CSS literal por página, recursos locais, dependências externas, comportamentos dos scripts no runtime, mapa incorporado, relatório, pré-visualização em 3 larguras, HTML avulso com ficheiros em falta, duplicar página importada (corrigido). |
| **Testado (local)** | Unitários (17, `tests/unit/staticImport.test.ts`), E2E sem rede (2, `tests/e2e/import-static.spec.ts`), comparação visual com rede real (1, `tests/e2e/import-static.visual.spec.ts`, `BOLT_VISUAL=1`), regressões: suite completa. |
| **Validado no servidor (Supabase)** | **Pendente.** Os testes correram em modo local (IndexedDB). A cópia das imagens e dos fundos para o Storage usa a mesma via das outras importações (`store.upload`), mas **não foi exercitada** com esta importação: as referências permanentes (`bolt-asset:`) depois de F5, ao reabrir, no template e na cópia independente estão por verificar no servidor. |
| **Não validado** | O mapa dentro do iframe isolado da pré-visualização da importação (ver «Mapa»). Os comportamentos do JavaScript original face aos do runtime não foram comparados visualmente (a comparação foi feita com o JavaScript original desligado). |
| **Publicado** | **Não.** Nada foi enviado para o Git nem para a Vercel. |

Nenhuma alteração remota é necessária: a tabela `import_records` já aceitava os formatos `html` e `zip`, e não há migrações novas.

## Fluxo

O fluxo é o de sempre: identificar → relatório → pré-visualização → confirmação → projeto editável.

1. **Identificar.** O formato é reconhecido pelo conteúdo:
   - ZIP, pela assinatura `PK`;
   - HTML, por começar com uma etiqueta.

   Pode escolher vários ficheiros de uma vez: o ZIP ou a página HTML é o ficheiro principal e os restantes são os recursos dessa página.
2. **Ler o ZIP** (`src/importers/static/zip.ts`, sem dependências; usa `DecompressionStream`):
   - **Limites:**
     - 50 MB por arquivo e 2000 entradas;
     - 20 MB por ficheiro e 150 MB no total, já descomprimidos;
     - o tamanho é contado **durante** a descompressão, o que trava arquivos que declaram um tamanho falso (proteção contra «bombas» de compressão).
   - **Entradas recusadas, com o motivo no relatório:**
     - caminhos com `..`, absolutos, com letra de unidade ou com caracteres de controlo;
     - ligações simbólicas;
     - ficheiros cifrados;
     - ZIP64;
     - métodos de compressão desconhecidos.
   - A pasta exterior (por exemplo `startbootstrap-stylish-portfolio-gh-pages/`) passa a ser a raiz do site, mesmo quando há vários níveis.
3. **Páginas** (secção «Páginas» do relatório).
   - Todos os `.html`/`.htm` aparecem na lista.
   - Por omissão **não** entram como páginas:
     - ficheiros em `examples/`, `test/`, `vendor/`, `node_modules/`, `partials/`, …;
     - fragmentos sem `<html>`/`<body>`;
     - redirecionamentos;
     - o `404.html`;
     - os ficheiros de verificação do Google.
   - O utilizador escolhe as páginas e a inicial e analisa de novo.
   - A página inicial por omissão é o `index.html` da raiz.
   - Há um máximo de 30 páginas.
4. **Caminhos.** Cada referência é resolvida a partir do ficheiro que a contém:
   - num HTML: `src`, `srcset`, `poster`, `href` e `style`;
   - num CSS: `url()` e `@import`, incluindo as cadeias de `@import`.

   Os caminhos `/x` são relativos à raiz do site. Um caminho que saia da raiz fica em falta.
5. **Ligações.**
   - `pagina.html#x` passa a `/slug#x` e a página inicial passa a `/inicio`.
   - Os ids repetidos **entre páginas** são renomeados (`id-slug`). Os seletores CSS, as âncoras, `for`/ARIA e os comportamentos são atualizados.
   - Uma ligação para uma página não importada mantém-se e é indicada no relatório.

## CSS: decisão

O CSS do site fica **literal, numa folha por página**: o componente `bolt-stylesheet` é um `<style>` dentro da página, que não se seleciona, não aparece nas camadas nem no assistente, e não se move nem copia.

As folhas são juntas **pela ordem do documento**:

- `<link>` locais e externos;
- `<style>`;
- o CSS equivalente do Font Awesome, no lugar onde estava o script.

Os `@import` são incluídos no próprio lugar.

**Porquê:** o motor reordena as regras ao exportar (todas as regras normais primeiro e depois as `@media`, agrupadas e ordenadas), e o canvas distribui as `@media` por contentores de dispositivo. Com o Bootstrap (136 blocos `@media`, *mobile-first*), isso podia mudar a cascata. A folha literal mantém exatamente:

- a ordem;
- as media queries;
- as variáveis `--bs-*`;
- os pseudo-elementos e os estados;
- `@supports`, `@font-face` e as animações.

Como cada página só tem a sua folha, os estilos de uma página não alteram outra.

**Edição:** o inspetor grava regras próprias do elemento (`#id`), que prevalecem sobre as classes da folha. Não prevalecem sobre declarações `!important` (por exemplo os utilitários do Bootstrap).

**Limitação:** a folha importada não aparece nos «Estilos globais» nem como origem dos estilos no inspetor.

Não é carregado nenhum Bootstrap adicional: só existe o que vem em `css/styles.css` (o teste verifica que aparece uma única vez).

## Recursos

| Tipo | Tratamento |
| --- | --- |
| Imagens locais (png, jpg, gif, webp, avif) | URL temporário (`blob:`) até à confirmação. Ao confirmar, são **sempre** guardadas, com a mesma via das outras imagens: Storage do workspace (`bolt-asset:` permanente) ou, em modo local, dentro do documento. As que têm mais de 1600 px no lado maior são reduzidas. Acima de 8 MB são recusadas e indicadas no relatório. |
| Pré-visualização | O iframe isolado (origem opaca) não lê `blob:`, por isso recebe uma cópia do documento com as imagens embutidas. |
| Cancelar, mudar de análise ou sair | Os URLs temporários são libertados (`release()`). |
| Fontes locais | Embutidas no CSS (`data:`): até 2 MB por fonte e 8 MB no total. Acima disso ficam em falta, com o motivo. |
| SVG e pequenos ficheiros locais | Embutidos (`data:`, até 512 KB). O SVG é usado como imagem e não executa scripts. |
| Folhas externas (CDN, Google Fonts) | Obtidas a partir do browser e incluídas no lugar original. Os `url()` relativos passam a absolutos. Se não for possível obtê-las (sem CORS ou sem rede), ficam como `@import` no início da folha e o relatório diz porquê. As fontes continuam no servidor de origem. |
| Imagens remotas | A mesma verificação das outras importações (cópia com autorização ou endereço original). |
| Em falta | Nada é inventado nem substituído em silêncio. A lista exata (ficheiro, tipo e onde é referido) aparece no relatório, com o botão «Acrescentar ficheiros…». No HTML avulso, os ficheiros acrescentados sem pastas são associados pelo nome quando este é único. |
| Avisos de autoria e licença | Os comentários `/*! … */` do CSS ficam no próprio CSS. Os avisos dos scripts removidos e dos comentários HTML vão para o início da folha. O registo da importação guarda o manifesto com os ficheiros de texto (HTML, CSS, JS, LICENSE). |

## Scripts e comportamentos

Nenhum script é executado nem copiado. O código é **lido** (`src/importers/static/behaviours.ts`) e só os padrões reconhecidos passam para o runtime do Bolt:

| Original | No Bolt IA |
| --- | --- |
| Clique que alterna uma classe noutro elemento, no botão e no ícone (menu lateral) | `data-bolt-toggle` / `-class` / `-self` / `-swap`, no runtime |
| Elemento que aparece depois de rolar, com *fade* (voltar ao topo) | `data-bolt-show-after` / `data-bolt-show-effect` |
| Bootstrap `data-bs-toggle="collapse"` | Alterna a classe `show`, sem a animação de altura |
| Font Awesome em JS (`use.fontawesome.com`, cdnjs, jsdelivr) | Folha CSS oficial da mesma versão (convertido) |
| Ouvinte cujo alvo não existe na página | «Removido (sem efeito nesta página)» |
| Tudo o resto (outros ouvintes, dropdown/modal/carrossel do Bootstrap, kits do Font Awesome, scripts desconhecidos) | «Não suportado», com o motivo |

O runtime tem também uma correção geral: as âncoras da pré-visualização deslocavam a página da aplicação à volta do iframe (`scrollIntoView`). Passaram a deslocar só a pré-visualização.

## Mapa

O único iframe aceite é o mapa incorporado do Google:

- `maps.google.com/maps?…output=embed`;
- `www.google.com/maps/embed`.

O mapa fica com `https`, `loading="lazy"` e um título. A CSP da pré-visualização passou a ter `frame-src https://maps.google.com https://www.google.com`. O relatório diz que o mapa carrega conteúdo e cookies do Google.

**O que foi observado:** o Google carregou o mapa quando o documento convertido foi aberto **numa página normal** (teste visual, fora do iframe isolado). **O que não foi testado:** o mapa dentro do iframe isolado da pré-visualização da importação (`sandbox="allow-scripts"`, origem opaca), nem no canvas do editor. Nos testes E2E, sem rede, o Google não responde e o mapa não aparece. Não se declara o mapa validado nesses contextos.

Os outros iframes são removidos e indicados no relatório.

## Amostra: Start Bootstrap «Stylish Portfolio»

A cópia está em `amostra/startbootstrap-stylish-portfolio-gh-pages.zip`. É igual ao original byte a byte (SHA-256 `4e96a244…2f7a`); o original em Downloads não foi alterado.

| Critério | Resultado |
| --- | --- |
| 2 fundos + 4 imagens do portfólio | Carregam na pré-visualização e no editor. Ficam guardados ao importar e continuam visíveis depois de F5 e nos projetos criados a partir do template (E2E). |
| Grelha e tipografia responsivas | 4 / 2 / 1 colunas de serviços a 1280 / 820 / 390 px (E2E). Desvio de 0 px nas posições medidas face ao original (visual). |
| Menu lateral | Abre e fecha pelo runtime, com a troca de ícone `fa-bars` ↔ `fa-xmark`, na pré-visualização e no canvas (E2E). |
| Âncoras e voltar ao topo | «About» desloca até à secção. O botão aparece depois de 100 px e volta ao topo (E2E). |
| Ícones | Simple Line Icons: CSS preservado. Font Awesome: JS convertido em CSS oficial; o alinhamento e a largura dos ícones podem diferir ligeiramente. |
| Mapa | Mantido como mapa incorporado (verificado no documento). O Google carregou-o numa renderização fora do iframe isolado (captura `*-bolt-mapa.png`); no iframe da pré-visualização da importação **não foi testado**. |
| Favicon | Não suportado (indicado no relatório). Por isso a importação é **parcial** e pede aceitação explícita. |
| Bootstrap JS | Removido sem perda: a página não usa `data-bs-*` (nota no relatório). |

### Comparação visual com o original isolado

**Âmbito:** comprova o **aspeto estático** da página nas condições medidas: três larguras, página no topo, rede real, mesmo browser (Chromium do Playwright), **JavaScript original desligado** (nada do arquivo é executado). Não compara comportamentos interativos nem outros browsers.

O original é servido tal como está, com o **JavaScript desligado**: nada do arquivo é executado. As mesmas dimensões são comparadas com a pré-visualização do Bolt (rede real):

| Largura | Píxeis diferentes | Altura original / Bolt | Maior desvio de posição (13 seletores) |
| --- | --- | --- | --- |
| 1280 | 0,03 % | 4739 / 4739 | 0 px |
| 820 | 0,04 % | 5874 / 5874 | 0 px |
| 390 | 0,08 % | 5799 / 5799 | 0 px |

As diferenças restantes são os ícones do Font Awesome (menu e coração): no original só aparecem com JavaScript.

Uma correção resultou desta comparação. Os espaços entre elementos *inline* (botões lado a lado e ícones do rodapé) perdiam-se porque o motor descarta espaços com quebra de linha. Passaram a ser normalizados para um espaço, que é o que o browser mostra.

As capturas são geradas por `BOLT_VISUAL=1 npx playwright test tests/e2e/import-static.visual.spec.ts` e ficam em `%TEMP%\bolt-ia-playwright\test-results\…`, com `resumo.json`.

## Testes executados (01/10)

| Comando | Resultado |
| --- | --- |
| `npm run check` | typecheck, lint, testes (21 ficheiros / 204 testes na última execução), build e `git diff --check`: todos exit 0. Uma execução anterior teve uma falha intermitente; repetida sem alterações, passou (o problema conhecido do OneDrive). |
| `npx playwright test` (suite completa) | 72 passaram, 3 ignorados (visuais, só com `BOLT_VISUAL=1`). Inclui as regressões do Studio e do Elementor. |
| `BOLT_VISUAL=1 … import-static.visual.spec.ts` | 1 passou (tabela acima). |

O teste E2E da amostra percorre:

1. importar e rever o relatório;
2. pré-visualizar: imagens, fundos, grelha, menu, âncora, voltar ao topo, tablet e telemóvel;
3. aceitação parcial obrigatória;
4. editar título, texto, botão (texto e destino), imagem (pelas camadas, porque a legenda a cobre como no original) e fundo do cabeçalho;
5. desfazer e refazer;
6. menu no canvas;
7. guardar, F5 e reabrir pela Dashboard;
8. assistente em simulador: o contexto não leva a folha CSS; aplicar e desfazer;
9. guardar como template, criar uma cópia independente e verificar que o template não muda.

## Limitações concretas

- A folha importada não é editável como CSS nem aparece nos «Estilos globais». As regras com `!important` não são substituídas pelo inspetor.
- Os comportamentos só são convertidos quando o padrão é reconhecido. Outros scripts ficam «não suportado».
- Vídeo e áudio locais não são guardados e ficam em falta. Os ficheiros que não são imagens (por exemplo PDF) mantêm o caminho original, que não abre.
- Os favicons, `<meta>` e dados estruturados não são importados.
- O estilo inline no `<body>` passa para a folha. Os estilos inline dos elementos passam a regras `#id` do motor e deixam de ser inline (só muda algo se o CSS do site usar `!important` sobre eles).
- Folhas externas sem CORS ficam como `@import` no início da folha, o que pode mudar a ordem da cascata. O relatório diz quais.
- Mapa: só foi observado a carregar numa renderização fora do iframe isolado. Dentro do iframe da pré-visualização da importação (origem opaca) e no canvas não foi testado.
- O registo do original guarda o manifesto e os ficheiros de texto (até cerca de 4,5 MB), não o ZIP binário. As imagens usadas ficam no armazenamento.
- **Duplicar uma página importada: corrigido.** Na cópia, os seletores com ids da folha literal, o id do `<body>`, as âncoras e os atributos de comportamento passam aos ids da cópia (teste unitário).
- **Duplicar um elemento: ainda perde regras da folha importada.** A cópia recebe ids novos; as regras da folha literal que visam o elemento (ou os seus descendentes) **por id** não a acompanham. As regras por classe continuam a aplicar-se. Correção pendente (abaixo).
- Na barra do elemento selecionado no canvas, a posição pode tapar elementos fixos do site no canto superior direito (por exemplo o botão do menu). Selecionar outro elemento resolve.

## Correções pendentes

1. **Duplicar elementos** preservando as regras da folha importada que os visam por id (copiar/remapear os seletores, como já acontece ao duplicar páginas).
2. **`!important` que impede uma edição:** o inspetor deve indicar claramente que a alteração não tem efeito por causa de uma regra `!important` da folha importada, em vez de mostrar a edição como aplicada.
3. **Barra contextual sobreposta:** a barra do elemento selecionado no canvas pode tapar elementos fixos do site no canto superior direito (ex.: o botão do menu).

## Validação no Supabase (pendente)

Próximo passo, com uma conta de teste (nunca a conta administrativa). Percurso: importar o ZIP → guardar imagens e fundos → F5 → reabrir → criar template → criar cópia independente → verificar as referências permanentes → limpar só os dados criados pelo teste.

## Ficheiros

| Pasta | Ficheiros |
| --- | --- |
| `src/importers/static/` | `zip.ts`, `files.ts`, `site.ts`, `behaviours.ts`, `externals.ts` |
| `src/importers/` | `pipeline.ts` (ZIP/HTML, `analyzeStaticSite`, `reanalyzeSite`, `previewProjectData`, cópia das imagens locais), `ImportPage.tsx` (vários ficheiros, páginas, ficheiros em falta, libertação dos URLs), `types.ts` |
| `src/engine/` | `boltTypes.ts` (`bolt-stylesheet`, `isInternalComponent`), `cssText.ts`, `pages.ts` e `cloneRules.ts` (duplicar), `runtime.ts` (CSP do mapa) |
| Outros | `public/assets/runtime/bolt-runtime.js`; `src/ai/context.ts` e `src/editor/LayersPanel.tsx` (ignoram a folha); `vite.config.ts` (`assetsInclude` para o ZIP nos testes) |
