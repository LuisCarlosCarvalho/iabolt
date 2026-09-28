# Resultados da Fase 0

Execução local a 28/09/2026 · Windows 11 · Node v24.18.0 · pasta `C:\Users\carva\OneDrive\Desktop\clientes\blue`.

## Versões fixadas (`npm install -E`)

| Pacote | Versão | Nota |
| --- | --- | --- |
| grapesjs | 0.23.6 | licença BSD-3-Clause confirmada no registo npm |
| react / react-dom | 19.3.0 | |
| zod | 4.6.5 | |
| vite | 8.3.1 | |
| @vitejs/plugin-react | 6.1.1 | peer `vite ^8` |
| typescript | **6.0.3** | o typescript-eslint 8.70.1 exige `typescript >=4.8.4 <6.1.0`, por isso **não** o 7.0.2 (risco previsto em `docs/01`, D3) |
| vitest | 5.0.2 | |
| jsdom | 30.1.1 | |
| @playwright/test | 1.63.0 | Chromium 153.0.8010.12 (`npx playwright install chromium`) |
| eslint / @eslint/js | 10.11.0 / 10.0.1 | |
| typescript-eslint | 8.70.1 | |
| eslint-plugin-react-hooks | 7.1.1 | |
| @types/react / @types/react-dom | 19.3.0 | |
| @types/node | 24.19.0 | segue o Node 24 local |

`npm install`: 0 vulnerabilidades. Aviso: `backbone-undo@0.2.6` descontinuado (dependência interna do GrapesJS).

## Resultados

| Comando | Exit | Resultado |
| --- | --- | --- |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm test` | 0 | 2 ficheiros, **18/18** testes |
| `npm run build` | 0 | aviso: chunk JS de 1 422 kB (387 kB gzip), sobretudo GrapesJS. Code-splitting fica para a Fase 2 |
| `npm run test:e2e` | 0 | **2/2** (Chromium) |
| `npm run check` | 0 | typecheck, lint, test, build e diff-check OK (depois do `git init`). Antes do `git init`: exit 1, `diff-check` exit 129 |

## Correções feitas (causa → correção)

1. **Typecheck, TS7006 em `identity.ts` e `operations.ts`.** Com o TS 6, `Components.forEach/filter` (tipados via `_.ListIterator` do `@types/underscore` 1.13, dependência do GrapesJS) não dão tipo contextual ao parâmetro. → Iterar sobre `.models` (`Component[]`), como o `findById` já fazia. Sem casts. Coberto pelos testes existentes de ids e árvore.
2. **Lint, `no-undef` em `scripts/check.mjs`.** O script corre em Node. → Bloco no `eslint.config.js` com os globais `process`/`console` para `scripts/**/*.mjs`.
3. **Lint, `no-non-null-assertion` (7 casos).** Em `PocApp.tsx`: guardar o editor já verificado numa constante (`loaded`). Nos testes unitários: helper `must()`, que falha com mensagem clara. No e2e: `?? ''` e mais uma asserção de id não vazio. Nenhuma fixture foi alterada.
4. **Playwright, erro de configuração.** A pasta do relatório HTML (`test-results/html`) estava dentro da pasta de resultados, que é limpa a cada execução. → `outputFolder: 'playwright-report'` (já no `.gitignore`).

## Limites

- A persistência provada é `LocalDevRepository` (`localStorage`). **Não prova persistência no servidor** (Fase 1).
- Sem commits, o `git diff --check` não tem o que comparar. Foi verificado à parte, ficheiro a ficheiro (`git diff --no-index --check`): 0 erros de espaços. `core.autocrlf=true` nesta máquina converte LF para CRLF; convém um `.gitattributes` antes do primeiro commit.
