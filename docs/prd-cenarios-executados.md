# PRD — Chatbot Central MBRF · Qualidade das Jornadas Testadas

**Produto:** Chatbot `hmgmbrf` (router) · ambiente **QAS**
**Autor:** QA Sênior · **Última revisão:** 15/10/2026
**Suíte E2E:** `tests/jornadas.test.ts` (20 cenários + 1 smoke)
**Status geral (execução 3, 15/10 11h):** 20 passaram, 1 falhou

Este PRD descreve, do ponto de vista de produto, **o que o chatbot precisa fazer** nas jornadas cobertas pelos testes E2E executados contra o bot publicado em QAS. Cada requisito é derivado de blocos reais do Blip Builder lidos via `bbuilder inspect`, e tem critérios de aceitação verificáveis pelo teste correspondente.

---

## 1. Visão e objetivo

**Produto.** Um chatbot omnicanal que atende clientes da Central MBRF do contato inicial à efetivação do pedido no Salesforce Commerce, com atendimento financeiro, cadastro, suporte e fallback humano.

**Objetivo da suíte E2E.** Garantir que as 10 jornadas principais funcionam ponta a ponta na mesma versão do bot que atende o cliente real, usando dados reais do QAS (sem mocks).

**Fora de escopo (não testável no harness atual).**
- Transbordo real para fila de atendentes humanos (`mbrfathhmg`): depende de atendente online.
- Catálogo Smart Sales (montagem real do carrinho na página web): fora do canal conversacional.
- Fluxo de falha de API (`mbrffalhaapihmg`): só é alcançado com erro real da API.
- `hmgf2ofertaseopt` (versão local em desenvolvimento): não publicada.

---

## 2. Personas e canais

| Persona | Perfil | Como entra |
|---|---|---|
| Cliente novo (contato novo em QAS) | Nunca falou com o bot | "Olá" na captação; cumpre LGPD + telefone + autenticação |
| Cliente retornando | Já autenticado antes | "Olá"; vê "Olá novamente!" e pode usar o último e-mail |
| Candidato a vagas | Qualquer | Mensagem com palavra-chave ("vaga", "emprego") |
| Comércio exterior | Qualquer | Mensagem com palavra-chave ("exportar", "importação") |

**Canal testado:** tunnel do Blip (`@0mn.io`). O canal real é WhatsApp — algumas mensagens interativas aparecem com variação (seção 7).

---

## 3. Requisitos funcionais e critérios de aceitação

Cada requisito agrupa cenários relacionados. O número à direita (CT-XX) é o cenário que valida o critério.

### RF-01 · Captação e autenticação

**O cliente precisa ser identificado pelo telefone (DDD), e-mail e senha antes de usar os serviços.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| Mensagem de "Olá" responde com saudação + LGPD + pedido de telefone, nesta ordem | Bloco A em CT-01 a CT-52 | ✅ estável |
| Telefone com formato inválido pede nova tentativa com exemplo | CT-23 | ✅ estável |
| Após telefone válido, bot pergunta "Você já é um cliente cadastrado?" | CT-01, CT-25 | ✅ estável |
| Resposta "Não" ao "é cliente?" encerra com "A Central MBRF agradece o seu contato!" | CT-25 | ✅ estável |
| E-mail em formato inválido oferece "Esqueci o E-mail" ou "Informar E-mail" | CT-20 | ✅ estável |
| Após autenticação, bot pergunta opt-in de WhatsApp e exibe menu inicial | Bloco A | ✅ estável |

**Defeito aberto:** [F1] Mensagem de confirmação após opt-in sai "Certo, . Vou armazenar essa informação aqui." com o nome vazio. Causa provável: variável `{{infosUserSalesForce@FirstName}}` só é populada no caminho de autenticação por CNPJ, não no caminho por e-mail. **Impacto:** baixo (apenas estético). **Confirmado em todos os 60 contatos criados pelas três execuções.**

---

### RF-02 · Menu inicial dinâmico

