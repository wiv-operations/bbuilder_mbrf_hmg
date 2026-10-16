# Cenários de Teste E2E — Jornada "Ofertas e Oportunidades"

Router `hmgmbrf` (tenant `mbrf`), ambiente QAS (`urlBase = https://qas.central-brf.com.br`).
Gerado a partir dos blocos reais lidos via `bbuilder inspect` em 09/10/2026, após `bbuilder pull`.

## 1. Escopo e versões analisadas

O `flowtest` conversa com o bot **publicado**. Por isso, os cenários se baseiam nas versões publicadas:

| Subbot | Papel na jornada |
| --- | --- |
| `hmgf2captacao` | Entrada do "Olá": boas-vindas, LGPD, telefone, autenticação, opt-in, menu inicial |
| `hmgf2ofertaseoportunida` | **Ofertas e Oportunidades** (87 estados): contas, elegibilidade, Smart Sales, carrinho, pagamento, entrega, checkout, pedido |
| `hmgf2comprarprodutos` | Entrada alternativa em Ofertas ("🍗 Comprar produtos") |
| `mbrfajudoemalgomaishmg` | "Posso te apoiar em mais alguma coisa?" (fim de jornada) |
| `mbrffinalizarhmg` | Avaliação e encerramento |
| `mbrfexcecoeshmg` | Destino do `fallback` de todos os subbots (input inesperado, "sair", "menu", inatividade) |
| `mbrfencaminhamentosophiahmg` | Transbordo para a Sophia |

> ⚠️ O flow local `hmgf2ofertaseopt` **não está publicado** e difere do publicado em 40 estados. Ele não é testável pelo `flowtest` até ser publicado.

Entrada do router: inferida como `hmgf2captacao` (todos os retornos a "menu inicial" e o encerramento redirecionam para ela). Vou confirmar no primeiro teste da Fase 4.

Canal de teste: o `flowtest` usa o canal tunnel, não o WhatsApp. Por isso:
- a identidade não é um telefone, e o bot sempre pede o telefone (`phoneStatus=false`);
- `contact.extras.channel` fica como "Outros", e o transbordo da Sophia usa a variante Blip Chat;
- os menus dinâmicos (subflows "Menu inicial", "Selecionar conta", "Forma de pagamento", "Menu de endereco", "Menu de datas entregas") são respondidos com o **título da linha** (`title`).

## 2. Integrações por etapa (blocos reais)

| Etapa | Estado | Requisições |
| --- | --- | --- |
| Login (captação) | `1a571e3c` [API] Login usuario | POST `/vforcesite/.../ecommerce/login`; GET `/services/data/v62.0/query` (User) |
| Contas vinculadas | `e125a412` | login; GET query User; GET `external-managed-accounts`; GET query Account; POST YGG `/token`; POST YGG `/person/customer/search` |
| Elegibilidade | `a7e1c0de` | login; GET `/ecommerce/account/{accountId}`; POST `/ecommerce/credit` |
| Valor mínimo | `bd0baa6f` | login; POST `/ecommerce/minimumorderamount/` |
| Smart Sales | `a04f9c20`, `a66fab48` | POST `mbrf.http.msging.net/commands` ×2; POST `smartsales/user/entering-action/send`; POST `smartsales/user/leaving-action` |
| Sincroniza carrinho | `0892c280` | DELETE carts/current; POST carts; GET products; POST cart-items/batch; POST deliverywindow; POST recalculator ×2 (+ logins) |
| Lê carrinho | `d21cd5d2` | POST recalculator; GET carts/{cartId}/cart-items |
| Split (misto) | `a096ebdd` | GET carts/current; POST `/ecommerce/splitcart/{cartId}` |
| Pagamento | `5e247944` | GET carts/current; POST `/ecommerce/paymentcondition` |
| Endereços | `menu-enderecos-monta` | GET `/accounts/{accountId}/addresses` |
| Datas | `ae01d44d` | GET carts/current; POST `/ecommerce/deliverywindow` |
| Grava pagamento | `a0a34fab` | GET carts/current; PUT `/ecommerce/webcart/{cartId}` |
| Grava entrega | `17ea68a4` | GET query CartDeliveryGroup; PATCH CartDeliveryGroup |
| Recalcula | `6b3901e1` | POST recalculator ×3 |
| Checkout | `a1199190`, `dc6be84b`, `8b0f3d77` | POST/GET/DELETE checkouts; GET checkouts/{id}; PATCH checkouts/{id} |
| Pedido | `bb835db0` | POST `checkouts/{id}/orders` |

## 3. Achados da análise estática (a confirmar na Fase 4)

| # | Achado | Onde | Cenário |
| --- | --- | --- | --- |
| A1 | O login da captação não valida o status: `compatibilityCnpj` nunca é definido em nenhum flow, então a saída "sucesso" sempre vale. Com senha errada o usuário avança, e a falha só aparece em Ofertas. | captação `1a571e3c` | CT-18 |
| A2 | `contadorSenhaIncorreta` soma 1 a cada login e nunca volta a zero. Na 2ª autenticação do mesmo contato, o bot mostra "Senha incorreta 2x" mesmo com a senha correta. | captação `1a571e3c` | CT-19 |
| A3 | "Conta não elegível" volta para "Busca contas vinculadas". Com uma única conta, isso vira um ciclo (contas → elegibilidade → mensagem) e deve estourar o limite de 10 transições. | ofertas `b8f2d1ef` | CT-06 |
| A4 | O estado de depuração "teste" ("Some text") está publicado no caminho de falha do Inicia checkout. | ofertas `a4b0c95e` | CT-33 |
| A5 | O turno após o carrinho (~24 HTTP) e o turno após a data (~16 HTTP) correm risco de passar do limite de 1 min/turno. Os estados `[WAIT]` voltam sem espera real e podem estourar o limite de 10 transições. | ofertas `0892c280`→`5e247944`; `a0a34fab`→`bb835db0` | CT-01, CT-34 |
| A6 | "Certo, {{infosUserSalesForce@FirstName}}." sai com o nome vazio no caminho padrão, porque `apiCustomer` só é consultado no caminho do CNPJ. | captação `70cb08c2` | CT-01 |
| A7 | Em "Comprar produtos", a opção "Repetir pedido" leva ao redirect de Início, não ao de carrinho. A partir desse menu, `@redirect_cart` nunca é alcançado. | comprarprodutos `3bdc4eab` | CT-05 |
| A8 | O menu "Qual pedido pagar primeiro" trata "Abandonar", mas não oferece essa opção. | ofertas `94464e7a` | CT-03 |
| A9 | Segurança: a senha fica em `contact.extras.senha` e vai em texto puro para o contexto `smartSales`. Há secrets em `flows/hmgf2captacao/configuration.json`. | captação / ofertas | — |

## 4. Blocos de passos reutilizáveis

Todo cenário começa no passo 1 com "Olá" e depois chama estes blocos na ordem indicada. Cada bloco descreve mensagens e decisões reais do Builder.

