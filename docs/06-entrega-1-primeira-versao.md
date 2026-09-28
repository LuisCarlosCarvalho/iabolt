# Entrega 1 · primeira versão utilizável

Execução local a 28/09/2026 · Windows 11 · Node v24.18.0 · Chromium 153 (Playwright 1.63) · Supabase: projeto `quihhoszhtivzwhcvnsd` (iabolt.git).

## Resultados executados

| Comando | Quem executou | Exit | Resultado |
| --- | --- | --- | --- |
| `npm run check` | Claude | 0 | typecheck OK · lint OK · **52/52** testes (7 ficheiros) · build OK · diff-check OK |
| `npm run test:e2e` (modo local, porta 5175) | Claude | 0 | **16/16**: 14 do produto + 2 da prova da Fase 0 (`/prova-tecnica`) |
| `npm run test:server` (Supabase real: Auth, RPC, Storage) | utilizador | 0 | **9/9** |
| `npm run test:e2e:server` (Supabase real, browser) | utilizador | 0 | **6/6** |

Os testes contra o Supabase real iniciam sessão com as contas de teste A e B, por isso foram executados pelo utilizador no seu terminal; os resultados acima são os da execução dele.

### Depois da alteração do login (posterior aos 9/9 e 6/6 acima)

Alterações: o registo foi retirado do ecrã; o vídeo começa sempre sem som e o áudio só liga pelo botão; a geometria do cartão foi ajustada à referência.

| Verificação | Quem | Resultado |
| --- | --- | --- |
| `npm run check` | Claude | exit 0, 52/52 |
| Controlos sem rede (Supabase bloqueado): vídeo inicia sem som e a tocar; botão liga e desliga o áudio (clique e Enter); mostrar/esconder a palavra-passe mantém o valor; nenhuma ligação de registo | Claude | aprovado |
| Acessibilidade sem rede: foco, rótulos, erro anunciado, 1 pedido por duplo clique | Claude | aprovado |
| Login e logout no Supabase real: `npx playwright test --config playwright.server.config.ts -g "entrar, sair e voltar a entrar"` | utilizador | **por executar** |
| Registos públicos desligados no Supabase (`disable_signup`) | utilizador | **por fazer**; a 28/09 o projeto ainda aceitava registos |

Aviso do build (não é erro): chunk JS de ~1,4 MB, sobretudo GrapesJS. A divisão de código fica para a Fase 2.

## Validado no Supabase real

`npm run test:server` (9 casos), com o código de produção (`SupabaseRepository`, `SupabaseAssetStore`):

- criar projeto: idempotente, revisão 0 e visível na lista;
- gravar com revisão e conflito sem sobrescrita;
- imagem carregada para o bucket privado, gravada como referência e servida ao dono;
- endereço público da imagem recusado;
- a conta B não vê, não abre, não grava, não renomeia nem arquiva o projeto de A, e não descarrega, não assina nem escreve imagens na pasta de A;
- sem sessão não há leitura nem gravação.

`npm run test:e2e:server` (6 casos, browser real):

- entrar, sair e voltar a entrar;
- criar a partir de um template;
- editar texto, cor, texto e destino de um botão e «abrir num novo separador»;
- carregar uma imagem privada;
- guardar e confirmar tudo, incluindo a imagem **efetivamente carregada**, depois de F5, ao reabrir pela Dashboard e num segundo browser autenticado;
- isolamento entre A e B em projetos e imagens;
- falha de rede: erro visível, nunca «guardado», e a repetição grava;
- projetos do modo local copiados para a conta sem duplicar, com os originais intactos;
- duas sessões: a segunda recebe conflito e não sobrescreve.

Verificado também manualmente pelo utilizador: entrar com a sua conta, criar um projeto, editar texto, cores e imagens, e ver «Alterações guardadas no servidor».

### Correções feitas durante a validação

