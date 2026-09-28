# Estado das fases

| Fase | Estado |
| --- | --- |
| 0 · Arquitetura e prova técnica | **executada localmente**: `npm run check` exit 0 (typecheck, lint, 18 testes unitários, build, diff-check) e 2 testes browser com exit 0. Ver `docs/05` |
| 1 · Fundação com persistência remota | por aprovar |
| 2 · Editor e templates | — |
| 3 · Importação incremental | — |
| 4 · IA integrada | — |
| 5 · Exportação e publicação | — |

## Fase 0: o que existe e com que grau de verificação

| Item | Estado |
| --- | --- |
| Decisão do motor, avaliação do Studio SDK, stack (`docs/01`) | escrito; versão e licença do GrapesJS confirmadas no registo npm (0.23.6, BSD-3-Clause) |
| Dependências | fixadas com versão exata no `package.json` e no `package-lock.json` (28/09/2026) |
| Contrato `BoltDocument` e persistência (`docs/02`, `src/contract`, `src/persistence`) | implementado e **testado** (unitários) |
| Matriz de importação com evidência das amostras (`docs/03`) | escrito; as contagens foram medidas nos ficheiros |
| Motor: tipos, identidade, operações (`src/engine`) | implementado e **testado** (unitários, jsdom headless) |
| Testes unitários (`tests/unit`, 18 casos) | **executados: 18/18** |
| Percurso browser Playwright (`tests/e2e`, 2 casos) | **executados: 2/2** (Chromium) |
| Prova no browser (`src/poc`) | **executada** pelo Playwright |
| Persistência no servidor | **pendente (Fase 1)**. A Fase 0 usa `localStorage` |

## Pendente para fechar a Fase 0

1. Repositório git inicializado a 28/09/2026 (sem commits nem remoto).
2. Aprovação da arquitetura (`docs/01`) antes da Fase 1.