### Bloco A — Saudação, LGPD, telefone e autenticação (contato novo)
- A1. Bot (captação › "Verifica primeiro contato": `aceitouLGPD` ausente) envia: "Oie! Seja bem vindo(a) ao canal oficial da Central MBRF! Eu sou o Assistente Virtual 🤖 e estou aqui para te ajudar!"
- A2. Bot envia: "🔒 Ao prosseguir você estará de acordo com a nossa política de privacidade. … mbrf.com/wp-content/uploads/2025/10/Politica-de-Privacidade-MBRF-PT.pdf"
- A3. Sistema executa "GUID + BSUID VERIFICATION": a identidade não é telefone → `phoneStatus=false` → grava `guid`/`bsuid` no contato.
- A4. Bot envia: "Para localizar seu cadastro e continuar seu atendimento, informe seu número de telefone com DDD … Exemplo: 5531999999999" e salva em `telefoneNotFormatted`.
- A5. Usuário envia: [Massa_Telefone].
- A6. O script normaliza para `+55…` (`phoneNumber`) → MergeContact `phoneNumber` → nova verificação → `phoneStatus=true` → "Valida se já fez login" (sem `userAuth`).
- A7. Bot envia o menu: "Você já é um cliente cadastrado na Central MBRF? 😊" [Sim | Não] (grava `aceitouLGPD=Aceito`).
- A8. Usuário envia: "Sim".
- A9. Bot envia: "✉️ Por favor, informe o seu e-mail de acesso. ℹ️ O mesmo usado para fazer login no site/app." e salva em `emailNotFormatted` (o regex extrai `email`).
- A10. Usuário envia: [Massa_Email].
- A11. Bot envia: "Perfeito, digite, por favor, a sua senha de login. …" e salva em `senha` (→ `contact.extras.senha`).
- A12. Usuário envia: [Massa_Senha].
- A13. Sistema chama POST `/ecommerce/login` e GET query User → grava `contact.extras.accountId` → `contadorSenhaIncorreta=1` → "sucesso" → "Verifica Opt-in" (`userAuth=true`).
- A14. Bot envia o menu: "Antes de continuarmos, você aceita receber notificações aqui no WhatsApp sobre promoções exclusivas e status dos seus pedidos?" [Sim | Não] (`optIn`).
- A15. Usuário envia: "Sim".
- A16. Bot envia: "Certo, {{infosUserSalesForce@FirstName}}. Vou armazenar essa informação aqui. ☺️"
- A17. "Valida tipo menu": sem `smartsalesOrder` → Bot envia o menu dinâmico "Oi, {{contact.name}}! 😊 Tudo pronto. Identificamos *ofertas exclusivas para o seu negócio hoje!* O que vamos fazer agora?" (botão "Selecionar assunto") com as opções: "🔥 Ofertas" | "🍗 Comprar produtos" | "🛒 Meus Pedidos" | "💰 Financeiro" | "💬Ajuda e Suporte" | "👤Meu Cadastro".

### Bloco B — Ofertas: contas, elegibilidade, valor mínimo e catálogo
- B1. Usuário escolhe: "🔥 Ofertas" → Redirect para `hmgf2ofertaseoportunida` com `@redirect` (`userInputType`).
- B2. Sistema executa [API] Busca contas vinculadas (6 requisições) → `contasVinculadas.ok=true`.
  - B2a. Se `total = 1`: segue direto para B3.
  - B2b. Se `total > 1`: Bot envia o menu "Encontrei <b>N contas</b> vinculadas ao seu e-mail. <b>Com qual conta você quer seguir?</b>" (botão "Ver contas", linhas "1. <Nome>" com descrição "CNPJ: xx.xxx.xxx/xxxx-xx") → Usuário escolhe: [Massa_Conta] → `accountId` = conta escolhida.
- B3. Sistema executa [API] Verifica elegibilidade → `elegibilidade.elegivel=true`.
- B4. Sistema executa [API] Recupera valor mínimo → `statusValorMinimo=200`.
- B5. Bot envia: "Ah, o valor mínimo de fechamento do pedido é de R$ X,XX. Nosso catálogo está te esperando, escolha os melhores produtos para você!"
- B6. Bot envia: "ℹ️ Aviso: Para pagamentos realizados via PIX ou Cartão de Crédito, é aplicada uma caução de 15% e 20%, respectivamente. …"
- B7. Sistema reinicia e cria o contexto `smartSales` (POST /commands ×2) → estado "Smart Sales": POST `entering-action/send` → o Smart Sales envia ao usuário "Clique no link para acessar o catálogo:" + link (variante WhatsApp: weblink "Perfeito, vamos lá!" / "Ver Catálogo").
- B8. Usuário monta no catálogo o carrinho [Massa_Carrinho] e conclui → o Smart Sales grava `contact.extras.smartsalesOrder` e devolve o input ao bot.
- B9. Sistema: leaving-action → Formata produtos → Sincroniza carrinho → Lê carrinho Salesforce → Separação de carrinho (`tipoCarrinho` = "multiplo" quando há Bovinos e não Bovinos; caso contrário "unico").

### Bloco C — Pagamento, endereço, data e pedido
- C1. Bot envia: "👉 O valor pode sofrer alteração devido as variações de peso. ℹ️ Aviso: … caução de 15% e 20% …"
- C2. Sistema executa [API] Condições de pagamento → `itensMenuDinamico.temBoleto=true` → Bot envia o menu "Agora escolha a <b>condição de pagamento</b> do seu pedido. 💳" (botão "Ver opções", linhas "1. <nome da condição>").
- C3. Usuário escolhe: [Massa_CondicaoPagamento].
- C4. Bot envia: "Tudo certo! Aqui está o valor atualizado do seu pedido: 💳 Forma de pagamento: Boleto - <nome> 💰 Valor total: R$ <valor> ℹ️ Aviso: …"
- C5. Sistema executa GET `/accounts/{accountId}/addresses` → `temEnderecos=true` → Bot envia o menu "Perfeito! Antes de finalizar sua compra, confirme o endereço de entrega.📍 <b>Qual endereço você deseja usar nesta compra?</b>" (botão "Ver endereços").
- C6. Usuário escolhe: [Massa_Endereco].
- C7. Sistema executa [API] Janelas de entrega → `temDatas=true` → Bot envia o menu "Estamos quase finalizando! <b>Escolha a melhor data de entrega para você.</b> 😊" (botão "Ver datas", linhas "dd/mm/aaaa (ddd)").
- C8. Usuário escolhe: a primeira data listada.
- C9. Sistema: Grava pagamento (PUT webcart) → Grava endereço e data (PATCH CartDeliveryGroup) → Recalcula → Inicia checkout → Consulta checkout → Seleciona data de entrega (PATCH checkout, `faseCheckout=final`) → Consulta checkout (`selecionadoCorreto=true`) → Cria pedido (POST orders, `statusPedido` 2xx e `numeroPedido`).
- C10. Bot envia: "O seu pedido <numeroPedido> já foi registrado em nosso sistema e o boleto será enviado diretamente para o seu e-mail cadastrado. ✅ 📅 Entrega prevista: <data> Estamos cuidando de tudo para que seu pedido chegue até você. 📦" (o estado aguarda input).

### Bloco D — Encerramento
- D1. Usuário envia: "ok".
- D2. "[DECISÃO] Há segundo carrinho pendente?": não → Redirect "Ajudo em algo mais" (contexto "oi") → Bot envia o menu "Posso te apoiar em mais alguma coisa por aqui? 😊" [Sim | Não].
- D3. Usuário envia: "Não" → Bot envia: "Fico feliz em ter te ajudado! Sempre que precisar, pode contar comigo! 🤝"
- D4. Finalização: Bot envia o menu "Você poderia avaliar o nosso atendimento? É bem rapidinho! 😃" [Sim | Não].
- D5. Usuário envia: "Não" → Bot envia: "A Central MBRF agradece o seu contato!" e "É um prazer poder receber você aqui! 😊" → Redirect para Captação.

## 5. Cenários

ID do Teste: CT-01
Nome do Cenário: Compra completa: 1 conta elegível, carrinho único (não bovino) acima do mínimo, boleto, endereço e data → pedido criado → encerramento
Tipo: Caminho Feliz
Pré-condições: Contato novo; usuário QAS com 1 conta vinculada, ativa, crédito RELEASED, sem atraso, crédito ≥ mínimo, condição boleto, endereço Shipping e janelas de entrega; carrinho real montado no catálogo Smart Sales.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A (A1–A17) com [Massa_Telefone], [Massa_Email_Elegivel_1Conta], [Massa_Senha_Elegivel_1Conta].
3. Executar o Bloco B (B1–B9; B2a) com [Massa_Carrinho_Unico_AcimaMinimo].
4. "Carrinho Unico": `valorMinimoAtingido.atingiuMinimo=true`.
5. Executar o Bloco C (C1–C10) com [Massa_CondicaoPagamento] e [Massa_Endereco].
6. Executar o Bloco D (D1–D5).
Resultado Esperado: Todas as mensagens dos blocos A–D chegam na ordem descrita. Em C10 aparece um `numeroPedido` não vazio e a data escolhida em C8. Nenhum estado de erro ("Ocorreu um erro …") aparece. Verificar A6: em A16, o nome pode sair vazio.
Pós-condições: Pedido real criado no Salesforce QAS e boleto enviado ao e-mail. `contact.extras.smartsalesOrder` permanece no contato. A conversa volta para a Captação.