**O menu inicial deve ofertar as jornadas disponíveis para o perfil.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| Contato sem `smartsalesOrder` recebe menu com 6 opções: 🔥 Ofertas · 🍗 Comprar produtos · 🛒 Meus Pedidos · 💰 Financeiro · 💬 Ajuda e Suporte · 👤 Meu Cadastro | Bloco A | ✅ estável |
| Contato com `smartsalesOrder` nos extras passa a ver também 🔁 Recomprar e troca "🔥 Ofertas" por "🔥 Ofertas e oportunidades" | CT-49 | ✅ estável |

---

### RF-03 · Jornada de Ofertas e Oportunidades

**Depois de selecionar uma conta elegível, o cliente navega até o catálogo externo (Smart Sales).**

| Critério de aceitação | Teste | Status |
|---|---|---|
| Usuário com 1 conta pula a seleção; usuário com 2+ contas recebe menu "Encontrei N contas vinculadas" | CT-01, CT-10 | ✅ estável |
| Conta elegível leva ao valor mínimo (`R$ X,XX`) e aviso de PIX/cartão com caução | CT-01 | ✅ estável |
| Em seguida, bot envia o link do catálogo Smart Sales (`https://leva.la/<id>`) | CT-01 | ✅ estável |
| Conta inelegível (pendência, bloqueio, inativa, insuficiente, não RELEASED) retorna mensagem específica e, com múltiplas contas, re-apresenta o menu | CT-10 | ❌ bloqueado (ver abaixo) |

**Defeito aberto:** [F8] A conta `1. AUDILEIDE DE JESUS NASCIMENTO 32505` do usuário `bovinos@uorak.com`, usada para validar o critério "conta inelegível", **mudou de status entre 13/10 e 15/10**: agora é elegível e segue até o catálogo. **Impacto:** o teste CT-10 falha estruturalmente — não é bug do bot, é massa de dados. **Ação:** o time financeiro precisa reservar uma conta QAS que fique estável no estado "em atraso" para esse teste.

**Defeito aberto:** [F6] Após criar um pedido, se o cliente escolher "Repetir pedido" no menu "Pedido anterior localizado", o fluxo vai para o **início** de Ofertas (nova busca de contas, nova verificação de elegibilidade) em vez de reaproveitar o carrinho. **Causa confirmada:** o estado `3bdc4eab-e9d2-42a9-817d-c3c3f78c66fd` redireciona para `740f2bf2` com contexto `@redirect`, quando deveria ser `@redirect_cart`. **Teste:** CT-49.

---

### RF-04 · Jornada "Meus Pedidos"

**Oferecer cancelamento, informação de cupom, consulta de pedido e abertura de chamados.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| Opção "Cancelar pedido" devolve a orientação do 0800 e condição de status REALIZADO | CT-36 | ✅ estável |
| Opção "Informação cupom" → "Regras de Devolução" devolve o texto de reativação automática | CT-37 | ✅ estável |

---

### RF-05 · Jornada "Financeiro"

**Permitir ao cliente consultar e gerar 2ª via de boleto, consultar limite de crédito, saber motivos de bloqueio.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| "2ª via de Boleto" envia o link `https://www.brf-br.com/boletos/` no botão | CT-39 | ✅ estável |
| "Falar sobre crédito" → "Ver limite crédito" devolve limite, utilizado e disponível | CT-40 | ⚠️ flaky — depende da API |
| "Falar sobre crédito" → "Crédito bloqueado" devolve os três motivos oficiais (fiscais, financeiras, boleto em dia não-útil) | CT-41 | ✅ estável |

**Defeito aberto:** [F4] A chamada `GET /services/data/.../credit` em `b4694c78` não tem `continueOnError`, então qualquer resposta ≠ 2xx aborta a turn inteira. Em uma das execuções o CT-40 falhou com `ProcessHttp has failed (101)`. **Impacto:** se a API ficar instável, o cliente vê "O bot não processou a sua mensagem" em vez do fluxo `mbrffalhaapihmg`. **Ação:** adicionar `continueOnError` e cablear o Redirect `@falhaAPI`.

---

### RF-06 · Jornada "Meu Cadastro"

