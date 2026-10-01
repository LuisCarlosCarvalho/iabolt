# Matriz de formatos de importação (inicial)

Todos os formatos passam pelo mesmo pipeline: receber → identificar → validar → analisar → converter → verificar assets → relatório/preview → confirmar → persistir. O resultado é sempre um `BoltDocument`.

| Formato | Deteção | Adaptador | Fase | Estado |
| --- | --- | --- | --- | --- |
| JSON Bolt IA | `boltSchemaVersion` | validar + migrar versões conhecidas + ids/permissões novos | 3 | pendente |
| JSON GrapesJS Core | `pages[].frames[].component` | validar tipos contra os registados | 3 | implementado e testado (mesmo adaptador do Studio) |
| JSON GrapesJS Studio (`.grapesjs`) | como acima + `custom.projectType`, `custom.plugins`, tipos Studio | mapear os tipos Studio para tipos Bolt; os não suportados ficam preservados e assinalados | 3 | implementado e testado com a amostra (`docs/08`) |
| HTML/CSS (ficheiro + recursos) | conteúdo começa por etiqueta | DOMParser + postcss; recursos indicados ou em falta (lista exata) | 3 | implementado (docs/20) |
| ZIP estático | assinatura PK + `.html` | resolver caminhos, `url()`, `srcset`, fontes, várias páginas | 3 | implementado (docs/20); amostra Stylish Portfolio |
| ZIP código-fonte (package.json, .php, .pug…) | manifesto | **diagnóstico apenas**; pedir exportação estática | 3 | nota no relatório; só HTML/CSS já gerados são importados |
| Elementor (`content`, `version`, `type`) | chaves de topo | adaptador por widget/versão | 3 | implementado para containers e para os widgets da amostra (heading, text-editor, image, image-box, button, icon-list, image-carousel, nested-accordion, html só com CSS); outros widgets ficam «não suportado» |
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

Resultado da implementação e validação: `docs/08`. Não há percentagens de fidelidade. A classificação (compatível/parcial/incompatível) será feita por elemento, com evidência.