ID do Teste: CT-02
Nome do Cenário: Compra completa com múltiplas contas vinculadas (seleção de conta) e retorno ao Menu inicial no fim
Tipo: Caminho Feliz
Pré-condições: Contato novo; usuário com 2 ou mais contas vinculadas e uma conta elegível ([Massa_Conta]); carrinho único acima do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Telefone], [Massa_Email_MultiContas], [Massa_Senha_MultiContas].
3. Executar o Bloco B usando B2b: escolher [Massa_Conta]; carrinho [Massa_Carrinho_Unico_AcimaMinimo].
4. Executar o Bloco C completo.
5. Usuário envia: "ok" → Bot envia "Posso te apoiar em mais alguma coisa por aqui? 😊" [Sim | Não].
6. Usuário envia: "Sim" → Bot envia "Perfeito! Como posso te ajudar? Basta clicar em uma opção para me informar." [Menu inicial | Encerrar conversa].
7. Usuário envia: "Menu inicial".
Resultado Esperado: O menu de contas lista as contas como "1. <Nome>", "2. <Nome>" (a principal primeiro). Depois da escolha, valor mínimo e pedido usam o `accountId` escolhido. Após o passo 7, a Captação (`@MenuInicial`) mostra de novo o menu "Oi, … O que vamos fazer agora?". Como `smartsalesOrder` agora existe, aparece a variante com "🔥 Ofertas e oportunidades" e "🔁 Recomprar".
Pós-condições: Pedido criado na conta escolhida; usuário parado no menu inicial.

ID do Teste: CT-03
Nome do Cenário: Carrinho misto (MBRF + Bovinos), ambos acima do mínimo: pagar Pedido 1, depois o 2º carrinho automático
Tipo: Caminho Feliz
Pré-condições: Contato novo; usuário elegível com 1 conta; carrinho com produtos da categoria Bovinos e de outras categorias, cada grupo ≥ mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_Elegivel_1Conta]/[Massa_Senha_Elegivel_1Conta].
3. Executar o Bloco B com [Massa_Carrinho_Misto_AmbosAcima] → `tipoCarrinho=multiplo` → "Carrinho misto": `pedido1AtingiuMinimo=true` e `pedido2AtingiuMinimo=true`.
4. Bot envia o menu "Vamos lá! Seu pedido está separado em *MBRF* e *Bovinos*. 🛒 … *Qual deseja pagar primeiro?*" [Pedido 1 | Pedido 2].
5. Usuário envia: "Pedido 1" → Sistema: GET carts/current + POST splitcart (`statusSplit=200`).
6. Executar o Bloco C (C1–C10) para o pedido MBRF.
7. Usuário envia: "ok" → Bot envia: "Perfeito! Agora vamos concluir o seu segundo pedido Bovinos. 🛒 Vou pedir novamente a forma de pagamento, o endereço e a data de entrega para esse pedido."
8. Sistema: split do Pedido 2 → executar o Bloco C (C1–C10) para Bovinos.
9. Executar o Bloco D (D1–D5).
Resultado Esperado: Saem dois pedidos com `numeroPedido` diferentes. Na 2ª passagem por D2, `segundoCarrinhoProcessado=true` encerra o ciclo e o fluxo vai para "Ajudo em algo mais". (A8: "Abandonar" não aparece como opção no passo 4.)
Pós-condições: Dois pedidos reais criados (BRF e MARFRIG).

ID do Teste: CT-04
Nome do Cenário: Carrinho único abaixo do mínimo → "Completar pedido" → volta ao catálogo → completa → pedido criado
Tipo: Exceção
Pré-condições: Contato novo; usuário elegível com 1 conta; primeiro carrinho abaixo do mínimo e segundo carrinho (completado) acima.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_Elegivel_1Conta]/[Massa_Senha_Elegivel_1Conta].
3. Executar o Bloco B com [Massa_Carrinho_Unico_AbaixoMinimo] → `atingiuMinimo=false`.
4. Bot envia o menu "Falta bem pouquinho para você finalizar o seu pedido! 🛒✨ O valor mínimo para compras por aqui é de R$ X. …" [Completar pedido | Encerrar].
5. Usuário envia: "Completar pedido" → o Sistema marca o carrinho Smart Sales como `draft` → estado Smart Sales envia o link do catálogo de novo.
6. Usuário completa o carrinho: [Massa_Carrinho_Unico_AcimaMinimo].
7. Executar o Bloco C e depois o Bloco D.
Resultado Esperado: O menu do passo 4 mostra o valor mínimo de B5. Depois de completar, o fluxo segue para C1 sem novo aviso de mínimo, e o pedido é criado.
Pós-condições: Pedido criado com o carrinho completado.

ID do Teste: CT-05
Nome do Cenário: Entrada por "🍗 Comprar produtos" (sem pedido anterior) → Ofertas → pedido criado
Tipo: Caminho Feliz
Pré-condições: Contato novo (sem `smartsalesOrder`); usuário elegível com 1 conta.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_Elegivel_1Conta]/[Massa_Senha_Elegivel_1Conta].
3. Usuário escolhe: "🍗 Comprar produtos" → Redirect para `hmgf2comprarprodutos` → "Buscar pedido": sem `smartsalesOrder` → Redirect "Ofertas e oportunidades - Inicio" (`@redirect`).
4. Executar o Bloco B a partir de B2, com [Massa_Carrinho_Unico_AcimaMinimo].
5. Executar o Bloco C e depois o Bloco D.
Resultado Esperado: Mesmo comportamento do CT-01 a partir de B2. Observação A7: com `smartsalesOrder` existente, o menu "Pedido anterior localizado" [Repetir pedido | Fazer novo pedido | 🔥 Ver ofertas] também leva ao Início, não ao carrinho.
Pós-condições: Pedido criado.

ID do Teste: CT-06
Nome do Cenário: Conta única inativa → mensagem de inelegibilidade (verificar ciclo A3)
Tipo: Exceção
Pré-condições: Contato novo; usuário com 1 conta vinculada com `active=false`.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_ContaInativa]/[Massa_Senha_ContaInativa].
3. Executar B1–B3 (B2a).
4. Elegibilidade retorna `elegivel=false` com motivo CONTA_INATIVA.
Resultado Esperado: Bot envia "Identificamos que sua <b>conta está inativa</b> no momento, por isso não é possível seguir com o pedido por aqui. Para regularizar, entre em contato com o seu consultor de vendas BRF." Pelos blocos, a saída volta para "Busca contas vinculadas" e repete o ciclo. É esperado que a mensagem se repita e que o turno termine em erro de runtime (limite de 10 transições). O catálogo nunca é enviado.
Pós-condições: Conversa parada no subbot Ofertas. Registrar o comportamento real como evidência do achado A3.

ID do Teste: CT-07
Nome do Cenário: Múltiplas contas: conta escolhida inelegível → volta ao menu de contas → escolhe conta elegível → pedido criado
Tipo: Exceção
Pré-condições: Contato novo; usuário com 2 ou mais contas: uma inelegível ([Massa_Conta_Inelegivel]) e uma elegível ([Massa_Conta]).
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_MultiContas]/[Massa_Senha_MultiContas].
3. B1–B2b: Usuário escolhe [Massa_Conta_Inelegivel].
4. Bot envia "{{elegibilidade@mensagem}} Para regularizar, entre em contato com o seu consultor de vendas BRF." → Sistema busca as contas de novo → Bot envia o menu de contas outra vez.
5. Usuário escolhe: [Massa_Conta].
6. Executar B3–B9 com [Massa_Carrinho_Unico_AcimaMinimo], depois o Bloco C e o Bloco D.
Resultado Esperado: A mensagem de inelegibilidade corresponde ao motivo da conta escolhida. O menu é reapresentado e a jornada termina com pedido na conta elegível.
Pós-condições: Pedido criado na conta elegível.