**Permitir redefinir senha, alterar avisos, alterar e-mail e consultar/alterar endereço.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| "🔑 Redefinir senha" devolve o link `centralbrf-reset.brf.cloud` | CT-42 | ✅ estável |
| "💬 Avisos WhatsApp" → "Sim" confirma com "Vou armazenar essa informação." e persiste no contato | CT-43 | ✅ estável |

---

### RF-07 · Jornada "Ajuda e Suporte"

**Oferecer canais oficiais e abertura de chamado para qualidade, problemas e dúvidas.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| "Qualidade do produto" devolve os canais oficiais (`0800 702 3311` opção 3, `brfcliente@brf.com`, Sophia) e pergunta se o cliente deseja abrir chamado | CT-45 | ✅ estável |
| "Dúvidas" encaminha para a Sophia com o link `https://wa.me/+558007028800` | CT-46 | ⚠️ flaky |

**Defeito aberto:** [F3] O Redirect para `{{resource.redirect@falarComSophia}}` falhou em uma das execuções (nenhuma mensagem em 240 s). Nas outras duas execuções respondeu em 133 s. **Hipótese:** cold start do subbot `mbrfencaminhamentosophiahmg` ou latência de resolução de resource. **Impacto:** em QAS pode acontecer de o cliente ficar sem resposta por alguns minutos.

---

### RF-08 · Intenções NLU na entrada

**Detectar intenções específicas na primeira mensagem e redirecionar sem passar pela autenticação.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| "Olá, quero uma vaga de emprego" vai direto para o subbot Vagas MBRF | CT-47 | ✅ estável |
| "Olá, quero exportar produtos" vai direto para o subbot Comércio Exterior e envia o link `https://www.brf-global.com/en/sales-channel/` | CT-48 | ⚠️ flaky (mesmo F3) |

---

### RF-09 · Jornada de encerramento

**Depois de qualquer serviço, o cliente deve poder encerrar e avaliar o atendimento.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| "Posso te apoiar em mais alguma coisa por aqui?" é apresentado ao fim de todas as jornadas | CT-25, CT-45, CT-52 | ✅ estável |
| "Encerrar conversa" leva ao menu "Você poderia avaliar o nosso atendimento?" | CT-52 | ✅ estável |
| NPS 5 → texto Promotores → "Não, obrigado" → "A Central MBRF agradece o seu contato!" | CT-52 | ✅ estável |

---

### RF-10 · Tratamento de exceções

**Entradas inválidas e inatividades precisam ter saída clara.**

| Critério de aceitação | Teste | Status |
|---|---|---|
| Input sem significado (ex.: "xyzw") recebe a mensagem de persistente com opção "Tentar novamente" | CT-50 | ✅ estável |
| Palavra-chave "sair" fora de um menu abre "Você realmente deseja encerrar o atendimento?" | CT-51 | ✅ estável |

**Defeito aberto:** [F7] A mensagem de persistente contém a tag HTML `<b>` crua ("Por favor, <b>selecione</b> uma das opções do menu.") no canal tunnel. No WhatsApp, essa tag é interpretada como asterisco de negrito pelo renderizador do app, mas no canal web/API ela aparece bruta.

---

## 4. Massa de dados usada

| Dado | Valor | Usado em |
|---|---|---|
| Telefone | `31973122071` | todos os cenários do Bloco A |
| E-mail (perfil 1) | `bovino@uorak.com` — 9 contas vinculadas, pelo menos uma elegível | CT-01, CT-23, CT-25, CT-36, CT-37, CT-39–CT-46, CT-49, CT-50–CT-52 |
| E-mail (perfil 2) | `bovinos@uorak.com` — 12 contas vinculadas | CT-10 |
| Senha | `Central@25` | ambos os perfis |
| `smartsalesOrder` em `contact.extras` | Produto Asa de Frango Sadia · 3 un · R$ 519,84 | CT-01 (injeção no lugar da montagem via catálogo) |

---

## 5. Resumo das execuções

| Execução | Data/hora | Passou | Falhou | Observação |
|---|---|---|---|---|
| Execução 1 | 13/10 ~18h | 17 | 3 | Flakiness no QAS (CT-40, CT-46, CT-48) |
| Execução 2 | 15/10 09h | 19 | 1 | QAS estável; CT-10 revelou F8 (massa mudou) |
| Execução 3 | 15/10 11h | 20 | 1 | QAS estável; só CT-10 (F8) |

