# Assistente IA · proposta concreta (por aprovar)

Estado: **proposta aprovada como direção** (29/09/2026). A versão 1 está preparada, mas não ativada: ver `docs/14-assistente-ia-v1.md`.

Estado original: **proposta**. Nada contratado, nenhuma chave configurada, nenhuma integração externa implementada. Complementa o plano funcional em `docs/09-plano-assistente-ia.md`, que se mantém: operações validadas, pré-visualização, confirmação e desfazer único.

## Fornecedor e modelo sugeridos

**Anthropic · Claude Sonnet 5.5** (`claude-sonnet-5-5`), chamado apenas a partir de uma função no servidor.

Motivos:

- **Respostas estruturadas fiáveis.** O assistente só pode devolver uma lista de operações num esquema fixo (ferramenta/JSON com esquema). O esquema é validado com zod no servidor e no cliente, e o texto livre é recusado.
- **Custo equilibrado.** Custa metade do Opus 5.5 por token e tem cache do prompt de sistema, que é grande e igual em todos os pedidos.
- **Contexto suficiente** para o âmbito «página», que é o caso mais pesado.
- **Transparência:** este plano foi escrito por um modelo da Anthropic. A escolha deve ser validada com o teste comparativo abaixo, com as três alternativas, antes de contratar.

## Alternativas

| Opção | Preço (USD por milhão de tokens: entrada / saída / leitura de cache) | Quando faz sentido |
| --- | --- | --- |
| **Claude Sonnet 5.5** (sugerido) | 2,00 / 10,00 / 0,20 | equilíbrio entre qualidade das operações e custo |
| Claude Haiku 4.5 | 1,00 / 5,00 / 0,10 | pedidos simples (reescrever textos, trocar cores); cerca de metade do custo |
| Claude Opus 5.5 | 4,00 / 20,00 / 0,20 | reorganizar uma página inteira; o dobro do Sonnet |
| OpenAI gpt-6-sol | 2,00 / 10,00 / 0,20 | mesmo preço do Sonnet; alternativa direta |
| Google Gemini 3.1 Pro (preview) | 2,00 / 12,00 / 0,20 (até 200 mil tokens) | ainda em pré-visualização; preço sobe acima de 200 mil tokens |
| Google Gemini 3.8 Flash | 0,75 / 3,75 / 0,075 até 31/12/2026; o dobro a partir de 1/1/2027 | a mais barata. Preço promocional com data de fim |

- Preços das páginas oficiais consultadas a 29/09/2026: claude.com/pricing, developers.openai.com/api/docs/pricing e ai.google.dev/gemini-api/docs/pricing.
- A Anthropic cobra 1,1× por inferência apenas nos EUA. Não é necessária.
- Podem mudar; confirmar antes de contratar.

**A função no servidor usa um adaptador por fornecedor.** Mudar de fornecedor ou de modelo é configuração, não reescrita. Os testes usam um fornecedor simulado.

## Custo estimado por utilização (revisto a 29/09/2026)

> **Todos os valores mensais abaixo são ESTIMATIVAS de consumo, não limites.** O único teto real é o **orçamento mensal configurado no servidor** (`AI_MONTHLY_BUDGET_USD`), aplicado antes de cada chamada (ver `docs/14`). A versão anterior desta secção chamava «máximo» a um cenário, o que estava errado.

### Premissas (versão 1: âmbito «elemento»; tamanhos medidos no código)

- **Prefixo fixo** (instruções + esquema da ferramenta): 2 004 + 1 681 caracteres. São cerca de 1 250 tokens, mais cerca de 300 tokens que o fornecedor acrescenta para o uso de ferramentas; no total, **cerca de 1 550 tokens**. Este prefixo é cacheável: passa o mínimo de 1 024 tokens, a confirmar na bateria real.
- **Pedido e contexto do elemento:** um título com 12 estilos com origem ocupa 2 877 caracteres, ou seja, **cerca de 960 tokens**.
- **Resposta:** 1 a 3 operações, **cerca de 300 tokens**.
- **Repetições:** 10% dos pedidos repetem uma vez (resposta inválida), ou seja, **×1,10** em média.
- **Cache** (duração de 5 minutos):
  - a primeira chamada de cada janela paga a **escrita** (2,50 USD por milhão de tokens);
  - as seguintes pagam a **leitura** (0,20 USD por milhão);
  - numa sessão de trabalho estima-se **30% de escritas e 70% de leituras**.
- **Preços:** Claude Sonnet 5.5, em USD por milhão de tokens: entrada 2, saída 10, escrita de cache 2,50, leitura de cache 0,20. Sem IVA e sem o custo da função no Supabase.

### Custo por pedido (USD, Sonnet 5.5)

| Caso | Cálculo | Custo |
| --- | --- | --- |
| Sem cache | 2 510 × 2 + 300 × 10 | 0,0080 |
| Com escrita da cache | 1 550 × 2,5 + 960 × 2 + 300 × 10 | 0,0088 |
| Com leitura da cache | 1 550 × 0,2 + 960 × 2 + 300 × 10 | 0,0052 |
| **Média com cache** (30% escrita, 70% leitura, +10% repetições) | | **≈ 0,0069** |
| **Média sem cache** (+10% repetições) | | **≈ 0,0088** |
| Máximo **reservado** por pedido (revisto: 1 token por byte + margem de 1 000, entrada ao preço de escrita de cache, saída máxima de 1 500, 2 tentativas; ver `docs/14`) | | 0,069 |

### Estimativas por mês