ID do Teste: CT-08
Nome do Cenário: Crédito bloqueado → mensagem de inelegibilidade
Tipo: Exceção
Pré-condições: Contato novo; usuário com conta ativa e crédito `blocked=true` ou status BLOCKED/BLOQUEADO.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_CreditoBloqueado]/[Massa_Senha_CreditoBloqueado].
3. Executar B1–B3.
Resultado Esperado: Bot envia "Identificamos que o <b>crédito da sua conta está bloqueado</b>, por isso não é possível seguir com o pedido por aqui. Para regularizar, entre em contato com o seu consultor de vendas BRF." Depois: com 1 conta, ciclo A3; com várias contas, menu de contas.
Pós-condições: Nenhum carrinho ou pedido criado.

ID do Teste: CT-09
Nome do Cenário: Crédito sem status ativo (≠ RELEASED) → mensagem de inelegibilidade
Tipo: Exceção
Pré-condições: Contato novo; conta ativa, crédito não bloqueado e status diferente de RELEASED.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_CreditoInativo]/[Massa_Senha_CreditoInativo].
3. Executar B1–B3.
Resultado Esperado: Bot envia "Identificamos que sua conta <b>não possui crédito ativo</b> no momento, por isso não é possível seguir com o pedido por aqui. Para regularizar, entre em contato com o seu consultor de vendas BRF."
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-10
Nome do Cenário: Pendência financeira (overdue ≠ 0) → mensagem de inelegibilidade
Tipo: Exceção
Pré-condições: Contato novo; conta ativa, crédito RELEASED e `overdue ≠ 0`.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_Pendencia]/[Massa_Senha_Pendencia].
3. Executar B1–B3.
Resultado Esperado: Bot envia "Identificamos <b>pendências financeiras</b> na sua conta, por isso não é possível seguir com o pedido por aqui. Para regularizar, entre em contato com o seu consultor de vendas BRF."
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-11
Nome do Cenário: Crédito disponível insuficiente para o pedido mínimo → mensagem de inelegibilidade
Tipo: Exceção
Pré-condições: Contato novo; conta ativa, crédito RELEASED, sem atraso e `available < minimalOrderValue` (ou ≤ 0).
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_CreditoInsuficiente]/[Massa_Senha_CreditoInsuficiente].
3. Executar B1–B3.
Resultado Esperado: Bot envia "Identificamos que o <b>crédito disponível</b> não é suficiente para o pedido mínimo, por isso não é possível seguir com o pedido por aqui. Para regularizar, entre em contato com o seu consultor de vendas BRF."
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-12
Nome do Cenário: Carrinho único abaixo do mínimo → "Encerrar" → confirma abandono → encerramento
Tipo: Exceção
Pré-condições: Contato novo; usuário elegível; carrinho abaixo do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A com [Massa_Email_Elegivel_1Conta]/[Massa_Senha_Elegivel_1Conta].
3. Executar o Bloco B com [Massa_Carrinho_Unico_AbaixoMinimo].
4. Bot envia o menu "Falta bem pouquinho …" [Completar pedido | Encerrar] → Usuário envia: "Encerrar".
5. Bot envia o menu "Tem certeza que deseja abandonar o seu pedido?" [Sim | Não] → Usuário envia: "Sim".
6. Executar D2–D5.
Resultado Esperado: Depois do "Sim", o fluxo vai para "Ajudo em algo mais" sem criar carrinho de checkout nem pedido.
Pós-condições: Nenhum pedido criado; conversa volta para a Captação.

ID do Teste: CT-13
Nome do Cenário: Carrinho abaixo do mínimo → "Encerrar" → "Não" (desiste de abandonar) → volta ao catálogo
Tipo: Exceção
Pré-condições: Igual ao CT-12.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Unico_AbaixoMinimo].
3. Usuário envia: "Encerrar" → Bot envia "Tem certeza que deseja abandonar o seu pedido?" [Sim | Não].
4. Usuário envia: "Não" → Sistema marca o carrinho como `draft` → estado Smart Sales.
5. Usuário completa: [Massa_Carrinho_Unico_AcimaMinimo] → executar o Bloco C e o Bloco D.
Resultado Esperado: O passo 4 reenvia o link do catálogo e a jornada termina com pedido criado.
Pós-condições: Pedido criado.

ID do Teste: CT-14
Nome do Cenário: Misto: Pedido 1 (MBRF) abaixo e Pedido 2 (Bovinos) acima → abandona Pedido 1 → paga Pedido 2
Tipo: Exceção
Pré-condições: Contato novo; usuário elegível; carrinho misto com MBRF < mínimo e Bovinos ≥ mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Misto_P1Abaixo_P2Acima].
3. Bot envia o menu "Falta bem pouquinho … O valor mínimo para compras de MBRF por aqui é de R$ X. Seu pedido está em R$ Y, faltam R$ Z. …" [Completar pedido | Encerrar] → Usuário envia: "Encerrar".
4. Bot envia o menu "Entendi que deseja abandonar o seu pedido de MBRF. Podemos prosseguir com o carrinho de produtos Bovinos? 🛒 Deseja prosseguir?" [Sim | Não] → Usuário envia: "Sim".
5. Sistema (`pedido1Abandonado=true`, `pedidoEscolhido="Pedido 2"`) → split do Pedido 2.
6. Executar o Bloco C e o Bloco D.
Resultado Esperado: Os valores Y e Z do passo 3 batem com o carrinho. O pedido criado contém só os itens Bovinos. Em D2 não há 2º carrinho processado.
Pós-condições: Um pedido criado (MARFRIG).

ID do Teste: CT-15
Nome do Cenário: Misto: Pedido 1 acima e Pedido 2 abaixo → abandona Pedido 2 → paga Pedido 1
Tipo: Exceção
Pré-condições: Carrinho misto com MBRF ≥ mínimo e Bovinos < mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Misto_P1Acima_P2Abaixo].
3. Bot envia o menu "… O valor mínimo para compras de Bovinos …" [Completar pedido | Encerrar] → Usuário envia: "Encerrar".
4. Bot envia o menu "Entendi que deseja abandonar o seu pedido de Bovinos. Podemos prosseguir com o carrinho de produtos MBRF? …" [Sim | Não] → Usuário envia: "Sim".
5. Sistema (`pedidoEscolhido="Pedido 1"`) → split → executar o Bloco C e o Bloco D.
Resultado Esperado: O pedido criado contém só os itens MBRF.
Pós-condições: Um pedido criado (BRF).

ID do Teste: CT-16
Nome do Cenário: Misto: ambos abaixo do mínimo → abandona os dois → confirma encerramento
Tipo: Exceção
Pré-condições: Carrinho misto com os dois grupos abaixo do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Misto_AmbosAbaixo].
3. Menu do valor mínimo do pedido 1 (MBRF) → Usuário envia: "Encerrar".
4. Menu "Entendi que deseja abandonar o seu pedido de MBRF …" → Usuário envia: "Sim".
5. Menu do valor mínimo do pedido 2 (Bovinos) → Usuário envia: "Encerrar".
6. Bot envia "Tem certeza que deseja abandonar o seu pedido?" [Sim | Não] → Usuário envia: "Sim".
7. Executar D2–D5.
Resultado Esperado: Nenhum split nem pedido. A conversa termina na avaliação e no agradecimento.
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-17
Nome do Cenário: Conta sem condição de pagamento boleto → erro de condição de pagamento → encerrar
Tipo: Exceção
Pré-condições: Usuário elegível cuja `paymentcondition` só retorna PIX ou códigos que começam com "BP".
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Email_SemBoleto]/[Massa_Senha_SemBoleto] e [Massa_Carrinho_Unico_AcimaMinimo].
3. Bot envia C1 → `temBoleto=false`.
4. Bot envia o menu "Ocorreu um erro Não conseguimos carregar as formas de pagamento do seu pedido agora. Que tal tentar novamente?" [Tentar novamente | Encerrar conversa].
5. Usuário envia: "Tentar novamente" → o mesmo menu volta.
6. Usuário envia: "Encerrar conversa" → executar D2–D5.
Resultado Esperado: O erro se repete a cada nova tentativa (a regra de boleto é determinística) e o encerramento funciona.
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-18
Nome do Cenário: Senha incorreta na 1ª tentativa → autenticação passa (A1) → falha só ao buscar contas em Ofertas
Tipo: Exceção
Pré-condições: Contato novo; e-mail QAS válido; senha errada.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A11 com [Massa_Email_Elegivel_1Conta].
3. Usuário envia: [Massa_Senha_Incorreta].
4. Executar A13–A17 e depois B1.
5. Sistema: [API] Busca contas vinculadas com token inválido → `contasVinculadas.ok=false`.
6. Bot envia o menu "Ocorreu um erro Não consegui carregar as contas vinculadas ao seu e-mail agora. Que tal tentar novamente?" [Tentar novamente | Encerrar conversa].
7. Usuário envia: "Encerrar conversa" → executar D2–D5.
Resultado Esperado: Pelos blocos reais, a captação não mostra erro de senha na 1ª tentativa (achado A1). O erro aparece em Ofertas (passo 6).
Pós-condições: `contadorSenhaIncorreta=1` no contexto; nenhum pedido.