**Base estável de regressão (passou nas 3 execuções):** 18 cenários — CT-01, 20, 23, 25, 36, 37, 39, 41, 42, 43, 45, 47, 49, 50, 51, 52 + smoke test. Esses cenários podem rodar em cada entrega sem supervisão.

---

## 6. Defeitos abertos (prioridade sugerida)

| ID | Severidade | Descrição | Teste | Correção sugerida |
|---|---|---|---|---|
| F4 | **Alta** | Falha da API de crédito derruba a turn (sem `continueOnError`) | CT-40 | Adicionar `continueOnError` em `b4694c78` e cablear o fluxo de falha API |
| F6 | **Alta** | "Repetir pedido" não reaproveita o carrinho; reinicia a jornada | CT-49 | Trocar o contexto do Redirect em `3bdc4eab` de `@redirect` para `@redirect_cart` |
| F8 | **Alta** | Massa "conta com pendência" não é mais válida — teste de regressão sem lastro | CT-10 | Time financeiro reserva uma conta QAS fixa no estado "em atraso" |
| F3 | **Média** | Redirect `falarComSophia` tem latência errática (240 s em uma execução) | CT-46 | Investigar cold start do subbot Sophia / resolução do resource |
| F2 | **Média** | Redirect `comercioExterior` tem latência errática (150 s em uma execução) | CT-48 | Mesmo tratamento de F3 |
| F5 | **Média** | `smartsalesOrder` injetado nos extras é rejeitado pelo [API] Sincroniza carrinho | CT-01 | Avaliar se existe caminho suportado para iniciar o carrinho fora da sessão Smart Sales |
| F1 | **Baixa** | Nome do cliente vazio em "Certo, . Vou armazenar essa informação." | 16 contatos | Buscar `FirstName` também pelo caminho de e-mail (ou via YGG por e-mail) |
| F7 | **Baixa** | Tag `<b>` crua em mensagem de persistente fora do WhatsApp | CT-50 | Trocar `<b>…</b>` por `*…*` ou usar formatação do canal |

---

## 7. Observações de canal

Os testes rodam no canal tunnel (`@0mn.io`), não no WhatsApp. Isso significa que:
- Mensagens interativas chegam como `application/json` com `interactive.type` (`cta_url`, `list` etc.), e nos logs aparecem como `interactive/cta_url` com o `url` extraído.
- O variante "Blip Chat" da Sophia é a que responde no canal de teste (CT-46).
- O `TrackEvent` de analytics acontece normalmente; os valores vão para `take-api-beholder`.

Antes de considerar as jornadas 100% operacionais, cada caminho precisa de pelo menos uma conversa real no WhatsApp para validar formatação, botões e `cta_url`.

---

## 8. Pendências para liberar os cenários não executados

| Cenário | O que falta |
|---|---|
| CT-02 a CT-05, CT-11 a CT-19, CT-21, CT-22, CT-24, CT-26 a CT-35, CT-38, CT-44 | Usuários QAS com cada perfil (conta inativa, crédito bloqueado, crédito insuficiente, pendência estável, sem boleto, sem endereço) + CNPJ cadastrado para "Esqueci o e-mail" |
| CT-33, CT-34 | Mecanismo de indução de falha 5xx no QAS |
| ATH | Fila humana real |
| `hmgf2ofertaseopt` | Publicar depois de corrigir os erros de `bbuilder validate` |

---

## 9. Referências

- Mapeamento completo dos 52 cenários: `cenarios_de_teste.md`
- Relatórios por execução: `docs/relatorio-fase4.pdf`, `docs/relatorio-fase4-execucao-1.pdf`, `-execucao-2.pdf`, `-execucao-3.pdf`
- Transcrições: `docs/evidencias/`, `docs/evidencias-execucao-1/`, `docs/evidencias-execucao-2/`
- Suíte: `tests/jornadas.test.ts` · helper: `tests/helpers/e2e.ts`
