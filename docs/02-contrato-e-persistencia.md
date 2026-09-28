# Contrato do documento e persistência

## Contrato `BoltDocument` v1

O documento editável canónico é o JSON de projeto do GrapesJS (`editor.getProjectData()`), guardado dentro de um envelope versionado:

```ts
{
  boltSchemaVersion: 1,                 // versão deste envelope; migrações explícitas 1→2…
  engine: { name: "grapesjs", version: "0.23.6" },
  projectId: string,                    // UUID atribuído pelo servidor
  revision: number,                     // inteiro ≥ 0, incrementado só pelo servidor
  projectData: GrapesProjectData        // pages, styles, assets, symbols, dataSources…
}
```

- A validação em runtime usa zod (`src/contract/boltDocument.ts`). O `projectData` é validado estruturalmente (pages/frames/component com `type` e `attributes.id`). A validação profunda dos tipos de componente é feita pelo motor ao carregar.
- Autoria, datas, workspace e estado **não** vivem no envelope. São colunas do servidor, com uma única fonte.
- HTML/CSS são exportação ou importação, nunca a forma persistida.
- Migrações: `migrate(doc)` aceita só versões conhecidas. Uma versão desconhecida devolve erro explícito, sem tentativa de adivinhar.

## Camada única de persistência

Há uma interface, `ProjectRepository`, com `create(idempotencyKey)`, `load(id)` e `save(id, baseRevision, data)`. Os adaptadores são:

- Fase 0: `MemoryRepository` (testes) e `LocalDevRepository` (prova no browser). **Não são produção.**
- Fase 1: `SupabaseRepository`. Substitui o anterior sem mudar os chamadores.

`SaveQueue` é a única via de gravação, usada tanto pelo manual como pelo autosave:

- Estados: `idle` (guardado) · `dirty` (alterações por guardar) · `saving` · `saved` · `error` · `conflict`.
- Serializa pedidos: um de cada vez; alterações feitas durante uma gravação geram uma nova gravação no fim.
- `save` envia `baseRevision`. O servidor só aceita se `baseRevision === revision atual` e devolve `revision + 1`. Caso contrário devolve `conflict`, e nada é sobrescrito.
- «Guardado» só aparece depois da resposta com a revisão persistida.
- O autosave só é ligado depois de `load` + validação + `loadProjectData`. Nunca grava o estado vazio de arranque.
- Cada pedido leva `projectId` e um número de sequência. Uma resposta de outro projeto, ou obsoleta, é ignorada.
- Falha de rede: mantém `dirty` e permite repetir, sem perder alterações.

## Entidades (proposta proporcional ao MVP, Fase 1+)

`workspaces`, `workspace_members(role)`, `projects(id, workspace_id, name, status, current_revision, created_by, created_at, updated_at, archived_at)`, `project_revisions(project_id, revision, document jsonb, created_by, created_at)`, `templates`, `template_versions` (imutáveis), `assets(id, workspace_id, storage_path, mime, bytes, sha256)`, `asset_refs` (retenção por referência) e `import_reports`.

A escrita do documento e da revisão acontece numa função SQL transacional. A autorização usa RLS por `workspace_members`, com o mesmo modelo aplicado ao Storage. Serão testados dois utilizadores com acesso cruzado negado.

Undo/redo é da sessão (UndoManager). O histórico persistente é `project_revisions`. São dois mecanismos distintos.