ID do Teste: CT-19
Nome do Cenário: Retorno do mesmo contato na mesma conversa → "Valida último e-mail" → 2ª autenticação cai em "Senha incorreta 2x" → transbordo Sophia
Tipo: Edge Case
Pré-condições: Contato novo, usuário elegível.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A completo com [Massa_Email_Elegivel_1Conta]/[Massa_Senha_Elegivel_1Conta]. No menu inicial (A17), o usuário envia "sair" → Bot envia "Você realmente deseja encerrar o atendimento?" [Sim | Não | Menu inicial] → Usuário envia "Sim" → finalização → "Não" na avaliação (D4–D5).
3. Usuário envia: "Olá" (mesmo contato).
4. Bot envia "Olá novamente! 👋 Que bom ter você por aqui no atendimento da Central MBRF." → `phoneStatus=true` → `userAuth=true` e `contact.email` existe.
5. Bot envia o menu "No seu ultimo acesso utilizou o e-mail: <e-mail> Deseja continuar com esse e-mail?" [Sim | Não] → Usuário envia: "Sim".
6. Bot envia "Perfeito, digite, por favor, a sua senha de login. …" → Usuário envia: [Massa_Senha_Elegivel_1Conta] (senha correta).
7. Sistema: login → `contadorSenhaIncorreta=2` → condição `≥ 2`.
8. Bot envia o menu "Ops! Não conseguimos autenticar o seu cadastro nessa segunda tentativa. 🤔 …" [Falar com a Sophia | Encerrar conversa] → Usuário envia: "Falar com a Sophia".
9. Bot (Sophia, canal ≠ WhatsApp) envia "Para te ajudar da melhor forma, seu atendimento continuará com a Sophia, nossa assistente especializada. … 🔗https://wa.me/+558007028800 Aguardamos o seu contato" → Redirect "Ajudo em algo mais" → "Posso te apoiar em mais alguma coisa por aqui? 😊".
Resultado Esperado: Pelos blocos reais, a 2ª autenticação é recusada mesmo com a senha correta (achado A2) e o transbordo para a Sophia acontece.
Pós-condições: Contato fica preso no estado "senha incorreta 2x" em qualquer novo login até o contador ser zerado.

ID do Teste: CT-20
Nome do Cenário: E-mail com formato inválido → "Informar E-mail" → e-mail válido → chega ao catálogo
Tipo: Exceção
Pré-condições: Contato novo; usuário elegível.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A9.
3. Usuário envia: [Massa_Email_Formato_Invalido] → `email=false`.
4. Bot envia o menu "Desculpe, mas o e-mail informado não é válido. 😞 👉 Caso não lembre o seu e-mail de acesso, clique em “Esqueci o E-mail” 👉 Se o e-mail estiver errado, clique em “Informar E-mail” …" [Esqueci o E-mail | Informar E-mail].
5. Usuário envia: "Informar E-mail" → Bot envia A9 de novo.
6. Usuário envia: [Massa_Email_Elegivel_1Conta] → executar A11–A17 e depois B1–B7.
Resultado Esperado: Depois da correção, o fluxo continua normalmente até o link do catálogo (B7), que é onde a conversa passa para o catálogo web.
Pós-condições: Conversa aguardando no estado Smart Sales.

ID do Teste: CT-21
Nome do Cenário: "Esqueci o e-mail" → CNPJ cadastrado → e-mail mascarado → "Informar o E-mail" → autentica → catálogo
Tipo: Exceção
Pré-condições: Contato novo; CNPJ cadastrado no YGG QAS e vinculado ao usuário elegível.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A9 → Usuário envia [Massa_Email_Formato_Invalido] → menu de e-mail inválido.
3. Usuário envia: "Esqueci o E-mail" → Bot envia "Para continuar, informe o CNPJ do atendimento, por favor. Digite apenas os números do CNPJ."
4. Usuário envia: [Massa_CNPJ_Cadastrado] → `cnpj.type=CNPJ` → Sistema: POST YGG /token + POST YGG /person/customer/search (status 2xx).
5. Bot envia "Encontrei as seguintes informações referentes ao(s) e-mail(s) de cadastro em nosso sistema: <e-mail mascarado>".
6. Bot envia o menu "Selecione uma opção para continuarmos. 😉 …" [Informar o E-mail | Esqueci o E-mail] → Usuário envia: "Informar o E-mail".
7. Usuário envia [Massa_Email_Elegivel_1Conta] → executar A11–A17 e depois B1–B7.
Resultado Esperado: O e-mail mascarado corresponde ao cadastro do CNPJ. A jornada chega ao link do catálogo.
Pós-condições: `contact.taxDocument` gravado; conversa no estado Smart Sales.

ID do Teste: CT-22
Nome do Cenário: "Esqueci o e-mail" → CNPJ → "Esqueci o E-mail" → orientação 0800 e encerramento
Tipo: Exceção
Pré-condições: Igual ao CT-21.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar os passos 2–5 do CT-21.
3. Usuário envia: "Esqueci o E-mail".
Resultado Esperado: Bot envia "No momento, não é possível seguir sem sua autenticação em nosso sistema. … ☎️ 0800 702 3311 Depois é só voltar por aqui que sigo com você 😊" e "A Central MBRF agradece o seu contato!".
Pós-condições: Conversa volta ao onboarding da Captação.

ID do Teste: CT-23
Nome do Cenário: Telefone inválido na 1ª tentativa e válido na 2ª → segue para autenticação
Tipo: Exceção
Pré-condições: Contato novo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A4.
3. Usuário envia: [Massa_Telefone_Invalido] → `phoneNumber=false`.
4. Bot envia "Por favor, tente novamente e confira se o DDD foi informado corretamente e se não houve nenhum erro de digitação. Exemplo: 11 98543261."
5. Usuário envia: [Massa_Telefone] → executar A6–A17 e depois B1–B7.
Resultado Esperado: Com o telefone válido, o fluxo segue para "Você já é um cliente cadastrado …" e chega ao link do catálogo.
Pós-condições: `contact.phoneNumber` gravado.

ID do Teste: CT-24
Nome do Cenário: Telefone inválido duas vezes → encerramento sem atendimento
Tipo: Exceção
Pré-condições: Contato novo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A4.
3. Usuário envia: [Massa_Telefone_Invalido] → mensagem de nova tentativa.
4. Usuário envia: [Massa_Telefone_Invalido].
Resultado Esperado: Bot envia "No momento, sem o número de telefone não conseguimos continuar com o atendimento por aqui. Para continuar, você pode acessar pelo site ou app da Central MBRF … https://www.centralmbrf.com.br/". Ofertas não é alcançado.
Pós-condições: Conversa volta ao onboarding da Captação.

ID do Teste: CT-25
Nome do Cenário: Usuário informa que não é cliente → orientação de cadastro e encerramento
Tipo: Exceção
Pré-condições: Contato novo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A7.
3. Usuário envia: "Não".
Resultado Esperado: Bot envia o conteúdo raw do bloco "[MSG] Cadastro" (no canal de teste será registrado o formato recebido) e depois "A Central MBRF agradece o seu contato!".
Pós-condições: Conversa volta ao onboarding da Captação; Ofertas não é alcançado.

