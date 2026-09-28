# Arquitetura e decisões (Fase 0)

Estado: **proposta para aprovação** · 28/09/2026

Cada decisão indica a evidência consultada. O que não foi verificado aparece como tal.

## D1 · Motor de edição: GrapesJS Core (recomendação firme)

- Versão alvo: **grapesjs 0.23.6**. É a última tag estável no GitHub e foi publicada a 25/08/2026 (commit `2bdeda8`). O `packages/core/package.json` dessa tag declara a licença **BSD-3-Clause**.
  Verificado com `git ls-remote` e com o código-fonte da tag. **Por confirmar no registo npm**, que está bloqueado nesta sessão (ver «Bloqueios»).
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

React + TypeScript estrito + Vite; Tailwind + componentes acessíveis; Vitest (jsdom) + Playwright; Supabase (projeto novo, na Fase 1); API de servidor para IA e para operações privilegiadas; Vercel após autorização.

As versões candidatas foram lidas das tags do GitHub a 28/09/2026. **Não estão fixadas**: serão confirmadas com `npm view` e ficam gravadas no lockfile quando o registo estiver acessível.

| Pacote | Última tag GitHub | Nota |
| --- | --- | --- |
| vite | v8.3.1 | |
| vitest | v5.0.2 | |
| react | v19.3.0 | |
| zod | v4.6.5 | validação do contrato |
| @playwright/test | v1.63.0 | no ambiente cloud há Chromium do Playwright 1.56 |
| typescript | v7.0.2 | **risco:** TS 7 é o compilador nativo novo; confirmar compatibilidade com typescript-eslint (v8.70.1) antes de fixar. Alternativa: a última 5.x/6.x suportada |
| eslint | v10.11.0 | |

Node: 22.22.2 no ambiente de desenvolvimento cloud. Fica registado em `.nvmrc`; a versão final é fixada quando o projeto correr na sua máquina.

## D4 · Identidade de componentes

- A identidade Bolt é o `attributes.id` do GrapesJS, **persistido em todos os componentes** exceto `textnode`. Um plugin (`src/engine/identity.ts`) chama `setId(getId())` em `component:add` e `component:create`, e faz uma varrida após `loadProjectData`.
- Nunca usar índices como identidade. A seleção, o Navigator e as operações referem sempre o id.
- Duplicar usa `Component.clone()`, que detecta a colisão e gera um id novo. Referências internas (âncoras `#id`, `label[for]`, `aria-*`) são remapeadas com o `idMap` na Fase 2. A Fase 0 só prova identidades novas.

## D5 · Fronteira React ↔ motor

O GrapesJS é dono do documento. O React guarda apenas estado transitório (painel aberto, diálogo, preferências) e lê o motor por eventos. Não existe cópia da árvore em store.

## D6 · Organização

Aplicação modular única (sem monorepo): `contract`, `engine`, `persistence`, `projects`, `editor`, `importers`, `templates`, `assets`, `ai`, `publish`. Na Fase 0 só existem `contract`, `engine` e `persistence`.

## Bloqueios em 28/09/2026

- **Registo npm bloqueado** pela política de rede da sessão: `Host not in allowlist: registry.npmjs.org` (HTTP 403). Impede instalar dependências e executar a prova. Para desbloquear, adicionar `registry.npmjs.org` aos domínios permitidos.
- `grapesjs.com` e `app.grapesjs.com` também estão bloqueados para o shell. A documentação foi lida pela ferramenta de leitura web.
- A referência `app.grapesjs.com/project/x2cjozzzuqnvj5a1qzwtv0vf` **não foi aberta**, e não foram fornecidos prints ou vídeos. Não há observações sobre ela.
