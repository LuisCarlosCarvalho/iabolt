# Regras operacionais — Bolt IA

Esta é a fonte principal de regras para agentes. A especificação completa é o «Bolt IA — Prompt mestre» v1.0, fornecido pelo utilizador. As decisões estão em `docs/`.

## Não fazer sem autorização explícita do utilizador
- Commit, push, merge, deploy ou publicação.
- Criar recursos pagos ou infraestrutura externa (Supabase, Vercel, chaves de IA).
- Adotar o GrapesJS Studio SDK (ver `docs/01`, D2).
- Alterar o projeto antigo ou as amostras fornecidas pelo utilizador (Elementor `.json`, `.grapesjs`). São só leitura.

## Arquitetura (resumo)
- O GrapesJS Core é dono do documento. O React só tem estado transitório de interface, nunca uma cópia da árvore.
- A identidade de um componente é o `attributes.id`, persistido em todos (ver `src/engine/identity.ts`).
- O documento canónico é o `BoltDocument` (envelope versionado + JSON de projeto do motor). HTML/CSS só servem para importar e exportar.
- A persistência tem uma única via: `ProjectRepository` + `SaveQueue`. Não pode haver gravadores paralelos.

## Qualidade
- `npm run check` corre typecheck, lint, testes, build e `git diff --check`, e reporta o código de saída de cada um.
- Proibido `@ts-ignore`, `@ts-expect-error`, casts indiscriminados ou excluir pastas do typecheck.
- Não declarar sucesso sem comando executado e código de saída 0. Distinguir sempre: implementado, testado, parcial, pendente.
- Fixtures de teste identificadas como tal (`src/engine/pocFixture.ts`). Nunca alterar uma fixture para um teste passar.
- Antes de alterar: `git status`. Sem checkout/restore/reset amplos.