ID do Teste: CT-26
Nome do Cenário: Produto sem preço para o endereço → erro ao preparar carrinho → encerrar
Tipo: Exceção
Pré-condições: Usuário elegível; carrinho com SKU sem preço para o endereço da conta.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e B1–B8 com [Massa_Carrinho_SemPreco].
3. Sistema: Lê carrinho → `precoZeradoCentral=true`.
4. Bot envia o menu "Ocorreu um erro Os produtos a seguir estão sem preço para este endereço: <produtos>. Que tal tentar novamente?" [Tentar novamente | Encerrar conversa].
5. Usuário envia: "Encerrar conversa" → executar D2–D5.
Resultado Esperado: A mensagem lista os produtos sem preço e nenhum checkout é iniciado.
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-27
Nome do Cenário: Produto indisponível para o endereço → erro ao preparar carrinho → "Tentar novamente"
Tipo: Exceção
Pré-condições: Usuário elegível; carrinho com SKU não encontrado para o endereço.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e B1–B8 com [Massa_Carrinho_Indisponivel].
3. Bot envia o menu "Ocorreu um erro Alguns produtos não estão disponíveis para este endereço: <produtos>. Que tal tentar novamente?" [Tentar novamente | Encerrar conversa].
4. Usuário envia: "Tentar novamente" → Sistema refaz "Sincroniza carrinho" → o mesmo menu volta.
5. Usuário envia: "Encerrar conversa" → executar D2–D5.
Resultado Esperado: A nova tentativa refaz a sincronização e repete o erro (o carrinho continua igual). O encerramento funciona.
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-28
Nome do Cenário: Conta sem endereço de entrega (Shipping) → pula o menu de endereço e vai direto às datas → pedido criado
Tipo: Edge Case
Pré-condições: Usuário elegível cuja conta não tem endereço `addressType=Shipping` com `addressId` e `street`.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Email_SemEndereco]/[Massa_Senha_SemEndereco] e [Massa_Carrinho_Unico_AcimaMinimo].
3. Executar C1–C4 → `temEnderecos=false` → executar C7–C10 (sem C5/C6).
4. Executar o Bloco D.
Resultado Esperado: Nenhum menu de endereço aparece e o pedido é criado. Registrar se a gravação de entrega (`17ea68a4`) funciona sem `entregaEnderecoId`.
Pós-condições: Pedido criado.

ID do Teste: CT-29
Nome do Cenário: Usuário digita "sair" em um menu de Ofertas → recusa encerrar → retorna ao mesmo menu
Tipo: Edge Case
Pré-condições: Usuário elegível; carrinho abaixo do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Unico_AbaixoMinimo] → menu "Falta bem pouquinho …".
3. Usuário envia: "sair" → `intentAction="Input inesperado"` → fallback → Redirect para Exceções.
4. Bot envia o menu "Você realmente deseja encerrar o atendimento?" [Sim | Não | Menu inicial] → Usuário envia: "Não".
5. Sistema: "Retorna último bloco - Não conta exceções" → Redirect para Ofertas no `lastState`.
6. Bot envia de novo o menu "Falta bem pouquinho …" [Completar pedido | Encerrar] → Usuário envia: "Encerrar" → "Sim" → executar D2–D5.
Resultado Esperado: O retorno ao último bloco reapresenta o mesmo menu de Ofertas e a jornada continua.
Pós-condições: Nenhum pedido criado.

ID do Teste: CT-30
Nome do Cenário: Usuário digita "menu" no menu de condição de pagamento → volta ao menu inicial
Tipo: Edge Case
Pré-condições: Usuário elegível; carrinho acima do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A, o Bloco B e C1–C2.
3. Usuário envia: "menu" no menu de condição de pagamento.
Resultado Esperado: O fallback do subflow leva a Exceções → "Voltar ao menu" → Redirect para a Captação (`@redirectMenu`) → Bot envia de novo o menu inicial "Oi, … O que vamos fazer agora?".
Pós-condições: Carrinho Salesforce criado e não finalizado; nenhum pedido.

ID do Teste: CT-31
Nome do Cenário: Texto livre enviado enquanto o catálogo está aberto (sem montar carrinho)
Tipo: Edge Case
Pré-condições: Contato novo, sem `smartsalesOrder`; usuário elegível.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e B1–B7.
3. Usuário envia: "oi, quero frango" (sem usar o catálogo).
Resultado Esperado: O estado Smart Sales aceita qualquer input e executa o leaving-action → Formata produtos sem carrinho → Sincroniza carrinho falha (`batchCarrinhoOk=false`) → Bot envia o menu "Ocorreu um erro {{mensagemErroCarrinho}} Que tal tentar novamente?" [Tentar novamente | Encerrar conversa]. Registrar o texto real de `mensagemErroCarrinho`.
Pós-condições: Nenhum pedido.

ID do Teste: CT-32
Nome do Cenário: Três entradas inesperadas seguidas → menu "Persistente"
Tipo: Edge Case
Pré-condições: Usuário elegível; carrinho abaixo do mínimo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A e o Bloco B com [Massa_Carrinho_Unico_AbaixoMinimo].
3. Usuário envia três vezes uma entrada fora do menu, sem palavras-chave ("menu", "sair"), por exemplo "xyzw".
Resultado Esperado: Na 3ª exceção (`exceptionCounter ≥ 3`), o Bot envia "Não consegui entender sua mensagem. Por favor, selecione o que deseja fazer:" [Tentar novamente | Menu inicial]. As duas primeiras respostas dependem do NLP/SmallTalks do fluxo de Exceções e serão registradas como observadas.
Pós-condições: `exceptionCounter` zerado.

ID do Teste: CT-33
Nome do Cenário: Falha ao iniciar checkout → estado "teste" ("Some text") → reinício da busca de contas
Tipo: Exceção
Pré-condições: Falha real no POST/GET de checkouts (sem mock). Exige indução controlada no QAS.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A, o Bloco B e C1–C8.
3. Sistema: Inicia checkout sem `statusCheckout`/`statusCheckoutAtivo` 2xx.
Resultado Esperado: Pelos blocos reais, o Bot envia "Some text" e volta para "Busca contas vinculadas", em vez de "Ocorreu um erro …" (achado A4).
Pós-condições: Carrinho sem checkout.

ID do Teste: CT-34
Nome do Cenário: Erro ao criar pedido → "Tentar novamente" → "Trocar pagamento" → pedido criado
Tipo: Exceção
Pré-condições: Falha real em grava pagamento, recálculo, checkout ou pedido (sem mock); depois o ambiente se recupera.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A, o Bloco B e C1–C8.
3. Bot envia o menu "Ocorreu um erro Não conseguimos concluir sua solicitação. Que tal tentar novamente?" [Tentar novamente | Encerrar conversa] → Usuário envia: "Tentar novamente".
4. Bot envia o menu "Entendi! Vamos te ajudar. 😊 Para continuar com o pedido, você pode tentar o pagamento novamente ou escolher outra forma de pagamento. …" [Tentar novamente | Trocar pagamento] → Usuário envia: "Trocar pagamento".
5. Executar C2–C10 e depois o Bloco D.
Resultado Esperado: "Trocar pagamento" reapresenta as condições de pagamento e a jornada termina com pedido criado. Registrar se o turno pós-data respeita 1 min e 10 transições (achado A5).
Pós-condições: Um único pedido criado (sem duplicidade).

ID do Teste: CT-35
Nome do Cenário: Inatividade no menu "Você já é cliente?" → aviso → segunda inatividade → encerramento
Tipo: Edge Case
Pré-condições: Contato novo. O teste leva mais de 15 min por janela (expiração "0:15").
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar A1–A7 e não responder.
3. Aguardar a expiração do input.
Resultado Esperado: Exceções/Inatividade envia "Ainda está por aí? Vi que ficamos um tempinho sem nos falar. Se quiser continuar a conversa, é só me mandar uma mensagem! 😉". Sem nova resposta, envia "Estou finalizando a nossa conversa por aqui. Quando quiser falar novamente, é só mandar um "Oi" para mim. 😊 A Centrl MBRF agradece o seu contato. 👋".
Pós-condições: Conversa volta à Captação.

