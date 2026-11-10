# Subflows do Blip Builder no fluxo bbuilder: skill `blip-subflows`

**Para:** Tech Lead · **Projeto de origem:** Zeus (router `roteadorzeus`, tenant `infinita`) · **Data:** 2026-10-20

## Resumo

O `bbuilder` 0.0.13 só trata os flows dos bots (`flows/<bot>/`). Ele **não enxerga os subflows do
Builder**, os blocos `subflow:<guid>` com `shortNameOfSubflow`. Isso tem três efeitos:
- quem baixa o bot pelo `bbuilder` não tem os subflows;
- não consegue alterar subflows pelo repositório;
- não consegue publicar um subflow sem passar pelo canvas.

A skill `blip-subflows` cobre essa lacuna:

- **`npm run pull`**: um comando só que baixa os flows (`bbuilder pull`) e depois todos os
  subflows para `subflows/<pai>/<shortName>/`.
- **Script `subflows.mjs`**: `list`, `pull`, `check`, `diff`, `push` (rascunho), `publish` (ao
  vivo) e `undo`, para um ou vários subflows em paralelo, **sem publicar o flow pai**.
- **Documentação para agentes**: `SKILL.md`, protocolo com `curl` e uma seção no `CLAUDE.md`,
  para que um agente faça isso com segurança e de forma reproduzível.

Validado ponta a ponta contra o Blip real no projeto Zeus (seção "Validação").

## O que descobrimos

1. **Um subflow é um documento separado, dono do bot pai.** Ele é acessado com a chave do pai
   via comandos LIME para `postmaster@builder.msging.net`:

   | Ação | Comando | `resource` |
   | --- | --- | --- |
   | ler rascunho / config / publicado | `get /subflows/<sn>/configurations/{edited-flow, edited-configurations, flow-published}` | |
   | salvar rascunho | `set /subflows/<sn>/publish` | `{name:"edited-flow", document:"<json>", key:""}` |
   | salvar configurações | `set /subflows/<sn>/publish` | `{name:"edited-configurations", ...}` |
   | **publicar** | `set /subflows/<sn>/publish` | `{name:"flow-published", document:"<json compilado>", key:"enterprise.builder.hosting@msging.net"}` |

   A URL do portal (`subflow-menuposvendas9-devcaptacao26`) é só a rota da interface. Na API, o
   identificador é o `shortName` (`menuposvendas9`).
2. **Publicar um subflow não publica o pai**, e vale imediatamente para quem entra no bloco.
   Conferimos isso pelo histórico de publicações do pai, que não mudou.
3. **O documento publicado não é o rascunho.** O portal compila o rascunho do canvas para o
   formato do runtime no navegador:
   - reorganiza ações de entrada/conteúdo/saída;
   - injeta `TrackContactsJourney`;
   - injeta metadados `#stateId`/`#stateName` nas mensagens;
   - remove chaves `$...`.

   Extraímos esse compilador do `portal.js` (função `publishSubFlow` e dependências) a partir de
   um HAR de uma publicação real, e portamos para o script.
4. **Risco de concorrência real:** um canvas aberto no navegador salvou o rascunho antigo por cima
   de uma alteração feita pela API. Isso aconteceu durante os testes. A skill detecta essa situação
   (abaixo), mas não tem como impedir.
5. **O `bbuilder publish` não consegue publicar flows com bloco de subflow.** O SDK
   (`@whitewall/blip-sdk` 0.0.193) compila o documento de runtime sem o `shortNameOfSubflow`, e o
   Blip recusa:
   `The given key 'shortNameOfSubflow' was not present in the dictionary`.
   Reproduzimos isso publicando o `devsituacoesnaentrega`. O conteúdo no ar não muda, mas o
   histórico de publicações ganha uma entrada falsa ("bbuilder ← live"). Isso explica as
   publicações "bbuilder" de 19/10 nos 5 bots com subflow do Zeus. O SDK também removeria o
   tracking que o portal injeta (`TrackContactsJourney`, `TrackEvent` de `builder:stateTrack`,
   metadados `#stateId`/`#stateName`).

   **Correção:** `scripts/patch-blip-sdk.mjs`, aplicado no `postinstall`, troca a compilação do
   SDK pelo mesmo compilador do portal usado nos subflows (`scripts/portal-compiler.mjs`).
   Depois do patch, a mesma publicação passou, e o documento no ar ficou idêntico ao anterior,
   exceto pelos ids aleatórios de 7 mensagens de "digitando" (`chatstate`), que o bbuilder
   regenera a cada leitura. O subflow (`menusituacoes1`) e o tracking (20 `TrackContactsJourney`,
   59 metadados) foram preservados.