1. **Seleção perdida logo após abrir o editor (aplicação).** Cada mudança de zoom do GrapesJS desliga a seleção por clique durante ~300 ms. O zoom de ajuste era aplicado depois de o editor carregar, quando a interface já dizia «guardado». Um clique rápido perdia-se. Agora o zoom inicial é aplicado antes do carregamento e só é reaplicado quando muda, e o editor só se declara pronto quando a seleção por clique está ativa. Há teste de regressão local.
2. **Checkbox «Abrir num novo separador» parecia não reagir (aplicação).** O painel só relia o modelo no fotograma seguinte, e com o browser ocupado a caixa voltava a aparecer desmarcada. Agora cada alteração feita no painel volta a desenhá-lo no próprio evento. Foi provado com um teste de fotogramas lentos: falhava sem a correção com o mesmo erro e passa com ela. Também se verifica que marcar e desmarcar persistem.
3. **Medição do carregamento da imagem (teste).** Os elementos do canvas são criados na janela principal e depois postos na moldura, por isso `instanceof HTMLImageElement` era sempre falso. A verificação passou a medir diretamente `complete`, `naturalWidth` e o endereço assinado carregado.
4. **Contas de teste (configuração).** Os testes recusam contas `admin@…` e exigem contas A e B diferentes. A limpeza apaga as imagens e arquiva apenas os projetos «[teste automático]» criados pelo próprio teste.

## Funciona e está testado (modo local)

- **Dashboard** (`/`):
  - lista de projetos com miniatura real, nome, «Atualizado há…» e template de origem;
  - estados de carregamento, vazio e erro (o vazio tem teste E2E; o carregamento e o erro estão implementados, sem teste dedicado);
  - mudar o nome e remover (arquivar), com teste E2E.
  - Abrir sem parâmetros não cria projetos (E2E).
- **Biblioteca** (`/templates`): Nimbus (logótipo em texto), Vértice (logótipo em imagem) e página em branco, com pré-visualização por dispositivo e cópia independente.
- **Editor** (`/projetos/:id`): canvas, árvore com arrastar validado, propriedades, 6 componentes básicos, barra contextual, dispositivos, guardar, desfazer e refazer.
- **Edição que sobrevive a guardar e reabrir:** texto (painel e canvas), ligações e botões (texto, destino e novo separador, marcar e desmarcar), imagens, duplicar, eliminar, reordenar e estilos por dispositivo.
- **Gravação:** «guardado» só depois da confirmação; conflito entre separadores e falha de gravação sem falso sucesso.
- **Projetos locais:** cópia de segurança em ficheiro; cópia para a conta em modo servidor.

## Ecrã de login

- Reproduz a referência: vídeo de fundo com película, cartão, logótipo, campos, botão e controlo de áudio. A geometria do cartão foi medida e coincide com a referência em 1440×900 e 390×844 (cartão de 448 px, mesmas posições de logótipo, campos, botão e rodapé).
- Movimento reduzido: sem vídeo nem som, só a imagem de fundo.
- Acessibilidade verificada sem rede: rótulos associados, ordem de foco, foco visível, erro anunciado e ligado aos campos, «A entrar…» sem envios duplicados.
- **Sem registo no ecrã,** como na referência («Acesso restrito à equipa»). As contas são criadas pela administração em Supabase → Authentication → Users. A recuperação de palavra-passe também não aparece, porque não tem fluxo.

## Limitações e pendências reais

- **Registo aberto no servidor:** o ecrã já não oferece registo, mas o Supabase continua a aceitar registos pela API pública (`disable_signup: false`). Um registo externo só teria acesso ao seu próprio workspace vazio (RLS). Para acesso realmente restrito, desligue «Allow new users to sign up» em Authentication → Sign In / Providers. A decisão é do utilizador.
- **Modo local:** os dados ficam só no browser. As imagens ficam embutidas no documento; ao copiar para a conta seguem dentro do documento e não vão para o Storage.
- **Cópia de segurança:** o ficheiro ainda não se importa pela interface (importadores são da fase 3).
- **Imagens no servidor:** os URLs assinados valem 12 h. Uma sessão aberta mais tempo pode precisar de recarregar.
- **Mudar de dispositivo ou redimensionar a janela:** durante ~300 ms o canvas não seleciona por clique (comportamento do GrapesJS ao mudar o zoom).
- **Mover no canvas:** faz-se pela árvore ou pelas setas da barra contextual.
- **Formatação de texto:** a barra do GrapesJS tem dicas em inglês; textos com formatação só se editam no canvas.
- **Seletor de cor:** arrastar cria vários passos de desfazer.
- **Templates:** vivem no código; a biblioteca persistida é da Fase 2.
- **Histórico no servidor:** cada gravação guarda o documento completo; a retenção fica por definir.
- **Fora desta entrega:** importadores, IA e publicação. Não aparecem na interface.