## 6. Matriz de cobertura

| Área | Cenários |
| --- | --- |
| Autenticação (sucesso / e-mail / telefone / CNPJ / não cliente / senha) | CT-01, CT-18–CT-25 |
| Contas vinculadas (1 / várias) | CT-01, CT-02, CT-07 |
| Elegibilidade (todos os motivos) | CT-06–CT-11 |
| Valor mínimo (único / misto, todos os ramos) | CT-04, CT-12–CT-16 |
| Carrinho misto e 2º carrinho automático | CT-03, CT-14–CT-16 |
| Pagamento / endereço / data / checkout / pedido | CT-01, CT-17, CT-28, CT-33, CT-34 |
| Erros de carrinho | CT-26, CT-27, CT-31 |
| Exceções / fallback / inatividade | CT-29–CT-32, CT-35 |
| Transbordo (Sophia) e encerramento | CT-02, CT-19, Bloco D |
| Entrada alternativa (Comprar produtos) | CT-05 |

Falhas de API 5xx não listadas como cenário próprio ("Erro ao buscar contas", "Erro verificação elegibilidade", "Erro janela de entrega", "Erro ao separar carrinho") só podem ser executadas com indução real de falha no QAS, porque mocks estão fora do escopo.

## 7. Cenários dos demais subbots

Cada cenário aqui começa pelo "Olá" na Captação. O Bloco A da seção 4 continua válido como pré-caminho. Para abreviar, chamo "Bloco A" cada vez que a autenticação se repete.

### 7.1 `hmlf1meuspedidos` — Meus Pedidos

Menu de entrada (após "🛒 Meus Pedidos"): Informação cupom | Cancelar pedido | Pedido não entregue | Valor divergente | Erro no pedido | Como fazer pedido? | Menu inicial.

ID do Teste: CT-36
Nome do Cenário: Entrada em Meus Pedidos → "Cancelar pedido" → mensagem orientativa → encerramento
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "🛒 Meus Pedidos".
4. Bot envia o menu "*Sobre meus pedidos o que você precisa resolver?*" → Usuário envia: "Cancelar pedido".
5. Bot envia a mensagem "O pedido somente poderá ser cancelado em status REALIZADO, se este for o seu caso, entre em contato no 0800 702 3311 e digite a opção 5 para realizar o cancelamento. …".
6. Executar D2–D5 (encerrar).
Resultado Esperado: A mensagem orientativa chega literalmente conforme o bloco `89002669`. Nenhuma chamada de API é feita.
Pós-condições: Conversa volta para a Captação.

ID do Teste: CT-37
Nome do Cenário: Meus Pedidos → "Informação cupom" → "Regras de Devolução"
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "🛒 Meus Pedidos".
4. Usuário envia: "Informação cupom".
5. Bot envia o menu "*Sobre informação cupom o que você precisa resolver?*" (Regras de Devolução | Erro ao usar cupom | Solicitar devolução | Menu inicial | Encerrar atendimento) → Usuário envia: "Regras de Devolução".
6. Bot envia o texto do bloco `48ed89c0` ("A Central realiza a reativação automática …").
7. Executar D2–D5.
Resultado Esperado: Mensagem completa e correta.
Pós-condições: Conversa volta para a Captação.

ID do Teste: CT-38
Nome do Cenário: Meus Pedidos → "Valor divergente" → coleta de dados → "Não" ao abrir chamado
Tipo: Exceção
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "🛒 Meus Pedidos" → "Valor divergente".
4. Bot envia "Vou abrir um chamado para registrar sua solicitação …" e começa a coletar dados.
5. Usuário envia: "qualquer input" no primeiro `[INPUT]` que aparecer.
Resultado Esperado: Registrar a sequência real de inputs pedidos. Variável de controle: `localCompra` ou similar. O cenário serve de smoke test.
Pós-condições: Caso real pode ser aberto no Salesforce — registrar.

### 7.2 `hmgf1financeiroo` — Financeiro

Menu de entrada (após "💰 Financeiro"): Pedido e 2ª via NF | 2ª via de Boleto | Falar sobre crédito | Menu anterior.

ID do Teste: CT-39
Nome do Cenário: Financeiro → "2ª via de Boleto" → link direto
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "💰 Financeiro" → "2ª via de Boleto".
4. Bot envia: "Você pode gerar o seu boleto através do link abaixo: https://www.brf-br.com/boletos/".
5. Executar D2–D5.
Resultado Esperado: Link literal conforme bloco `0cbe1daa`.
Pós-condições: Volta à Captação.

ID do Teste: CT-40
Nome do Cenário: Financeiro → "Falar sobre crédito" → "Ver limite crédito" → consulta real
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado com crédito disponível na conta vinculada.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "💰 Financeiro" → "Falar sobre crédito" → "Ver limite crédito".
4. Sistema chama a API de informações de crédito.
5. Bot envia: "Veja como está seu crédito no momento: 💰 Limite de crédito: … 📉 Crédito utilizado: … ✅ Crédito disponível: …" (bloco `68a00fff`).
Resultado Esperado: As três linhas são preenchidas por `retornoCredito`. Se a conta não tiver crédito ativo, cai no bloco `d0ab236a` "Por enquanto, este CNPJ ainda não possui uma conta crédito ativa.".
Pós-condições: Registrar os valores retornados.

ID do Teste: CT-41
Nome do Cenário: Financeiro → "Falar sobre crédito" → "Crédito bloqueado" → motivos informados
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "💰 Financeiro" → "Falar sobre crédito" → "Crédito bloqueado".
4. Bot envia três mensagens informativas (bloco `edcb039f`): motivos, operação 24/7 e orientação de contato.
Resultado Esperado: As três mensagens chegam na ordem documentada.
Pós-condições: Volta à Captação.

### 7.3 `hmgf1meucadastroo` — Meu Cadastro

Menu (após "👤Meu Cadastro"): 🔑 Redefinir senha | 💬 Avisos WhatsApp | 📧 Avisos E-mail | ✏️ Alteração E-mail | 🔍 Consulta E-mail | 👤E-mail Admin. | 📍 Info. Endereço | 💬 Falar com Equipe | 🏠 Menu inicial | Encerrar atendimento.

ID do Teste: CT-42
Nome do Cenário: Meu Cadastro → "🔑 Redefinir senha" → link direto
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "👤Meu Cadastro" → "🔑 Redefinir senha".
4. Bot envia o texto do bloco `db7dbb1c` com o link `https://centralbrf-reset.brf.cloud/…`.
Resultado Esperado: Link literal.
Pós-condições: Volta à Captação.

ID do Teste: CT-43
Nome do Cenário: Meu Cadastro → "💬 Avisos WhatsApp" → "Sim" → aceite registrado
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "👤Meu Cadastro" → "💬 Avisos WhatsApp".
4. Bot envia o menu "Você gostaria de ativar as notificações aqui no WhatsApp sobre promoções exclusivas e status dos seus pedidos?" [Sim | Não].
5. Usuário envia: "Sim".
6. Bot envia: "Legal, {{contact.name}}. 😊 Vou armazenar essa informação. …" (bloco `96f6e2b6`).
Resultado Esperado: Mensagem de confirmação e `MergeContact` do opt-in.
Pós-condições: `contact.extras.optIn` ou campo equivalente atualizado.

ID do Teste: CT-44
Nome do Cenário: Meu Cadastro → "📍 Info. Endereço" → "Ver endereço entrega" → endereço cadastrado
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado com endereço cadastrado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "👤Meu Cadastro" → "📍 Info. Endereço" → "Ver endereço entrega".
4. Bot envia: "Aguarde enquanto encontro o endereço cadastrado… 🔎" → chamada de API.
5. Bot envia "Este é o endereço cadastrado para suas entregas: 🏡 <endereço>. …" ou "No momento, não encontramos um endereço de entrega cadastrado para sua conta.".
Resultado Esperado: Uma das duas mensagens. Registrar o endereço retornado.
Pós-condições: Volta à Captação.