6. **O `bbuilder publish` publicava todos os flows do router de uma vez.** Não havia como
   publicar um flow só. **Correção:** `scripts/patch-bbuilder.mjs` (também no `postinstall`):
   - `bbuilder publish <id> [id...]` / `bbuilder push <id> [id...]` agem só nos flows passados;
   - `--all` publica todos;
   - o comando sem argumento é recusado;
   - a validação roda só nos flows escolhidos;
   - `bbuilder test --publish` mantém o comportamento antigo (`--all`).

   Teste: `bbuilder publish devsituacoesnaentrega` publicou só esse flow ("Publishing 1 of 13").
   O histórico de publicações e o documento no ar dos outros 12 ficaram idênticos.

## Como a solução funciona

```
npm run pull
 ├─ bbuilder pull                     → flows/<bot>/, backup/
 └─ subflows.mjs pull --all           → descobre shortNameOfSubflow em flows/*/flow.json (+ rascunho remoto)
                                        → subflows/<pai>/<sn>/{flow.json, configuration.json,
                                          flow-published.json, subflow.json, .sync.json}

subflows.mjs publish <alvos> --yes
 1. valida (schema do SDK + regras de subflow do portal)
 2. recusa se o rascunho remoto mudou desde o último pull (hash em .sync.json) → edição no canvas
 3. salva o estado remoto atual em .previous/ (para undo)
 4. salva rascunho + configurações (o canvas passa a mostrar o que vai ao ar)
 5. compila o rascunho (porte do portal) e publica com a identidade de hosting do pai
 6. relê rascunho e publicado e compara com o enviado; falha se divergir
```

- **Autenticação:** usa o login existente do `bbuilder` (e-mail do portal + chave). As chaves dos
  bots pai são obtidas em memória (`portal.getApplication`), como o próprio `bbuilder publish`
  faz. **Nenhuma chave é gravada em disco.**
- **Segurança operacional:**
  - `publish`/`undo` exigem `--yes`;
  - o `pull` não sobrescreve um subflow com edição local não enviada;
  - vários alvos rodam em paralelo, a falha de um não interrompe os outros, e o comando sai com
    código diferente de zero.
- **Guarda contra mudança no Blip:** o `check` compila cada rascunho e compara com o publicado. Se
  o Blip mudar o compilador, ele aparece como diferença. A regra documentada é não publicar
  enquanto o `check` não der ✅.

## Validação realizada (projeto Zeus)

| Teste | Resultado |
| --- | --- |
| Fidelidade do compilador nos 10 subflows do projeto | 9 idênticos ao publicado pelo portal. O 10º diferia só pelo rename de teste então no ar, e ficou idêntico após republicar |
| Republicar o conteúdo publicado atual (sem mudança) | `success`, conteúdo relido idêntico |
| Renomear um bloco em **2 subflows** de pais diferentes e publicar juntos | `diff` mostrou só o rename. Publicação ok. Pós-`diff` "identical / nothing". Pais intactos |
| `undo` dos 2 | rascunho e publicado voltaram ao original |
| `push` sem publicar | rascunho atualizado, publicado inalterado |
| Edição concorrente (canvas) simulada | `push` recusado com a mensagem correta |
| Edição local não enviada + `npm run pull` | aquele subflow foi pulado com aviso, os outros 9 baixados |
| Validação | erros reais detectados (condição `intent`, saída para estado inexistente). Subflows válidos sem falso positivo |
| `npm run pull` em repo vazio (sem `flows/` nem `subflows/`) | criou e preencheu os dois: 13 flows, 10 subflows |
| Receita `curl` (GET com chave do bot pai) | `success` |
| `bbuilder publish` (só `devsituacoesnaentrega`) **sem** patch | recusado pelo Blip (`shortNameOfSubflow`). Conteúdo no ar intacto. Entrada falsa no histórico |
| `bbuilder publish` (só `devsituacoesnaentrega`) **com** patch | publicado. Documento no ar igual ao anterior, exceto 7 ids de mensagem `chatstate`. Subflow e tracking preservados |
| Patch: idempotência e persistência | estável em execuções repetidas. Reaplicado automaticamente após apagar e reinstalar o SDK (`npm install`) |
| `bbuilder publish` sem argumento / flow inexistente / ids + `--all` | recusados antes de qualquer chamada ao Blip |
| `bbuilder push devsituacoesnaentrega devfinanceiro3` | "Pushing 2 of 13". Só esses 2 escritos |
| `bbuilder publish devsituacoesnaentrega` | "Publishing 1 of 13". Só ele publicado (nº 6). Os outros 12 com histórico e documento no ar idênticos |
| Reinstalar `bbuilder` e SDK do zero (`npm install`) | `postinstall` reaplicou os dois patches. `--check` = 0. `npm run type-check` ok |
| Compilador do portal vs flows principais no ar | `devcaptacao26` (último publicado pelo portal) idêntico. `devsituacoesnaentrega`, `devfinanceiro3` e `hmlfluxomensagensativas` só diferem em ids de `chatstate`. Os 8 flows sem subflow estão no ar **sem** tracking, porque foram publicados pelo bbuilder sem patch em 19/10, e por isso diferem. `devtirarduvidas` tem 12 diferenças **não analisadas uma a uma** |

