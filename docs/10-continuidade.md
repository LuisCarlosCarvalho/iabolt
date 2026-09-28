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

## Próximo passo para amanhã

1. Executar `npm run test:server` e `npm run test:e2e:server`, e registar aqui os resultados. Estes testes validam a biblioteca, o registo de importações e a imagem de fundo no Supabase real.
2. Rever `docs/09-plano-assistente-ia.md`, sobretudo os quatro pontos de revisão, e decidir se a próxima entrega é a IA ou mais uma parte do editor (classes e estados, cores e fontes globais).