### 7.4 `hmgf1ajudaesuporte` — Ajuda e Suporte

Menu (após "💬Ajuda e Suporte"): Reclamar da Central | Problema no pedido | Qualidade do produto | Dúvidas | Menu inicial | Encerrar atendimento.

ID do Teste: CT-45
Nome do Cenário: Ajuda e Suporte → "Qualidade do produto" → canais informados → "Não" ao chamado
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "💬Ajuda e Suporte" → "Qualidade do produto".
4. Bot envia "Para problemas relacionados à qualidade ou alteração de produto, solicitamos que acione a área especializada, através de um dos canais abaixo: 📞 0800 702 3311 - opção 3 📩 brfcliente@brf.com 📱 https://bit.ly/Sophia_SAC_BRF" (bloco `37ba2d6d`).
5. Bot envia o menu "Além disso, podemos abrir um chamado para registrar a sua reclamação ou problema que você está tendo. Deseja abrir um chamado?" [Sim | Não] → Usuário envia: "Não".
6. Executar D2–D5.
Resultado Esperado: Mensagens corretas, encerramento ocorre.
Pós-condições: Nenhum chamado criado.

ID do Teste: CT-46
Nome do Cenário: Ajuda e Suporte → "Dúvidas" → transbordo para a Sophia
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "💬Ajuda e Suporte" → "Dúvidas".
4. Pelo bloco `1e3bb5fc` ("[REDIRECT] Encaminhar para Sophia"): o fluxo redireciona para `mbrfencaminhamentosophiahmg`.
5. Bot envia a variante Blip Chat da mensagem "Para te ajudar da melhor forma, seu atendimento continuará com a Sophia, nossa assistente especializada. … 🔗https://wa.me/+558007028800".
Resultado Esperado: Mensagem de transbordo chega e, em seguida, menu "Posso te apoiar em mais alguma coisa por aqui? 😊".
Pós-condições: Volta à Captação ao final.

### 7.5 `hmgvagasmbrf` — Vagas MBRF

Entrada: NLU na captação com palavras como "vaga", "emprego", "trabalho", "curriculo" etc.

ID do Teste: CT-47
Nome do Cenário: Primeira mensagem com intenção "vagas" → fluxo Vagas MBRF → encerramento
Tipo: Caminho Feliz
Pré-condições: Contato novo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá, quero uma vaga de emprego".
2. O script `intencaoMbrf` da Captação detecta "vagasMBRF" e redireciona para `hmgvagasmbrf`.
3. Bot envia o texto do bloco `322b903c` "Ficamos felizes que tenha interesse em fazer parte de nosso time! 🤩" e segue para o menu "Ajudo em algo mais".
Resultado Esperado: Mensagem correta; fluxo não entra em LGPD/telefone.
Pós-condições: Volta à Captação.

### 7.6 `hmlmbrfcomercioexterior` — Comércio Exterior

Entrada: NLU "informações sobre exportação", "comércio exterior" etc.

ID do Teste: CT-48
Nome do Cenário: Primeira mensagem com intenção "comercio externo" → fluxo Comex → encerramento
Tipo: Caminho Feliz
Pré-condições: Contato novo.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá, quero informações sobre exportação".
2. A Captação detecta `comercioExterno` e redireciona para `hmlmbrfcomercioexterior`.
3. Registrar as mensagens iniciais que o subbot envia (não há `select` no corpo publicado, só mensagens).
Resultado Esperado: Fluxo entra em Comex e segue para "Ajudo em algo mais".
Pós-condições: Volta à Captação.

### 7.7 `hmgf2recomprar`

Entrada: "🔁 Recomprar" (só aparece quando `contact.extras.smartsalesOrder` existe).

ID do Teste: CT-49
Nome do Cenário: Com `smartsalesOrder` prévio → "🔁 Recomprar" → menu "Pedido anterior localizado"
Tipo: Caminho Feliz
Pré-condições: Usuário autenticado, com `smartsalesOrder` gravado nos extras.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. QA grava `contact.extras.smartsalesOrder` (massa real) antes do menu inicial, de modo que o menu dinâmico mostre "🔁 Recomprar".
4. Usuário envia: "🔁 Recomprar".
5. Bot envia o menu "{{textoUltimaCompra}}" [Repetir pedido | Fazer novo pedido | 🔥 Ver ofertas] → Usuário envia: "Repetir pedido".
6. Fluxo redireciona para Ofertas (bloco `3bdc4eab`).
Resultado Esperado: Menu de recompra aparece.
Pós-condições: Entra em Ofertas.

### 7.8 `mbrfexcecoeshmg`

Entrada: `fallback` de qualquer subbot (input fora do menu).

ID do Teste: CT-50
Nome do Cenário: Input fora do menu em Ofertas → cascata de exceções
Tipo: Edge Case
Pré-condições: Usuário autenticado, no menu inicial.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "xyzw" (input sem palavra-chave).
Resultado Esperado: Primeiro passa pelo bloco "SmallTalks" (`326c5651`); se o NLP não casar, cai em "Cascata de exceções" e eventualmente em "Persistente" ou retorno ao último bloco. Registrar o caminho real.
Pós-condições: Conversa em exceção.

ID do Teste: CT-51
Nome do Cenário: Usuário envia "sair" no menu inicial → confirmação → encerramento
Tipo: Edge Case
Pré-condições: Usuário autenticado.
Passos para Reprodução (Passo a Passo E2E):
1. Usuário envia: "Olá".
2. Executar o Bloco A.
3. Usuário envia: "sair".
4. Bot envia o menu "Você realmente deseja encerrar o atendimento?" [Sim | Não | Menu inicial] → Usuário envia: "Sim".
5. Fluxo redireciona para Finalização.
Resultado Esperado: Executar D4–D5 corretamente.
Pós-condições: Conversa encerrada.

### 7.9 `mbrfajudoemalgomaishmg`

Já exercitado nos blocos D de todos os cenários acima.

### 7.10 `mbrffinalizarhmg`

ID do Teste: CT-52
Nome do Cenário: Finalização → "Sim" na avaliação → nota 5 → "Não" ao comentário
Tipo: Caminho Feliz
Pré-condições: Chegar à finalização por qualquer caminho (ex.: CT-45).
Passos para Reprodução (Passo a Passo E2E):
1. Executar os passos 1–5 do CT-45.
2. Usuário envia: "Sim" no menu "Posso te apoiar em mais alguma coisa por aqui?" → "Encerrar conversa".
3. Bot envia o menu "Você poderia avaliar o nosso atendimento? É bem rapidinho! 😃" [Sim | Não] → Usuário envia: "Sim".
4. Bot envia o menu de NPS [5 - 🤩 | 4 - 😄 | 3 - 🙂 | 2 - 😐 | 1 - 😟] (canal diferente de WhatsApp) → Usuário envia: "5 - 🤩".
5. Bot envia o texto Promotores + menu [Sim, claro | Não, obrigado] → Usuário envia: "Não, obrigado".
Resultado Esperado: Bot envia "A Central MBRF agradece o seu contato!" e "É um prazer poder receber você aqui! 😊".
Pós-condições: Conversa encerrada; `motivoNota` registrada.

### 7.11 `mbrfathhmg` e `mbrfencaminhamentosophiahmg`

ATH (`mbrfathhmg`) é um subbot de atendimento humano chamado por `ForwardToDesk`. O harness de teste não representa um agente, então a chamada ao desk abre um ticket que fica no estado "NoAgentAvailable" (sem atendente disponível) ou "OutOfAttendanceHour", ambos tratados pelo próprio subbot. Esse cenário depende de fila real e não é determinístico via test.

Sophia (`mbrfencaminhamentosophiahmg`) já é coberto por CT-46.

### 7.12 `mbrffalhaapihmg`

Só é alcançado por `[REDIRECT] Falha API` dos demais subbots quando uma chamada HTTP crítica retorna 5xx/4xx. Precisa de indução real de falha no QAS. Marcado como não executável em ambiente padrão.

