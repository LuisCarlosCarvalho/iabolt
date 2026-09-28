# Estado das fases

| Fase | Estado |
| --- | --- |
| 0 · Arquitetura e prova técnica | **concluída**: `npm run check` exit 0, resultados em `docs/05` |
| 1 · Primeira versão utilizável (fatia funcional completa) | **entregue em modo local**; modo servidor **pronto para validar**: falta criar o projeto Supabase e correr `npm run test:server` e `npm run test:e2e:server` (`docs/07`) |
| 2 · Editor completo e biblioteca de templates persistida | seguinte |
| 3 · Importação incremental (JSON Bolt/GrapesJS, Studio, Elementor, HTML/CSS, ZIP) | por fazer |
| 4 · IA integrada | por fazer |
| 5 · Exportação e publicação | por fazer |

## Fase 1 · fatia funcional

Percurso: abrir o Bolt IA → escolher um template → criar um projeto → editar → guardar → voltar à lista → reabrir o mesmo projeto.

| Área | Estado |
| --- | --- |
| Dashboard: lista, criar em branco ou por template, miniatura, nome e data, abrir, estados de carregamento, vazio e erro, mudar o nome, remover (arquivar) | implementado e testado (E2E) |
| Biblioteca: 2 templates completos (Nimbus, com logótipo em texto; Vértice, com logótipo em imagem) + em branco; pré-visualização por dispositivo; cópia independente | implementado e testado (unitário e E2E) |
| Editor: canvas, árvore com arrastar, propriedades, componentes básicos, barra contextual, dispositivos, guardar, desfazer, refazer | implementado e testado (E2E) |
| Edição: texto direto e pelo painel, ligações e botões (texto e destino), imagens (carregar, endereço, reutilizar), secção, colunas, título, texto, imagem, botão, selecionar pai, duplicar, eliminar, mover, cores, tipografia, espaçamento, alinhamento | implementado; testado que sobrevive a guardar e reabrir |
| Persistência local (IndexedDB) com revisão otimista | implementado e testado |
| Base de dados: migrações, RLS, funções de gravação e Storage (bucket privado, URLs assinados) | implementado; testado em Postgres (PGlite); **não aplicado a um projeto Supabase** |
| Projetos do modo local ao ativar o servidor: cópia de segurança em ficheiro e cópia idempotente para a conta, sem apagar os locais | implementado; testado (unitário e E2E local); a cópia para a conta tem teste E2E no servidor, por executar |
| Autenticação (email e palavra-passe) e `SupabaseRepository` | implementado; **não executado contra um servidor real** |

## O que depende de si

Criar o projeto Supabase é um recurso externo e precisa da sua autorização (`CLAUDE.md`). Os passos exatos estão em `docs/07`. Depois de preencher `.env.local`, a aplicação passa sozinha ao modo servidor, e os testes contra o servidor real tornam-se executáveis.

## Fora desta fase, de propósito

Importadores, IA e publicação **não aparecem na interface** enquanto não funcionarem. A arquitetura está preparada para os receber sem outro modelo de página: todos produzem ou consomem `BoltDocument`.