**Estado final no Blip:** os 10 subflows estão com rascunho = publicado e nomes originais, e nenhum
flow pai foi publicado.

## Riscos e limitações

- **API não oficial no detalhe.** O comando `/subflows/<sn>/publish` aparece na documentação do
  Blip (*Change Builder flow of subflow*), mas a compilação para `flow-published` não aparece.
  Ela vem do JS minificado do portal e **pode mudar sem aviso**. Mitigação: o `check` obrigatório.
- **Depende de internals do bbuilder e de patches em `node_modules`.** O script importa
  `node_modules/bbuilder/dist/{config,blip,validator}.js` e o SDK `@whitewall/blip-sdk`. Os patches
  reescrevem `publishBuilderFlow` (SDK) e os comandos `push`/`publish` (bbuilder). Foi validado com
  bbuilder **0.0.13** / SDK **0.0.193**. Se uma versão nova mudar o código, os patches falham de forma
  explícita (`--check` ≠ 0). **Atenção:** sem o patch do bbuilder, `bbuilder publish` volta a publicar
  todos os flows. Ao atualizar, rode os dois `--check` e `check --all` antes de publicar.
- **Publicar pelo bbuilder com o patch passa a ligar o tracking do portal.** Flows publicados antes
  pelo bbuilder sem tracking, como `devexcecao10` e `zeusatendimentohumano`, voltam a ter
  `TrackContactsJourney` e o `TrackEvent` automático na próxima publicação. É o comportamento do
  portal, mas muda os eventos que aparecem no analytics desses bots.
- **`builder:stateTrack: "true"`:** a regra de compilação para esse caso foi portada do portal,
  mas **não pôde ser testada**, porque nenhum subflow do Zeus usa. Recomendamos um `check` no
  primeiro subflow que usar.
- **Canvas aberto sobrescreve.** A skill detecta isso no push/publish seguinte, mas não impede.
  O processo precisa incluir "fechar o canvas do subflow antes de usar a API". O lock que o portal
  usa (`/locks/subflow/...`) não foi implementado.
- **Só um nível de undo** (`.previous/`, local, fora do git). O Blip não expõe histórico de
  publicações de subflow como faz com bots (não verificado a fundo).
- **Descoberta por referência.** Só são encontrados subflows referenciados por algum bloco. Um
  subflow criado e não usado não aparece.
- **`bbuilder pull` direto continua existindo** e não baixa subflows. A mitigação é documental
  (`CLAUDE.md`, `SKILL.md`): o comando de download passa a ser `npm run pull`.
- **Segurança do HAR:** o HAR usado na investigação (`infinita.blip.ai.har`, no repo Zeus) contém
  tokens de sessão. **Não deve ser compartilhado nem commitado.** Ele não faz parte deste pacote.

## Próximos passos sugeridos

1. Levar o suporte a subflows e a correção do compilador para dentro do `bbuilder`/SDK (PR no
   `whitewall-dev/bbuilder` e no `@whitewall/blip-sdk`): `pull`/`push`/`publish` cobrindo
   `subflows/`, e `publishBuilderFlow` preservando `shortNameOfSubflow` e o tracking. Isso elimina o
   patch em `node_modules`, a dependência de internals e o risco do `bbuilder pull` sozinho.
2. Rodar `subflows.mjs check --all` no CI dos repos de bot, para detectar cedo uma mudança no
   compilador do Blip.
3. Implementar o lock do portal no `push`/`publish` para reduzir o risco de concorrência com o
   canvas.

## Pacote

`blip-subflows-skill.zip`:

| Arquivo | Para quê |
| --- | --- |
| `README.md` | por onde começar |
| `TECHLEAD.md` | este documento |
| `AGENT-INSTRUCTIONS.md` | passo a passo para o agente instalar, verificar e usar a skill |
| `install.mjs` | instalador idempotente (`node install.mjs <projeto> [--dry-run]`). Chama `skill/blip-subflows/scripts/install.mjs` |
| `skill/blip-subflows/` | a skill: `SKILL.md`, `references/protocol.md`, `references/claude-md-section.md` (seção inserida no `CLAUDE.md`), `scripts/install.mjs`, `scripts/subflows.mjs`, `scripts/portal-compiler.mjs`, `scripts/patch-blip-sdk.mjs`, `scripts/patch-bbuilder.mjs` |

A skill é autossuficiente. Se alguém copiar só a pasta `skill/blip-subflows/`, o `SKILL.md` detecta
que o `CLAUDE.md` não tem a seção, e o agente completa a instalação com o instalador que está
dentro da própria skill.
