# Matriz de formatos de importação (inicial)

Todos os formatos passam pelo mesmo pipeline: receber → identificar → validar → analisar → converter → verificar assets → relatório/preview → confirmar → persistir. O resultado é sempre um `BoltDocument`.

| Formato | Deteção | Adaptador | Fase | Estado |
| --- | --- | --- | --- | --- |
| JSON Bolt IA | `boltSchemaVersion` | validar + migrar versões conhecidas + ids/permissões novos | 3 | pendente |
| JSON GrapesJS Core | `pages[].frames[].component` | validar tipos contra os registados | 3 | pendente |
| JSON GrapesJS Studio (`.grapesjs`) | como acima + `custom.projectType`, `custom.plugins`, tipos Studio | mapear os tipos Studio para tipos Bolt; os não suportados ficam preservados e assinalados | 3 | pendente |
| HTML/CSS colado | MIME/parse DOM | parser HTML/CSS real (nunca regex) | 3 | pendente |
| ZIP estático | manifesto com `.html` | resolver caminhos, `url()`, `srcset`, fontes, várias páginas | 3 | pendente |
| ZIP código-fonte (package.json, .php, .pug…) | manifesto | **diagnóstico apenas**; pedir exportação estática | 3 | pendente |
| Elementor (`content`, `version`, `type`) | chaves de topo | adaptador por widget/versão | 3 | pendente |
| JSON desconhecido | nenhuma regra | diagnóstico; nunca «projeto válido» | 3 | pendente |

## Evidência das amostras fornecidas (lidas a 28/09/2026, só leitura)

**`projeto-teste-2026-09-16-091529.grapesjs`** (156 KB): exportação da app GrapesJS Studio.

- Chaves: `dataSources, assets(45), styles(416), pages(1), symbols(0), custom`
- 474 nós; 332 com `attributes.id`
- Tipos Studio, que o Core não tem: `flex-column 80, flex-row 32, heading 28, svg-in 25, icon 21, linkBox 16, swiper* 20, navbar* 4`
- Estilos com `type: "data-variable"` ligados à dataSource `globalStyles`
- Plugin externo `StudioSdkPlugins_swiperComponent` 1.0.30 (jsdelivr)
- Assets em `cdn.grapesjs.com/workspaces/...`, de onde têm de ser copiados para o nosso Storage

**`[Modelo] [Elementor] Carla Santos.json`** (137 KB): `type: page`, `version: "0.4"`, containers modernos (flexbox).

- Contagem: `container 50, image 21, text-editor 21, heading 19, icon-list 8, button 4, image-carousel 4, image-box 1, nested-accordion 1, html 1`
- Riscos vistos: `custom_css` com `!important` no botão (Pro); widget `html` com `<style>` e possivelmente script (conteúdo não confiável); imagens em domínio WordPress externo; fontes Google (Bricolage Grotesque) por resolver.
- Prioridade do adaptador: heading, text-editor, image, button, container → icon-list, image-box → carrossel/accordion (com modelo e runtime próprios) → html (sandbox + relatório).

Não há percentagens de fidelidade. A classificação (compatível/parcial/incompatível) será feita por elemento, com evidência.