| Cenário | Pedidos por mês | Com cache | Sem cache |
| --- | --- | --- | --- |
| Piloto: 5 pessoas × 20 por dia útil × 22 dias | 2 200 | ≈ 15 USD | ≈ 19 USD |
| Piloto, mês inteiro (30 dias) | 3 000 | ≈ 21 USD | ≈ 26 USD |
| Equipa: 20 pessoas × 30 por dia útil × 22 dias | 13 200 | ≈ 91 USD | ≈ 116 USD |
| Equipa, mês inteiro (30 dias) | 18 000 | ≈ 124 USD | ≈ 158 USD |
| 20 pessoas sempre no limite diário (50) durante 30 dias | 30 000 | ≈ 208 USD | ≈ 265 USD |

- Em teoria, o pior caso de 30 000 pedidos, todos com saída máxima e repetição, chegaria a cerca de 2 060 USD (30 000 × 0,069). É exatamente isso que o orçamento mensal do servidor impede: a reserva de cerca de 0,069 USD por pedido é feita antes da chamada, e o pedido é recusado quando não cabe no orçamento.
- **Recomendação para o piloto:** um orçamento de 25 USD (o valor por omissão) e, na consola do fornecedor, um limite de gasto como segunda proteção, sem depender só dele.
- Âmbitos maiores (secção, página), numa etapa seguinte, terão contextos maiores. As estimativas serão refeitas com as medições da bateria real (`npm run test:ai-pilot`).

## Configuração necessária (quando aprovar; nada disto foi feito)

1. **Conta no fornecedor**, com faturação e limite de gasto mensal. A contratação é feita por si.
2. **Chave de API** guardada **só** como segredo da função no Supabase, com `supabase secrets set ANTHROPIC_API_KEY=…`, executado por si. Nunca vai para o browser, o `.env.local` do frontend nem o repositório.
3. **Função no servidor** `ai-propose` (Supabase Edge Function). Responsabilidades:
   - exigir sessão válida e pertença ao workspace;
   - validar o pedido e a resposta com zod;
   - aplicar os limites;
   - chamar o fornecedor através do adaptador;
   - nunca devolver a chave nem o prompt de sistema.
4. **Migração** com a tabela `ai_usage` (utilizador, workspace, data, pedidos, tokens), protegida por RLS, para os limites e o controlo de custos. Só é aplicada com autorização.
5. **Variáveis da função:** `AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5-5` e `AI_DAILY_LIMIT=50`. Tempo limite de 30 s.
6. **Dados enviados ao fornecedor:**
   - só o texto, a estrutura e os estilos próprios do âmbito escolhido;
   - nunca imagens em data URL, credenciais ou o documento inteiro, a menos que o âmbito seja «página».
   - Os termos de retenção de dados do fornecedor devem ser revistos antes de ativar.
7. **Modo local:** o assistente funciona só com o fornecedor simulado (respostas fixas), para desenvolvimento e testes E2E.

## Escopo da primeira entrega

**Incluído**

- A ferramenta «Assistente IA» na barra lateral.
- **Âmbito sempre escolhido explicitamente:** elemento, secção ou página. Sem escolha, não envia. Isto adota o ponto de revisão 1.
- **Operações da versão 1:**
  - `setText`, `setLink`, `setTextTag` e `setOwnStyle` (por dispositivo);
  - `insertAt` (só blocos do catálogo existente), `move`, `duplicate` e `remove`;
  - ~~`setGlobalStyle`~~ — **decidido a 29/09/2026:** fica para uma etapa própria, com âmbito explícito «Site inteiro» e confirmação do impacto nas várias páginas.
- **Validação** contra o documento atual:
  - ids e destinos (pai e posição) dentro do âmbito (ponto 3);
  - `canInsert`/`canPlace`;
  - só as propriedades editáveis;
  - URLs sem `javascript:`.
- **Proposta ligada à revisão do documento.** Se o documento mudou entretanto, a proposta fica inválida e é preciso gerar outra (ponto 2).
- **Pré-visualização** antes/depois numa cópia headless, com a lista de alterações em linguagem simples.
- **Aplicar:** um único grupo no histórico, portanto um só «Desfazer». Se falhar a meio, o documento volta exatamente ao estado anterior e não aparece mensagem de sucesso (ponto 4).
- **Cancelar** não deixa rasto. Erros de rede, do fornecedor, de limite ou de validação levam a «nada foi alterado».
- Gravação pela via única existente (SaveQueue).
- **Testes:**
  - unitários do validador e da aplicação atómica;
  - E2E com o fornecedor simulado (prévia, confirmar, cancelar, erro sem alterações, desfazer único, gravar e reabrir);
  - testes da função no servidor: sem sessão → recusado; limites; a chave nunca aparece na resposta nem no bundle. Ficam **pendentes** até a função existir no seu projeto Supabase.

**Fora da primeira entrega**

- `setImage` e geração de imagens;
- `setCarouselConfig` e `setInput`;
- conversa com histórico e respostas em streaming;
- publicação, edição de código, importação HTML/ZIP.

## Decisões (29/09/2026)

- Modelo do piloto: **Claude Sonnet 5.5** como candidato, através do adaptador. A superioridade face às alternativas **não está comprovada**; será avaliada com a bateria real.
- A versão 1 cobre só o elemento selecionado (texto, ligação, nível do título, estilos próprios no dispositivo escolhido). Ver `docs/14`.
- Os limites finais do piloto e a ativação paga ficam para decidir depois.

## Decisões pedidas (versão original)

1. O fornecedor e o modelo: Sonnet 5.5 sugerido, ou uma das alternativas.
2. O limite diário por pessoa (proposta: 50) e o limite de gasto mensal na consola.
3. A autorização para criar a função `ai-propose` e a migração `ai_usage` (recursos no seu projeto Supabase).
4. Se `setGlobalStyle` entra já na versão 1.
