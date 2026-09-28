# Contrato do documento e persistência

## Contrato `BoltDocument` v1

O documento editável canónico é o JSON de projeto do GrapesJS (`editor.getProjectData()`), guardado dentro de um envelope versionado:

```ts
{
  boltSchemaVersion: 1,                 // versão deste envelope; migrações explícitas 1→2…
  engine: { name: "grapesjs", version: "0.23.6" },
  projectId: string,                    // UUID atribuído por quem persiste
  revision: number,                     // inteiro ≥ 0, incrementado só por quem persiste
  projectData: GrapesProjectData        // pages, styles, assets, symbols, dataSources…
}
```

- A validação em runtime usa zod (`src/contract/boltDocument.ts`). O `projectData` é validado estruturalmente: páginas, frames e componentes com `type` e `attributes.id`. A validação profunda dos tipos de componente é feita pelo motor ao carregar.
- Nome, template de origem, datas, workspace e estado **não** vivem no envelope. São metadados (`ProjectSummary`), guardados em colunas próprias.
- HTML/CSS são exportação ou importação, nunca a forma persistida. As miniaturas do Dashboard são geradas do JSON a cada visualização e não são guardadas.
- Migrações: `parseBoltDocument` aceita só versões conhecidas. Uma versão desconhecida devolve erro explícito, sem tentativa de adivinhar.

## Camada única de persistência

`ProjectRepository` (`create`, `load`, `save`) e `ProjectCatalog` (acrescenta `mode`, `list`, `summary`, `rename` e `archive`) em `src/persistence/repository.ts`.

| Adaptador | Onde grava | Uso | Estado |
| --- | --- | --- | --- |
| `SupabaseRepository` | Postgres (Supabase) | produto, **modo servidor** | implementado; SQL e RLS testados em Postgres (PGlite); **não executado contra um projeto Supabase real** (falta configuração, ver `docs/06`) |
| `IndexedDbRepository` | IndexedDB do browser | produto, **modo local** (sem servidor configurado) | implementado e testado (unitário e E2E) |
| `MemoryRepository` | memória | testes | testado |
| `LocalDevRepository` | localStorage | só a rota de diagnóstico `/prova-tecnica` | Fase 0 |

`SaveQueue` é a única via de gravação, usada tanto pelo botão Guardar e Ctrl+S como pelo autosave (1,2 s depois da última alteração):

- Estados: `saved` ("Alterações guardadas no servidor" ou "… neste browser") · `dirty` · `saving` · `error` · `conflict`.
- Serializa pedidos: um de cada vez. Alterações feitas durante uma gravação geram nova gravação no fim.
- `save` envia `baseRevision`. Quem persiste só aceita se `baseRevision === revisão atual` e devolve `revisão + 1`. Caso contrário devolve `conflict`, e nada é sobrescrito.
- «Guardado» só aparece depois da resposta com a revisão persistida (transação IndexedDB concluída, ou `save_project` devolvido pelo servidor).
- O autosave só é ligado depois de `load`, validação e `loadProjectData`. Nunca grava o estado vazio de arranque.
- Antes de gravar, a edição de texto em curso no canvas é sincronizada com o modelo.
- Falha: mantém as alterações no editor, mostra o erro e permite repetir. Sair do editor com falha ou conflito pede confirmação.

## Base de dados (Supabase)

Migrações em `supabase/migrations/`:

- `…_projetos_e_revisoes.sql`: `workspaces`, `workspace_members(role owner|editor|viewer)`, `projects` e `project_revisions`. Inclui o trigger que cria um workspace pessoal para cada conta nova.
- `…_storage_imagens.sql`: bucket `project-assets`, com escrita só na pasta `<workspace_id>/…` para editores. A leitura é pública por URL, porque as imagens vão aparecer nas páginas publicadas. SVG está excluído.

**Via única de gravação no servidor:** o cliente (`authenticated`) só tem `SELECT` e `UPDATE (name, archived_at)` em `projects`. Criar e gravar o documento só é possível pelas funções:

- `create_project(idempotency_key, …)`: idempotente por utilizador. Escolhe o workspace pessoal, valida a estrutura e grava a revisão 0.
- `save_project(project_id, base_revision, project_data)`: `UPDATE … WHERE current_revision = base_revision` (atómico). Devolve `saved` com a nova revisão ou `conflict`, e cada gravação fica em `project_revisions`.

Ambas são `SECURITY DEFINER`, com verificação explícita de `auth.uid()` e de membro com papel `owner`/`editor`. Quem não é membro recebe `project_not_found`, sem saber se o projeto existe. Projetos arquivados deixam de aceitar gravações. Não há `DELETE`.

**Verificado** (`tests/db/db.rls.test.ts`, 9 casos) executando as migrações reais num Postgres em WASM:

- workspace pessoal criado com a conta;
- criação idempotente;
- conflito sem sobrescrita;
- recusa de escrita direta no documento;
- documento inválido recusado;
- isolamento completo entre dois utilizadores (ler, gravar, renomear, criar no workspace alheio);
- `anon` sem acesso;
- arquivado sem gravações;
- Storage só na pasta do próprio workspace.

O schema `auth`/`storage` do Supabase é substituído no teste por um equivalente mínimo. Falta repetir estes casos contra o projeto Supabase real.

## Entidades ainda por implementar (fases seguintes)

`templates` e `template_versions` (biblioteca de templates importados e modificados, imutáveis por versão), `assets` e `asset_refs` (retenção por referência) e `import_reports`. Retenção de `project_revisions`: hoje cada gravação guarda o documento completo, e a política de limpeza fica por definir.

Undo/redo é da sessão (UndoManager). O histórico persistente é `project_revisions`. São dois mecanismos distintos.
