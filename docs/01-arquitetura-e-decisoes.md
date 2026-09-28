# Arquitetura e decisões (Fase 0)

Estado: **em vigor na entrega 1 (primeira versão utilizável)** · 28/09/2026

Cada decisão indica a evidência consultada. O que não foi verificado aparece como tal.

## D1 · Motor de edição: GrapesJS Core (recomendação firme)

- Versão alvo: **grapesjs 0.23.6**. É a última tag estável no GitHub e foi publicada a 25/08/2026 (commit `2bdeda8`). O `packages/core/package.json` dessa tag declara a licença **BSD-3-Clause**.
  Verificado com `git ls-remote` e com o código-fonte da tag. **Confirmado no registo npm** a 28/09/2026 (`npm view grapesjs@0.23.6 version license` → `0.23.6`, `BSD-3-Clause`). Instalado e fixado no lockfile.
- As APIs em que a arquitetura assenta foram conferidas no código-fonte da tag v0.23.6:
  - `editor.getProjectData()` / `editor.loadProjectData()` (`editor/index.ts`)
  - `Component.getId()` usa `attributes.id`, depois `ccid`. `Component.createId()` resolve colisões com sufixo incremental e regista `idMap` (`dom_components/model/Component.ts`).
  - `Component.clone()` gera identidades novas, clona as regras CSS `#id` para o novo id e emite `component:clone`.
  - `toJSON()` só persiste `attributes.id` quando é necessário (estilo por id, símbolo, script). **Por isso o Bolt IA força o id em todos os componentes** (ver D4).
  - Eventos `component:add|remove|move|clone|create|select|update` (`dom_components/types.ts`).
  - O modo `headless: true` existe (`editor/config/config.ts`) e o próprio projeto testa o core em jsdom.
- Motivos: é open-source e sem custo por sessão ou domínio. Dá o modelo de componentes em árvore, o UndoManager, as páginas, os estilos com breakpoints, os símbolos e o JSON de projeto canónico. Tudo isto responde diretamente às lições 1, 2, 3 e 5 do projeto anterior.
- Custo: a interface (painéis, navigator estilizado, gestor de estilos, toolbar) é construída por nós em React, sobre as APIs do motor.

## D2 · Studio SDK: não adotar agora (avaliação)

| | Core | Studio SDK |
| --- | --- | --- |
| Licença | BSD-3-Clause | Comercial (Grapes Studio Inc.). Funciona em localhost sem licença; **num domínio público exige licença** (docs-sdk/overview/licenses) |
| Custo publicado (grapesjs.com/sdk/pricing, consultado a 28/09/2026) | 0 | Free: 1 000 sessões/mês, 100 MB, 1 domínio, marca Studio visível · Startup: 200 $/mês, 20 000 sessões, custom branding · Business: 2 000 $/mês · Enterprise: sob consulta |
| Interface pronta | Não (fazemos nós) | Sim: layout, painéis, asset manager, temas, plugins |
| Persistência | Livre | `storage.type: "self"` com `onSave`/`onLoad`, ou cloud da Grapes. O formato é o mesmo JSON de projeto |
| Componentes extra | Não incluídos | `flex-row/column`, `heading`, `linkBox`, `icon`, `navbar`, `swiper`… (vistos na amostra `.grapesjs`) |
| Dependência | Nenhuma externa | Pacote e plugins servidos pela Grapes; limites de sessões; marca no plano gratuito |

**Benefícios do SDK:** reduz semanas de interface. Carrega nativamente projetos criados na app GrapesJS Studio, como a amostra `projeto-teste-2026-09-16-091529.grapesjs`.

**Requisitos antes de qualquer adoção:** o seu aval explícito; plano e custo mensal aceites; os termos de licença completos (a página de licenças não detalha restrições nem acesso ao código); a confirmação de que `storage.type: "self"` mantém os dados só no nosso Supabase; e um orçamento de sessões.

**Não adotar** os dois como motores alternativos em runtime (regra da especificação).

**Consequência concreta de ficar no Core:** a amostra Studio usa tipos que o Core não tem. Importá-la exige um adaptador que registe tipos compatíveis ou os converta (ver matriz, 04).

## D3 · Stack da aplicação

React + TypeScript estrito + Vite; Vitest (jsdom) + Playwright; Supabase (Postgres, Auth e Storage) com as migrações em `supabase/migrations`; API de servidor para IA e operações privilegiadas (fases seguintes); Vercel após autorização.

**Desvio registado:** a interface usa CSS próprio com tokens (`src/app/app.css`) em vez de Tailwind. Numa interface pequena, evita mais uma camada de build. Pode ser revisto sem tocar no motor nem na persistência.

As versões foram confirmadas com `npm view` a 28/09/2026 e **estão fixadas** com versão exata no `package.json` e no `package-lock.json`. A lista completa está em `docs/05`.

