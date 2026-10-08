# Estado das fases

Atualizado a 08/10/2026. As percentagens são uma estimativa do âmbito entregue face ao plano, não uma medição. Total estimado: **~77%**.

| Fase | % | Estado |
| --- | --- | --- |
| 0 · Arquitetura e prova técnica | 100% | **Concluída**: `npm run check` exit 0, resultados em `docs/05` |
| 1 · Primeira versão utilizável (fatia funcional completa) | 100% | **Entregue e validada no Supabase real** (28/09 e de novo a 08/10). Ver `docs/06` |
| 2 · Editor completo e biblioteca de templates persistida | ~88% | **Publicada e validada no Supabase real a 08/10**: biblioteca da equipa, barra de ferramentas, «+», arrasto, inspetor, várias páginas, estilos globais, Google Fonts e seleção sincronizada. Falta: classes e estados (`:hover`), vista de código e barra do editor em telemóvel. Ver `docs/10`, `docs/11`, `docs/12` |
| 3 · Importação incremental | ~92% | GrapesJS/Studio, Elementor, HTML/CSS e ZIP **publicados**; o ZIP foi validado no Supabase real a 08/10. Falta o JSON Bolt. Ver `docs/08`, `docs/20` |
| 4 · IA integrada | ~75% | **Implementada e publicada**: assistente v2, janela rápida, imagens, responsivo automático, configurações com vários fornecedores e escolha automática, diagnóstico. HTTP 400 do Gemini com **causa comprovada e corrigida a 08/10** (o Gemini recusa `maxItems`/`minItems` no esquema das funções); falta a validação por uma tentativa real. A chave Anthropic, inativa, foi recusada em execução (401). Ver `docs/18`, `docs/10` |
| 5 · Exportação e publicação | ~5% | Por fazer: só existe a cópia de segurança. O deploy da aplicação na Vercel existe; a publicação dos sites dos utilizadores não |

Ponto de continuidade (o que está feito, testes, pendências e como retomar): **`docs/10-continuidade.md`**.

## Validação no Supabase real (08/10/2026, execução do utilizador)

| Comando | Resultado |
| --- | --- |
| `npm run test:server` | **17/17 passaram**: `supabase.api.test.ts` 12/12 e `ai.financeiro.test.ts` 5/5 |
| `npm run test:e2e:server`, executado 2 vezes | **11 passaram e 1 foi ignorado de propósito**, nas duas execuções |

O teste ignorado é o piloto real da IA (`tests/e2e-server/ai-pilot.spec.ts`). Só corre com `BOLT_AI_PILOT=1` porque faz uma chamada paga; o «-» no relatório do Playwright quer dizer «ignorado», não «falhado».

Ficaram validados no servidor real, além da Fase 1:
- várias páginas;
- estilos globais;
- inspetor (fundo e ajuste móvel com referência permanente);
- biblioteca de imagens depois de F5;
- importação ZIP com Storage;
- biblioteca de templates e registo de importações;
- isolamento entre contas, incluindo as imagens;
- conflito entre sessões;
- falha de rede ao guardar;
- utilizador comum sem acesso a consumos, preços, configuração e chaves.

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

## Páginas e camadas (29/09/2026)

| Área | Estado |
| --- | --- |
| Várias páginas por projeto: criar, mudar o nome, duplicar, eliminar (nunca a última; a inicial com aviso), página inicial, camadas da página atual, ligações entre páginas por `/slug` | implementado e testado localmente (unitário `tests/unit/pages.test.ts` e E2E `tests/e2e/pages.spec.ts`). Sem migração. Ver `docs/11` |
| Pré-visualização com navegação entre páginas («Voltar», destino inexistente, âncoras, externos inalterados) | implementado e testado localmente (unitário e E2E). Não requer Supabase |
| Slugs únicos (criar, duplicar, importar, colisão com `/inicio`), estáveis ao mudar o nome; referências internas das cópias (`#id`, `for`, ARIA) | implementado e testado localmente (unitário e E2E) |
| Aviso de desfazer/refazer noutra página com «Ver página», sem passo no histórico | implementado e testado localmente (unitário e E2E) |
| Várias páginas no Supabase real (gravação automática, inicial, slugs, estilos, imagens, template com todas as páginas) | teste escrito; **pendente de execução** com `npm run test:e2e:server` |
| Painel esquerdo por ferramentas (Adicionar, Páginas e camadas, Imagens) | implementado e testado localmente; a listagem de imagens no servidor está por testar no Supabase |

## Estilos globais (29/09/2026)

| Área | Estado |
| --- | --- |
| Ferramenta «Estilos globais»: cores, tipografia e elementos, com as variáveis importadas preservadas (registos do Studio editados no lugar) | implementado e testado localmente (unitário `tests/unit/globalStyles.test.ts` e E2E `tests/e2e/global-styles.spec.ts`, com Nimbus e as duas amostras). Ver `docs/12` |
| Configuração global explícita em projetos sem variáveis (Elementor) | implementado e testado localmente |
| Persistência dos estilos globais no Supabase real (gravação automática, F5, Dashboard, template e cópia) | teste escrito; **pendente de execução** com `npm run test:e2e:server` |
| Escape na pré-visualização e classes do corpo em páginas novas | correções implementadas e testadas localmente |

## Assistente IA, versão 1 (29/09/2026)

| Área | Estado |
| --- | --- |
| Painel, contrato, contexto, validação, antes/depois, confirmação, desfazer único, falha restaurada | implementado e testado localmente **com simulador** (unitário, PGlite e E2E marcados [simulado]). Ver `docs/14` |
| Função `ai-propose` e migração `ai_usage` (limites, concorrência, orçamento com reserva prévia) | escritas **para revisão**; lógica testada localmente; **não aplicadas** |
| Chamadas reais ao fornecedor (Claude Sonnet 5.5, candidato) | **pendente**: sem chave, sem chamadas pagas; bateria `npm run test:ai-pilot` preparada |
| Correção: desfazer texto de título do template deixava o canvas vazio | corrigido e testado localmente |

## Configurações de IA (30/09/2026)

| Área | Estado |
| --- | --- |
| Painel administrativo (configuração central, chave no Vault, teste sem custo, ativar/desativar, limites, orçamento, consumo, auditoria) | implementado e testado localmente (PGlite, unitário e E2E em simulação local). Ver `docs/16` |
| Migrações `20260929120000` e `20260930120000`, funções `ai-admin` e `ai-propose` | escritas; **não aplicadas nem publicadas** |
| Validação no Supabase real e pedidos ao modelo real | **pendente** (`docs/15`) |
