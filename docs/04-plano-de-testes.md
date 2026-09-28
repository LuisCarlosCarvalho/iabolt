# Plano de testes

## Fase 0 (escritos, por executar)

**Unitários, Vitest + jsdom, motor headless** (`tests/unit/engine.poc.test.ts`):

- Componentes reais: tipo, id e hierarquia de logo textual, logo de imagem, secção, título, texto, botão e imagem.
- Ids persistidos em todos os componentes do JSON.
- Selecionar pai: um nível de cada vez, parando na raiz.
- Editar texto + undo; o logo textual continua texto e o de imagem continua imagem; `setText` numa imagem é recusado.
- Duplicar secção: ids novos em toda a subárvore, sem colisões, clone selecionado, original intacto.
- Mover para outro pai + undo repõe pai e índice; mover para dentro de si próprio é recusado.
- Eliminar: sai do modelo, a seleção passa ao irmão seguinte, e o undo repõe.
- Serializar → novo editor → árvore (ids e tipos) e conteúdo iguais.
- Envelope `BoltDocument`: aceita o JSON do motor e recusa versões e formatos desconhecidos.

**Persistência** (`tests/unit/saveQueue.test.ts`): criação idempotente; conflito por revisão sem sobrescrita; «Guardado» só após a revisão ser devolvida; falha de rede e repetição; serialização de pedidos; conflito entre separadores; resposta ignorada após navegação.

**Browser, Playwright** (`tests/e2e/poc.spec.ts`): clicar no canvas (iframe) → selecionar pai → duplicar → guardar → F5 → mesmo URL/projeto, 2 secções, id do clone presente, conteúdo intacto. Também eliminar + desfazer no browser.

**Limite declarado:** na Fase 0 a persistência é o `LocalDevRepository` (localStorage), que **não prova persistência no servidor**. Essa prova é da Fase 1: novo contexto de browser autenticado, sem cache.

## Fase 1+

Contexto novo de browser autenticado; dois utilizadores com acesso cruzado negado (BD e Storage); falha de rede real; conflito entre dois browsers; RLS testada com pedidos diretos.
