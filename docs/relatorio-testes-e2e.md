# Relatório — Testes E2E (15–16/10/2026)

**Projeto:** `mbrf-hmg-f2` · ambiente **QAS** (`https://qas.central-brf.com.br`) · router `hmgmbrf`
**Harness:** `bbuilder test --purge` (`node:test`) · canal de teste tunnel `@0mn.io`
**Evidências:** `docs/evidencias/CT-*.log` (uma transcrição por cenário)

## 1. Resultado consolidado

| Status | Cenários |
|---|---|
| ✅ Passou | 19 |
| ❌ Falhou por assertion | 1 (CT-10) |
| **Total executado** | **20** |

A suíte foi executada em duas janelas por causa de uma indisponibilidade do backend Blip QAS no dia 15/10 à tarde:

- **15/10 14h08** — a suíte iniciou normalmente e **12 cenários passaram** com duração típica (40–240 s).
- **15/10 14h30 em diante** — o Cassandra do Blip ficou sem réplicas vivas; **7 cenários (CT-46 a CT-52) ficaram bloqueados** por aproximadamente 49 min. Retentativas em 1, 3, 6 min e às 14h57 confirmaram que a plataforma seguia inoperante.
- **16/10 09h26** — a plataforma normalizou e os **7 cenários foram reexecutados com sucesso**.

Resultado final: **19 passaram / 1 falhou (CT-10)**. A única falha remanescente é de massa de dados, não de bot.

## 2. Testes executados — detalhe

| CT | Jornada | Duração | Status | Observação |
|---|---|---|---|---|
| CT-01 | Ofertas — happy path com carrinho injetado em `contact.extras` | 237 s | ✅ | Fluxo chega até Smart Sales; a sincronização do carrinho rejeita o `smartsalesOrder` injetado (achado F5) |
| CT-10 | Múltiplas contas → "AUDILEIDE…" → pendências financeiras | 166 s | ❌ | A conta não retorna mais "pendências financeiras" — segue para valor mínimo R$ 400 e link do catálogo. Massa de dados mudou (achado F8) |
| CT-20 | E-mail inválido → "Informar E-mail" → prossegue | 63 s | ✅ | |
| CT-23 | Telefone inválido → nova tentativa → prossegue | 42 s | ✅ | |
| CT-25 | "Não" ao "é cliente?" → encerra | 46 s | ✅ | |
| CT-36 | Meus Pedidos → "Cancelar pedido" → orientação | 157 s | ✅ | |
| CT-37 | Meus Pedidos → Informação cupom → Regras de Devolução | 166 s | ✅ | |
| CT-39 | Financeiro → 2ª via de Boleto → link | 160 s | ✅ | URL `https://www.brf-br.com/boletos/` presente no botão `cta_url` |
| CT-40 | Financeiro → Ver limite crédito | 152 s | ✅ | API respondeu normalmente nesta execução |
| CT-41 | Financeiro → Crédito bloqueado → motivos | 174 s | ✅ | |
| CT-42 | Meu Cadastro → Redefinir senha → link | 150 s | ✅ | URL `centralbrf-reset.brf.cloud` presente |
| CT-43 | Meu Cadastro → Avisos WhatsApp → Sim → aceite | 176 s | ✅ | |
| CT-45 | Ajuda e Suporte → Qualidade do produto → canais → "Não" | 182 s | ✅ | Canais `0800 702 3311` e `brfcliente@brf.com` presentes |
| CT-46 | Ajuda e Suporte → Dúvidas → transbordo Sophia | 195 s | ✅ | Reexecutado em 16/10 após normalização do Blip |
| CT-47 | NLU → Vagas MBRF | 31 s | ✅ | Reexecutado em 16/10 |
| CT-48 | NLU → Comércio Exterior | 49 s | ✅ | Reexecutado em 16/10 |
| CT-49 | Recomprar: `smartsalesOrder` → "Repetir pedido" | 159 s | ✅ | Reexecutado em 16/10. Confirma achado F6 (redirect leva ao início) |
| CT-50 | Exceções: input `xyzw` no menu inicial | 149 s | ✅ | Reexecutado em 16/10 |
| CT-51 | Exceções: "sair" no menu inicial → confirma → encerra | 161 s | ✅ | Reexecutado em 16/10 |
| CT-52 | Finalização → NPS 5 → agradecimento | 295 s | ✅ | Reexecutado em 16/10 |

## 3. Falha de assertion — CT-10

