# Plano de testes

Comandos: `npm test` (unitários e base de dados), `npm run test:e2e` (browser) e `npm run check` (typecheck, lint, testes, build e diff check).

## Unitários · Vitest + jsdom, motor headless

- `tests/unit/engine.poc.test.ts` (Fase 0, 11 casos): componentes reais, ids persistidos, selecionar pai, editar e desfazer, logótipos, duplicar, mover e desfazer, mover para dentro de si recusado, eliminar e desfazer, serializar e recarregar, envelope.
- `tests/unit/saveQueue.test.ts` (Fase 0, 7 casos): criação idempotente, conflito sem sobrescrita, «guardado» só após a revisão, falha de rede e repetição, serialização, conflito entre separadores, resposta ignorada após navegação.
- `tests/unit/slice.test.ts`:
  - templates completos, com ids e envelope válidos;
  - logótipo em texto e em imagem preservados;
  - cópia independente: editar não altera o template, que está congelado;
  - projeto em branco;
  - nomes compreensíveis;
  - posições válidas: secções só na página, colunas só em linhas de colunas;
  - inserção de blocos;
  - reordenar, duplicar, eliminar, ligações e estilos por dispositivo sobrevivem a reabrir;
  - estilos no desfazer.
- `tests/unit/assetsAndTransfer.test.ts`: imagens privadas (referência ↔ URL assinado, gravação sem tokens); cópia de segurança; cópia para a conta idempotente, sem alterar os locais, com falhas por projeto.
- `tests/unit/indexedDbRepository.test.ts`: modo local. Lista vazia, idempotência, conflito, ordenação, mudar o nome, arquivar, documento inválido recusado, SaveQueue sobre IndexedDB.

## Base de dados · Vitest + PGlite

`tests/db/db.rls.test.ts`: executa `supabase/migrations/*.sql` num Postgres real (WASM) e prova RLS, via única de gravação, conflito e Storage com dois utilizadores (ver `docs/02`).

## Browser · Playwright (Chromium)

- `tests/e2e/app.spec.ts`:
  - abrir sem parâmetros não cria projetos;
  - percurso completo (template → editar título, cor, selecionar pai, duplicar, eliminar, reordenar, ligação, imagem carregada, dispositivos → guardar → lista → reabrir → F5);
  - template preservado entre projetos;
  - logótipo em imagem;
  - página em branco com os 6 blocos;
  - edição direta no canvas, desfazer e refazer;
  - arrastar na árvore, com recusa de destino inválido;
  - Dashboard: mudar o nome e remover;
  - conflito entre dois separadores;
  - erro de gravação sem «guardado» e confirmação ao sair;
  - cópia de segurança dos projetos locais;
  - projeto inexistente.
- `tests/e2e/poc.spec.ts`: prova da Fase 0, na rota `/prova-tecnica`.

## Contra o Supabase real (escritos; por executar até haver projeto, `docs/07`)

- `npm run test:server` → `tests/server/supabase.api.test.ts` (9 casos, API real com as contas de teste A e B).
- `npm run test:e2e:server` → `tests/e2e-server/server.spec.ts` (6 casos, browser real).

Continua manual: criar uma conta pelo ecrã e confirmar o email.

Estes testes cobrem, contra o projeto Supabase real:

- conta nova com workspace criado;
- percurso E2E completo em modo servidor;
- novo contexto de browser autenticado vê os projetos;
- dois utilizadores com acesso cruzado negado (base de dados e Storage);
- conflito entre dois browsers;
- falha de rede real.