| Pacote | Versão fixada | Nota |
| --- | --- | --- |
| vite | 8.3.1 | |
| vitest | 5.0.2 | |
| react | 19.3.0 | |
| zod | 4.6.5 | validação do contrato |
| @playwright/test | 1.63.0 | Chromium 153.0.8010.12 (`npx playwright install chromium`) |
| typescript | **6.0.3** | **não** o 7.0.2: o typescript-eslint 8.70.1 declara `typescript >=4.8.4 <6.1.0`. 6.0.3 é a última versão dentro desse intervalo. Rever quando o typescript-eslint suportar o TS 7 |
| typescript-eslint | 8.70.1 | |
| eslint | 10.11.0 | |
| @supabase/supabase-js | 2.117.2 | cliente do servidor (Auth, RPC, Storage) |
| lucide-react | 1.48.0 | ícones da interface |
| @electric-sql/pglite | 0.5.8 | **só testes**: Postgres real em WASM para executar as migrações e a RLS |
| fake-indexeddb | 6.2.5 | **só testes**: IndexedDB para o repositório local |

Node: **24** (`.nvmrc`). A Fase 0 foi executada com o Node v24.18.0 na máquina local (Windows 11). O `package.json` mantém `engines.node >=22.12`, mas o Node 22 não foi testado localmente.

## D4 · Identidade de componentes

- A identidade Bolt é o `attributes.id` do GrapesJS, **persistido em todos os componentes** exceto `textnode`. Um plugin (`src/engine/identity.ts`) chama `setId(getId())` em `component:add` e `component:create`, e faz uma varrida após `loadProjectData`.
- Nunca usar índices como identidade. A seleção, o Navigator e as operações referem sempre o id.
- Duplicar usa `Component.clone()`, que detecta a colisão e gera um id novo. Referências internas (âncoras `#id`, `label[for]`, `aria-*`) são remapeadas com o `idMap` na Fase 2. A Fase 0 só prova identidades novas.

## D5 · Fronteira React ↔ motor

O GrapesJS é dono do documento. O React guarda apenas estado transitório (painel aberto, diálogo, preferências) e lê o motor por eventos (`src/editor/useEditorTick.ts`). Não existe cópia da árvore em store.

- Nomes para o utilizador ("Título", "Imagem", "Secção") são **derivados** do modelo (`src/engine/labels.ts`) e nunca gravados. O destaque do canvas usa os mesmos nomes.
- Estilos editados no painel vão para a regra `#id` do elemento, no media query do dispositivo ativo (`src/engine/styles.ts`). Ficam no JSON de projeto e o desfazer do motor cobre-os.
- Cada dispositivo tem a sua largura real na moldura do canvas (computador 1280 px, tablet 768 px, telemóvel 375 px). O editor ajusta o zoom do motor para caber, por isso cada pré-visualização aplica as regras do seu próprio breakpoint.
- As posições válidas são regras dos tipos no motor (`draggable`/`droppable`), validadas com `Components.canMove`. A árvore, os botões e a inserção de blocos usam a mesma regra.

## D6 · Organização

Aplicação modular única (sem monorepo). Existem hoje: `contract`, `engine`, `persistence`, `assets`, `auth`, `app` (moldura, rotas, serviços), `dashboard`, `library` (biblioteca de templates), `templates` (definições) e `editor`. `poc` fica como rota de diagnóstico (`/prova-tecnica`). Ainda por criar: `importers`, `ai` e `publish`. Todos vão produzir ou consumir o mesmo `BoltDocument`, sem modelo de página concorrente.

## D7 · Destino de persistência

- Há **um** destino ativo por sessão. Com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` definidos, é o servidor: exige sessão iniciada e usa `SupabaseRepository` e `SupabaseAssetStore`. Sem eles, é o modo local (`IndexedDbRepository`, `LocalAssetStore`).
- Não há recurso silencioso de um para o outro. O modo local está sempre identificado na interface ("Modo local · só neste browser", "Alterações guardadas neste browser").
- Os dois modos implementam o mesmo `ProjectCatalog` e passam pela mesma `SaveQueue`, que é a única via de gravação.

## Bloqueios

**Resolvidos (28/09/2026):** o registo npm estava bloqueado na sessão cloud (`Host not in allowlist: registry.npmjs.org`, HTTP 403). O projeto passou a correr na máquina local, onde as dependências foram instaladas e a prova foi executada (`docs/05`). Na sessão cloud, `grapesjs.com` e `app.grapesjs.com` também estavam bloqueados para o shell, e a documentação foi lida pela ferramenta de leitura web.

**Em aberto:**

- A referência `app.grapesjs.com/project/x2cjozzzuqnvj5a1qzwtv0vf` **não foi aberta**, e não foram fornecidos prints ou vídeos. Não há observações sobre ela.
