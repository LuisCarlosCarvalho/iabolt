# Estilos globais

Ferramenta «Estilos globais» (ícone de paleta) na barra lateral do editor. Edita a identidade visual do site em todas as páginas.

## Análise antes de alterar: como cada projeto representa o tema

| Projeto | Cores | Fontes | Elementos |
| --- | --- | --- | --- |
| **Nimbus e Vértice** (templates nativos) | variáveis `--bolt-primary`, `--bolt-on-primary`, `--bolt-text`, `--bolt-heading`, `--bolt-bg` declaradas em `body` | `--bolt-font-body` e `--bolt-font-heading` em `body` | regras `body`, `h1, h2, h3, h4`, `p`, `a` e `.bolt-btn`, que usam as variáveis; `--bolt-radius` nos botões e imagens |
| **Amostra GrapesJS Studio** | `:root` com `--gjs-t-color-*` (Primary, Secondary, Accent, Success, Warning, Error). Cada valor está **ligado a um registo** da fonte de dados `globalStyles` (`{type:'data-variable', path:'globalStyles.<id>.value'}`) | `font-family` de `.gjs-t-body` e `.gjs-t-h1`, também ligadas a registos; `@font-face` de Barlow e Poppins | `.gjs-t-body`, `.gjs-t-h1`, `.gjs-t-h2`, `.gjs-t-link`, `.gjs-t-button` e `.gjs-t-border`, ligadas a registos; o wrapper da página tem a classe `gjs-t-body` |
| **Amostra Elementor** | nenhuma variável: o ficheiro não inclui o «kit» global do Elementor | cada widget tem `font-family` fixa na regra própria (`#id`) | regras `body` (cor e fonte fixas) e `a { color: inherit }` criadas pela importação |

### O que se edita diretamente

- Variáveis CSS declaradas em `:root`, `html` ou `body`, sem media query.
- Propriedades de regras globais de elementos. A lista de seletores é fechada: `body`, `h1…h6`, `p`, `a`, `button`, `.bolt-btn` e as classes `.gjs-t-*`.
- Quando a propriedade está ligada a um registo de dados (Studio), edita-se o **registo**. A ligação, o nome da variável e o âmbito (`:root`) ficam intactos.

### O que não tem associação global identificável

- **Cores fixas repetidas em regras de classes ou de elementos.** Por exemplo, `#0f172a` em `.nb-logo` e na variável dos títulos, ou `#7A7A7A` em vários widgets do Elementor. Duas cores iguais não se tratam como o mesmo papel e não se convertem.
- **Regras próprias (`#id`) e regras com media query** (tablet, telemóvel). Nunca são tocadas.
- **Registos do Studio sem regra que os use** (ex.: a fonte de H2 sem valor). Não aparecem.
- **Elementor:** não há variáveis. O painel oferece a ação explícita «Criar estilos globais» (ver abaixo).

## Decisões

- **Um módulo de motor** (`src/engine/globalStyles.ts`), com as funções `readGlobalStyles`, `writeSlot`, `continuousSlotEdit`, `resetSlot`/`resetAll` e `createGlobalSetup`.
- **Escrita sem resolver:** as regras escrevem-se com `rule.addStyle`, que estende o estilo sem resolver as ligações, e só na propriedade alterada. Os registos escrevem-se com `record.set('value')`. Não há `!important` nem substituições em massa.
- **Histórico:**
  - Os registos de dados não entram no histórico do motor por omissão. Ao abrir o projeto, `trackGlobalStyles` regista-os com `UndoManager.add`, o que não altera o documento.
  - Cada alteração concluída é um passo.
  - O seletor de cor pré-visualiza sem histórico e grava **um** passo ao fechar.
  - «Repor tudo» é um só passo.
- **Repor:** volta aos valores que o projeto tinha ao abrir nesta sessão. Esses valores ficam só em memória. Repor escreve valores e nunca apaga regras.
- **Gravação:** a via única (SaveQueue). As alterações às regras emitem `update`. As alterações aos registos emitem `bolt:global-styles`, que o editor também escuta para gravar.
- **Sem configuração global** (Elementor):
  - «Criar estilos globais» declara em `body` as variáveis `--bolt-text` e `--bolt-font-body` (e `--bolt-bg`, se o corpo tiver fundo), com os valores atuais, e liga o corpo a elas.
  - O aspeto não muda. É um só passo de histórico.
  - O painel diz antes quantos elementos têm cor ou fonte próprias e que os mantêm.
  - Não se criam regras de títulos, porque mudariam títulos que hoje herdam de contentores.
- **Fontes:** a lista do inspetor mais as famílias com `@font-face` no projeto (o mecanismo de carregamento que já existe). A fonte escolhida vai para a folha de estilos do projeto, por isso aparece no canvas e na pré-visualização.
- **Inspetor:** no grupo Tipografia, quando a fonte ou a cor do elemento vêm de um valor próprio ou de uma regra mais específica, um aviso explica que os Estilos globais não o alteram.
- **Nomes:** cada campo mostra primeiro um nome amigável (ex.: «Cor principal», «Fonte usada nos títulos»). A variável, o seletor e o nome original do ficheiro (ex.: «Primary») ficam numa linha secundária. Os campos ligados a uma variável mostram «Segue «Cor principal»» em vez de `var(--…)`. Só muda a apresentação: as associações ficam iguais.
- **Tema da aplicação:** o tema Claro/Escuro/Automático continua independente do site. O painel diz isto no rodapé.
- **Páginas novas e duplicadas** passam a herdar as **classes** do wrapper da página de origem (ex.: `gjs-t-body`). Sem isto, uma página nova no projeto Studio não seguia o corpo global. O id e os atributos não se copiam.

## Onde está

- `src/engine/globalStyles.ts`: leitura, escrita, histórico, repor e criação da configuração.
- `src/editor/GlobalStylesPanel.tsx`: o painel (Cores, Tipografia, Elementos).
- `src/editor/StyleInspector.tsx`: o aviso `global-override-note`.
- `src/editor/EditorPage.tsx`: a ferramenta, `trackGlobalStyles` e a gravação.
- `src/editor/ToolRail.tsx`: a entrada «Estilos globais».
- `src/engine/pages.ts`: `copyBodyClasses`.

## Limitações

- Uma cor própria de um elemento não se liga a uma variável automaticamente. Pode ligar-se à mão no inspetor, escrevendo `var(--nome)`.
- Nas regras globais de elementos só se editam as propriedades já declaradas. Não se acrescentam propriedades novas a partir do painel.
- No Elementor, quase todos os textos têm fonte e cor próprias. As variáveis criadas só afetam o que herda do corpo (ex.: conteúdos novos). O inspetor explica isto em cada elemento.
- Variáveis desconhecidas mostram um nome derivado do nome técnico (ex.: `--brand-blue` → «Brand blue»).
