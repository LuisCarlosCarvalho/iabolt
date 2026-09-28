# Bolt IA

Construtor visual de websites para a equipa de marketing Blue Bolt. Projeto novo: sem código, dados ou credenciais do projeto anterior.

**Estado:** primeira versão utilizável (Fase 1). O modo servidor está preparado e aguarda configuração. Ver `docs/00-estado-das-fases.md` e `docs/06-entrega-1-primeira-versao.md`.

## Executar localmente

Requer Node 24 (`.nvmrc`).

```bash
npm ci                          # instala as versões fixadas no lockfile
npx playwright install chromium # só para os testes no browser
npm run dev                     # http://localhost:5173/
```

Sem `.env.local`, a aplicação corre em **modo local**: os projetos ficam só neste browser (IndexedDB) e a interface indica-o sempre. Para usar a base de dados, copie `.env.example` para `.env.local` e siga `docs/06`.

## Verificação

```bash
npm run check     # typecheck, lint, testes (unitários e base de dados), build, git diff --check
npm run test:e2e  # percursos reais no browser (Chromium)
```

## Rotas

- `/`: projetos (Dashboard)
- `/templates`: biblioteca de templates e criação de projetos
- `/projetos/:id`: editor
- `/prova-tecnica`: prova da Fase 0 (diagnóstico, fora da navegação)

## Documentação

- `docs/00-estado-das-fases.md`: o que está feito, testado e pendente
- `docs/01-arquitetura-e-decisoes.md`: motor (GrapesJS Core), stack, identidade, fronteira React ↔ motor, persistência
- `docs/02-contrato-e-persistencia.md`: `BoltDocument`, via única de gravação, base de dados e RLS
- `docs/03-matriz-importacao.md`: formatos de importação (fases seguintes)
- `docs/04-plano-de-testes.md`: o que cada teste prova
- `docs/05-resultados-fase0.md` e `docs/06-entrega-1-primeira-versao.md`: resultados executados
- `CLAUDE.md`: regras operacionais