**Jornada:** `bovinos@uorak.com` → "🔥 Ofertas" → selecionar conta "1. AUDILEIDE DE JESUS NASCIMENTO 32505".
**Esperado:** mensagem "Identificamos pendências financeiras na sua conta…".
**Obtido:** fluxo seguiu até "Ah, o valor mínimo de fechamento do pedido é de R$ 400,00." + link `https://leva.la/oddqp7`.

Trecho da evidência (`docs/evidencias/CT-10.log`):

```
[ 135.7s] USER 1. AUDILEIDE DE JESUS NASCIMENTO 32505
[ 140.2s] BOT  Ah, o valor mínimo de fechamento do pedido é de R$ 400,00. …
[ 141.2s] BOT  ℹ️ Aviso: Para pagamentos realizados via PIX ou Cartão de Crédito …
[ 141.7s] BOT  Clique no link para acessar o catálogo: https://leva.la/oddqp7
[ 161.8s] FAIL esperado: mensagem de pendências financeiras
```

**Causa:** a situação financeira da conta `1. AUDILEIDE DE JESUS NASCIMENTO 32505` foi regularizada no Salesforce QAS, provavelmente por rotina financeira ou ação manual do time. A conta deixou de ser válida como massa para o teste "conta com pendências financeiras".

**Ação sugerida:** o time financeiro precisa reservar uma conta QAS fixa no estado "em atraso" para esse cenário continuar executável.

## 4. Nota sobre a indisponibilidade do Blip QAS (15/10 14h08–16/10 09h26)

Durante aproximadamente 19 h, a plataforma Blip QAS devolveu o seguinte erro em toda tentativa de processar mensagem:

```
notification { event: failed,
                reason: { code: 101,
                          description: "Not enough replicas available for
                                         query at consistency LocalQuorum
                                         (0 required but only 0 alive)" } }
```

É um erro da camada de persistência do Blip (Apache Cassandra) quando o cluster não tem nenhuma réplica viva. O chatbot inteiro ficou sem conseguir processar mensagens durante a janela, independentemente do flow ou do teste.

**Confirmação de recuperação:** reexecução das 09h26 do dia 16/10 passou nos 7 cenários afetados com durações típicas (30–295 s), sem nenhum erro de infra.

**Impacto para a suíte:** nenhum ajuste no bot nem nos testes foi necessário. A suíte identificou corretamente a origem do erro (notificação `event: failed` do canal) e os cenários voltaram a passar assim que a plataforma normalizou.

## 5. Achados confirmados na execução

Os defeitos abaixo foram observados nas evidências do período:

- **F1 — Nome do cliente vazio.** Em todos os contatos novos criados nesta execução, a mensagem "Certo, . Vou armazenar essa informação aqui. ☺️" apareceu com o nome em branco. Causa: `{{infosUserSalesForce@FirstName}}` só é populado no caminho de autenticação por CNPJ.
- **F5 — `smartsalesOrder` injetado nos extras não é aceito.** CT-01: mesmo gravando `contact.extras.smartsalesOrder` e `contact.extras.currentCart` conforme a instrução recebida, o `[API] Sincroniza carrinho` devolve "Ocorreu um erro — Não conseguimos preparar o seu carrinho agora.".
- **F6 — "Repetir pedido" leva para o início de Ofertas.** CT-49: a opção redireciona para o Redirect do Início (`@redirect`) em vez do Redirect do carrinho (`@redirect_cart`). O cliente refaz busca de contas, elegibilidade e valor mínimo em vez de reaproveitar o carrinho anterior.
- **F7 — Tag `<b>` crua em mensagem de persistente.** CT-50: a mensagem "Infelizmente, não entendi sua resposta. Por favor, <b>selecione</b> uma das opções do menu." sai com a tag crua no canal tunnel.
- **F8 — Massa "pendências financeiras" (CT-10) perdeu validade.** Já descrito na seção 3.

## 6. Como reproduzir esta execução

```bash
npm install
bbuilder test --purge                                   # roda todos os testes
bbuilder test -t "CT-46|CT-47|CT-48|CT-49|CT-50|CT-51|CT-52"   # só os reexecutados
```

As evidências desta execução estão em `docs/evidencias/`. Cada arquivo `CT-XX.log` contém a transcrição completa (mensagens do usuário, respostas do bot, opções recebidas, erros do canal).

## 7. Próximos passos

1. **CT-10:** aguardar o time financeiro indicar uma conta QAS fixa no estado "em atraso" para destravar o único teste com falha de assertion.
2. Priorizar as correções dos achados F1, F5, F6 e F7 no backlog do bot.
3. Com os 7 cenários revalidados, a suíte está pronta para ser incorporada a um pipeline de regressão por entrega. Recomendação: rodar `bbuilder test --purge` a cada deploy em QAS antes da promoção.
