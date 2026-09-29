# Assistente de IA no editor · plano (não implementado)

Estado: **proposta**. Nada disto existe no código. A proposta concreta (fornecedor, custos, configuração e escopo da 1.ª entrega) está em `docs/13-proposta-assistente-ia.md`. A implementação precisa da sua autorização, porque cria recursos externos: chave de um fornecedor de IA e função no servidor.

## Princípio

O assistente não escreve HTML nem mexe no documento diretamente. Produz uma **lista de operações** sobre o modelo do editor, as mesmas que a interface já usa:

- `setText`, `setLink`, `setImage` e `setOwnStyle` (por dispositivo);
- `insertAt`, `move`, `duplicate` e `remove`;
- `setTextTag`, `setInput` e `setCarouselConfig`.

As operações são validadas, pré-visualizadas e só são aplicadas quando o utilizador confirma. A gravação continua a ser a única existente (`SaveQueue` → `ProjectRepository`), com as revisões otimistas de sempre.

## Percurso

1. **Âmbito explícito.** O utilizador escolhe o que o pedido abrange: o elemento selecionado, a secção desse elemento ou a página. O âmbito aparece no painel do assistente («Pedido sobre: Secção · Hero»). Sem seleção, o âmbito é a página.
2. **Contexto enviado.** Só vai a subárvore do âmbito, em JSON reduzido: ids, tipos, textos, atributos editáveis e estilos próprios. Não vão imagens em data URL nem o documento inteiro, a não ser com âmbito «página».
3. **Pedido ao servidor.** Uma função no servidor (Supabase Edge Function ou equivalente) chama o fornecedor. **A chave do fornecedor só existe no servidor**, nunca no browser nem no repositório. A função exige sessão válida e aplica limites de uso por utilizador e workspace.
4. **Resposta estruturada.** O modelo responde com operações num esquema fixo, validado com zod no servidor e de novo no cliente. Exemplo: `{ op: 'setText', id, text }` ou `{ op: 'insertAt', anchorId, position, block }`. Texto livre ou HTML não passam.
5. **Validação contra o documento atual:**
   - cada `id` tem de existir **dentro do âmbito**;
   - as inserções usam `canInsert` e os movimentos `canPlace`;
   - os estilos só usam as propriedades editáveis (`EDITABLE_PROPS`);
   - os URLs passam pelos filtros da importação (sem `javascript:`).

   Se **alguma** operação falhar, nenhuma é aplicada e o utilizador vê quais falharam e porquê.
6. **Pré-visualização.** As operações são aplicadas numa **cópia** do documento, num editor headless. A prévia isolada (a mesma da importação) mostra antes/depois, com a lista de alterações em linguagem simples. O documento real não muda.
7. **Confirmação.** «Aplicar» executa as operações no editor real, dentro de um único grupo do histórico. Um só «Desfazer» reverte tudo. «Cancelar» não deixa rasto.
8. **Preservação.** Os elementos fora do âmbito não podem ser referidos. Uma operação que toque num id fora do âmbito é recusada no passo 5. Os ids dos elementos alterados mantêm-se; os elementos inseridos recebem ids novos pelo mecanismo de identidade existente.
9. **Gravação.** Depois de aplicar, o fluxo é o de qualquer edição: marcação «por guardar», gravação automática e revisão nova. Se houver conflito de revisão, é tratado como hoje.

## Erros

- Erro de rede, do fornecedor, de limite de uso ou de validação: **nada é aplicado** e a mensagem diz o que aconteceu («O assistente não respondeu; nada foi alterado»).
- Nunca é mostrado «Alterações aplicadas» antes de a aplicação terminar no editor. A gravação no servidor continua a ser anunciada só pelo indicador de gravação.
- Respostas parciais ou truncadas são tratadas como erro, não como sucesso parcial.

## Testes previstos

- Unitários do validador de operações: ids fora do âmbito, destinos incompatíveis, propriedades não editáveis, URLs inseguros.
- Aplicação atómica: uma operação inválida entre várias válidas não altera nada.
- Desfazer único para um lote aplicado; os ids preservados.
- E2E com um fornecedor simulado (respostas fixas): prévia, confirmação, cancelamento, erro de rede sem alterações, gravação e reabertura.
- Servidor: sem sessão → recusado; chave nunca presente na resposta nem no bundle do cliente.

## Pontos para rever (registados a 28/09/2026, por decidir)

Pedidos de revisão do utilizador. Ficam aqui para a próxima sessão; nada foi implementado.

1. **Âmbito «página» só por escolha explícita.** Hoje o passo 1 usa a página quando não há seleção. A alternativa em revisão é obrigar a escolher o âmbito sempre: sem seleção, o assistente pede-o em vez de assumir a página.
2. **Propostas desatualizadas.** A prévia é gerada sobre uma revisão do documento. Antes de aplicar, é preciso confirmar que o documento não mudou desde então (revisão ou marca de alteração do editor). Se mudou, a proposta fica inválida e o utilizador tem de gerar outra.
3. **Destinos das inserções e dos movimentos.** Não basta que o elemento de referência esteja no âmbito. O destino final (pai e posição) também tem de estar dentro dele, para impedir que uma operação leve conteúdo para fora do âmbito ou o traga de fora.
4. **Recuperação integral.** Se uma operação falhar a meio do lote, o documento tem de voltar exatamente ao estado anterior (por exemplo, desfazendo o grupo do histórico já aplicado). Não pode ficar aplicada nenhuma parte, e não pode aparecer mensagem de sucesso.

## Fora deste plano

Publicação, edição de código, importação HTML/ZIP e geração de imagens continuam como objetivos separados (`docs/00`).
