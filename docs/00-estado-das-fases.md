# Estado das fases

| Fase | Estado |
| --- | --- |
| 0 · Arquitetura e prova técnica | **concluída**: `npm run check` exit 0, resultados em `docs/05` |
| 1 · Primeira versão utilizável (fatia funcional completa) | **entregue e validada no Supabase real**: `npm run test:server` 9/9 e `npm run test:e2e:server` 6/6 (execução do utilizador, 28/09/2026). Ver `docs/06` |
| 2 · Editor completo e biblioteca de templates persistida | **em curso**. Implementados e testados localmente: biblioteca da equipa (versões imutáveis), design system da interface com temas, barra de ferramentas no canvas, inserção pelo «+», arrasto no canvas e inspetor de estilos. Migração 3 aplicada pelo utilizador (a importação no site publicado passou a gravar). Testes reais novos no Supabase **por executar**. Ver `docs/10` |
| 3 · Importação incremental (JSON Bolt/GrapesJS, Studio, Elementor, HTML/CSS, ZIP) | GrapesJS/Studio e Elementor **implementados e testados** com as amostras (localmente; no site publicado o utilizador importou com sucesso). HTML/CSS, ZIP e JSON Bolt pendentes. Ver `docs/08` |
| 4 · IA integrada | **só plano** em `docs/09`, com pontos de revisão; nada implementado |
| 5 · Exportação e publicação | por fazer (o deploy da própria aplicação na Vercel já existe; a publicação dos sites dos utilizadores não) |

Ponto de continuidade (o que está feito, testes, pendências e como retomar): **`docs/10-continuidade.md`**.

## Fase 1 · fatia funcional

Percurso: abrir o Bolt IA → escolher um template → criar um projeto → editar → guardar → voltar à lista → reabrir o mesmo projeto.

| Área | Estado |
| --- | --- |
| Dashboard: lista, criar em branco ou por template, miniatura, nome e data, abrir, estados de carregamento, vazio e erro, mudar o nome, remover (arquivar) | implementado e testado (E2E) |
| Biblioteca: 2 templates completos (Nimbus, com logótipo em texto; Vértice, com logótipo em imagem) + em branco; pré-visualização por dispositivo; cópia independente | implementado e testado (unitário e E2E) |
| Editor: canvas, árvore com arrastar, propriedades, componentes básicos, barra contextual, dispositivos, guardar, desfazer, refazer | implementado e testado (E2E) |
| Edição: texto direto e pelo painel, ligações e botões (texto e destino), imagens (carregar, endereço, reutilizar), secção, colunas, título, texto, imagem, botão, selecionar pai, duplicar, eliminar, mover, cores, tipografia, espaçamento, alinhamento | implementado; testado que sobrevive a guardar e reabrir |
| Persistência local (IndexedDB) com revisão otimista | implementado e testado |
| Base de dados: migrações, RLS, funções de gravação e Storage (bucket privado, URLs assinados) | aplicado ao projeto Supabase `quihhoszhtivzwhcvnsd`; testado em PGlite e no Supabase real |
| Projetos do modo local ao ativar o servidor: cópia de segurança em ficheiro e cópia idempotente para a conta, sem apagar os locais | implementado; testado (unitário, E2E local e E2E no Supabase real) |
| Autenticação (email e palavra-passe, sem registo no ecrã) e `SupabaseRepository` | implementado e testado no Supabase real |

## O que depende de si

Criar o projeto Supabase é um recurso externo e precisa da sua autorização (`CLAUDE.md`). Os passos exatos estão em `docs/07`. Depois de preencher `.env.local`, a aplicação passa sozinha ao modo servidor, e os testes contra o servidor real tornam-se executáveis.

## Fora desta fase, de propósito

IA e publicação **não aparecem na interface** enquanto não funcionarem. Na importação, só os formatos implementados são anunciados como disponíveis; os outros aparecem como «em breve». A arquitetura está preparada para os receber sem outro modelo de página: todos produzem ou consomem `BoltDocument`.

## Edição direta no canvas (entrega de 28/09/2026)

| Área | Estado |
| --- | --- |
| Barra de ferramentas junto ao elemento: nome, selecionar pai, mover, inserir, editar texto ou substituir imagem, duplicar, eliminar. Acompanha scroll, zoom e dispositivo, e fica sempre na área visível | implementado e testado (E2E `tests/e2e/editor-direct.spec.ts`) |
| Inserção pelo «+» antes, depois ou dentro, só em destinos compatíveis; seleciona o criado; desfazer | implementado e testado |
| Arrasto no canvas pelo mecanismo do motor (marcador de destino, Esc cancela, destinos inválidos recusados, desfazer e refazer) | implementado e testado |
| Árvore: ícones e SVG fechados por omissão | implementado e testado |
| Editor: modo de armazenamento só em ícone; o estado de gravação diz onde se guarda | implementado e testado |
| Classes e estados, cores e fontes globais, páginas, código e exportação | por fazer (inventário na entrega) |

## Inspetor visual (entrega de 28/09/2026)

| Área | Estado |
| --- | --- |
| Grupos recolhíveis: Tipografia, Layout (flex e grelha), Dimensões, Espaçamento (4 lados, com opção de os ligar), Fundo (cor e imagem pela seleção de imagens existente), Bordas, Efeitos (opacidade, sombra), Posição (com deslocamentos e z-index) | implementado e testado (unitário `tests/unit/styleInspector.test.ts` e E2E `tests/e2e/inspector.spec.ts`) |
| Origem de cada valor: este dispositivo, outro dispositivo, regra do site (classe, seletor ou breakpoint importado), ou calculado pelo browser; repor remove só a alteração local | implementado e testado |
| Dispositivo em edição sempre indicado; o telemóvel grava no breakpoint próprio e preserva o computador; os breakpoints importados não são normalizados | implementado e testado |
| Histórico: um passo por alteração; interações contínuas (cor, opacidade) contam como um só passo; abrir o inspetor não altera o documento | implementado e testado |
| Persistência no servidor da imagem de fundo (referência durável dentro de `url(...)`) e do ajuste móvel | teste acrescentado a `npm run test:e2e:server`, **por executar** |
