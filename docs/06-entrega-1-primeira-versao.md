# Entrega 1 · primeira versão utilizável

Execução local a 28/09/2026 · Windows 11 · Node v24.18.0 · Chromium 153 (Playwright 1.63).

## Resultados executados

| Comando | Exit | Resultado |
| --- | --- | --- |
| `npm run check` | 0 | typecheck OK · lint OK · **50/50** testes (6 ficheiros) · build OK · diff-check OK |
| `npm test`: Fase 0 (`engine.poc`, `saveQueue`) | 0 | 18/18, inalterados |
| `npm test`: fatia (`slice`, `indexedDbRepository`, `assetsAndTransfer`) | 0 | 23/23 |
| `npm test`: base de dados (`tests/db`, PGlite) | 0 | 9/9 |
| `npm run test:e2e` (modo local, porta 5175) | 0 | **14/14**: 12 do produto + 2 da prova da Fase 0 (`/prova-tecnica`) |
| `npm run test:server` / `npm run test:e2e:server` | — | **por executar**: exigem o projeto Supabase (`docs/07`). Sem configuração, falham com «Falta VITE_SUPABASE_URL…» (verificado) |

Aviso do build (não é erro): chunk JS de ~1,4 MB, sobretudo GrapesJS. A divisão de código fica para a Fase 2.

## Funciona e está testado (modo local)

- **Dashboard** (`/`):
  - lista de projetos com miniatura real, nome, «Atualizado há…» e template de origem;
  - estados de carregamento, vazio e erro (o vazio tem teste E2E; o carregamento e o erro estão implementados, sem teste dedicado);
  - mudar o nome e remover (arquivar), com teste E2E.
  - Abrir sem parâmetros não cria projetos (E2E).
- **Biblioteca** (`/templates`):
  - Nimbus (produto digital, logótipo em texto), Vértice (serviços, logótipo em imagem) e página em branco;
  - pré-visualização em computador, tablet e telemóvel.
  - Cada projeto é uma cópia independente: editar um projeto não altera o template nem outros projetos (unitário e E2E).
- **Editor** (`/projetos/:id`):
  - canvas GrapesJS;
  - árvore com nomes compreensíveis e arrastar para reordenar, recusando destinos inválidos;
  - painel de propriedades;
  - biblioteca de 6 componentes básicos (clicar ou arrastar);
  - barra contextual (selecionar pai, subir, descer, duplicar, eliminar);
  - computador, tablet e telemóvel;
  - guardar (botão, Ctrl+S e autosave), desfazer e refazer.
- **Edição que sobrevive a guardar e reabrir** (E2E, com reabertura pela lista e com F5):
  - texto pelo painel e diretamente no canvas;
  - texto e destino de botões e ligações;
  - carregar e substituir imagens;
  - duplicar, eliminar e reordenar;
  - cor por dispositivo.
  - Tipografia, espaçamento e alinhamento usam a mesma via de estilos, com teste unitário.
- **Gravação:** «Alterações guardadas neste browser» só aparece depois de a transação IndexedDB terminar com a nova revisão. Testado em E2E:
  - conflito entre separadores: avisado, nada sobrescrito;
  - falha de gravação: erro visível, nunca «guardado», confirmação ao sair.
- **Projetos locais:** «Exportar cópia de segurança» descarrega todos os projetos (E2E).
- **Sem identificadores técnicos na interface principal:** ids, revisão e tipo interno ficam em «Diagnóstico técnico», fechado por omissão (verificado em E2E).

## Implementado, testado parcialmente (modo servidor)

- Migrações Supabase, RLS, funções `create_project`/`save_project` e Storage: **executadas e testadas em Postgres (PGlite)**, com dois utilizadores isolados (`docs/02`).
- `SupabaseRepository`, `SupabaseAssetStore` e login com email e palavra-passe: compilam e passam o lint. Com as variáveis definidas, a aplicação mostra o login e não recorre ao modo local (verificado no browser com valores fictícios, sem pedidos à rede).
- **Não executado contra um projeto Supabase real:** o projeto ainda não existe.

## Consolidação antes do servidor real

- **Imagens privadas:** o bucket passou a privado. O documento guarda `bolt-asset:<caminho>` e o editor mostra URLs assinados temporários. A migração foi alterada antes de ser aplicada a qualquer base de dados.
- **Projetos do modo local:** não são apagados ao ativar o servidor. Em modo servidor, o Dashboard mostra-os e oferece «Copiar para a minha conta» (idempotente) e «Exportar cópia de segurança».
- **Testes separados por porta:** os E2E locais usam a porta 5175 e os do servidor a 5176. O servidor de desenvolvimento em 5173 não é parado.
- **Validação no servidor real:** escrita (`tests/server`, `tests/e2e-server`), à espera da configuração.

## O que é preciso de si para ativar o servidor

Todos os passos, incluindo migrações, autenticação, Storage, variáveis e validação, estão em `docs/07-configurar-supabase.md`.

## Limitações reais

- **Modo local:** os dados ficam só neste browser e perdem-se se os dados do site forem limpos. As imagens carregadas ficam embutidas no documento (data URL, reduzidas a 1600 px), por isso o projeto cresce. Ao copiar para a conta, essas imagens seguem dentro do documento (não são enviadas para o Storage).
- **Cópia de segurança:** o ficheiro ainda não se importa pela interface (importadores são da fase 3).
- **Imagens no servidor:** os URLs assinados valem 12 h. Uma sessão de edição aberta mais tempo pode precisar de recarregar para voltar a mostrar imagens.
- **Mover no canvas:** a barra de ferramentas nativa do GrapesJS está desligada. Move-se pela árvore (arrastar) ou pelas setas da barra contextual. Os componentes novos podem ser arrastados para o canvas.
- **Formatação de texto:** a barra de edição de texto é a do GrapesJS (negrito, itálico, sublinhado, riscado, ligação), com dicas em inglês. Textos com formatação só se editam no canvas.
- **Seletor de cor:** arrastar o seletor cria vários passos de desfazer.
- **Templates:** vivem no código. A biblioteca persistida, com templates importados e modificados e versões, é da Fase 2.
- **Histórico no servidor:** cada gravação guarda o documento completo em `project_revisions`, e a política de retenção fica por definir.
- **Fora desta entrega:** importadores, IA e publicação. Não aparecem na interface.
