# Bolt IA

Construtor visual de websites para a equipa de marketing Blue Bolt. Projeto novo: sem código, dados ou credenciais do projeto anterior.

**Estado:** Fase 0 (arquitetura e prova técnica). Ver `docs/00-estado-das-fases.md`.

- `docs/01-arquitetura-e-decisoes.md`: motor (GrapesJS Core), Studio SDK, stack, identidade
- `docs/02-contrato-e-persistencia.md`: `BoltDocument`, gravação única, entidades
- `docs/03-matriz-importacao.md`: formatos e evidência das amostras
- `docs/04-plano-de-testes.md`: o que cada fase tem de provar
- `CLAUDE.md`: regras operacionais

```bash
npm ci            # depois de as dependências estarem fixadas no lockfile
npm run dev       # prova técnica em http://localhost:5173
npm run check     # typecheck, lint, testes, build, diff check
npm run test:e2e  # percurso real no browser
```
