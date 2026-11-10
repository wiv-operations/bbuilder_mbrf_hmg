---
name: blip-subflows
description: Use para baixar, editar, salvar o rascunho e publicar subflows do Blip Builder (blocos "subflow:<guid>" com shortNameOfSubflow dentro de um flow), um ou vários ao mesmo tempo, sem publicar o flow pai. Use também sempre que for baixar o bot. O download é "npm run pull" (flows + subflows num comando só), nunca "bbuilder pull" sozinho. Cobre diff contra o que está no ar, desfazer a última publicação e o protocolo bruto (curl) dos comandos /subflows.
---

# Subflows do Blip Builder

> **Antes de qualquer coisa, confira se a instalação está completa.** Se o `CLAUDE.md` da raiz
> deste repo **não** contém o marcador `<!-- blip-subflows:start -->`, ou se o `package.json` não
> tem os scripts `pull`, `pull:subflows` e um `postinstall` com `patch-blip-sdk.mjs` e
> `patch-bbuilder.mjs`, alguém copiou só a pasta da skill. Complete a instalação (não tem rede,
> não publica nada) e avise o usuário do que mudou:
>
> ```bash
> node .claude/skills/blip-subflows/scripts/install.mjs --dry-run   # mostra o que faria
> node .claude/skills/blip-subflows/scripts/install.mjs             # aplica (idempotente)
> ```

Um subflow é um fluxo próprio, dono do bot pai, chamado por um bloco do pai:

```json
"subflow:b7e3fdca-...": { "shortNameOfSubflow": "menuposvendas9", "$title": "Menu - pos vendas", ... }
```

- O `bbuilder` **não enxerga subflows**: `pull`/`push`/`publish` só tratam `flows/<bot>/`.
  Esta skill cobre essa lacuna.
- Publicar um subflow **não publica o pai**, e vale na hora para todo mundo que entra no
  bloco, porque o pai chama o subflow pelo shortName.
- No portal a URL é `.../application/detail/subflow-<shortName>-<pai>/templates/builder/`.
  Esse texto é só a rota do portal. Na API, o identificador é o `shortName`.

## Baixar o bot: um comando só (`npm run pull`)

```bash
npm run pull
```

Esse comando faz duas coisas, nesta ordem:

1. **`bbuilder pull`** baixa os flows para `flows/<bot>/` (e `backup/`).
2. **`subflows.mjs pull --all`** lê os `flows/*/flow.json` recém-baixados (e o rascunho de cada
   bot no Blip), encontra todo bloco com `shortNameOfSubflow` e baixa cada subflow para
   `subflows/<pai>/<shortName>/`.

Detalhes que importam:

- **A pasta `subflows/` é criada pelo próprio comando.** Não crie à mão. Num repo recém-clonado,
  sem `flows/` nem `subflows/`, `npm run pull` cria e preenche as duas.
- **O passo 2 só roda se o passo 1 der certo** (`&&`). Ele depende dos flows atualizados para
  saber quais subflows existem.
- **Edição local não enviada não é sobrescrita.** Se o `subflows/<pai>/<sub>/flow.json` foi
  editado e ainda não passou por `push`/`publish`, aquele subflow é pulado com o aviso `⏭️ skipped`
  e os outros são baixados normalmente. Para descartar a edição local, use
  `node $S pull <sub> --force`.
- **`bbuilder pull` sozinho NÃO baixa subflows**, e não avisa que deixou a pasta `subflows/`
  desatualizada. Use sempre `npm run pull`.
- `npm run pull:subflows` atualiza só os subflows, sem baixar os flows de novo.

Saída esperada:

```
Successfully pulled 13 flows
> pull:subflows
⬇️  devcaptacao26/menuposvendas9: 16 states
⬇️  devfinanceiro3/maisde1nfs2: 16 states
...
```

## Publicar flows principais que têm bloco de subflow (patch do SDK)

O `@whitewall/blip-sdk` 0.0.193, que o `bbuilder publish` e o `bbuilder rollback` usam, compila o
documento de runtime de um jeito simplificado. Ele **remove o `shortNameOfSubflow`** dos blocos
de subflow, e o Blip **recusa** a publicação com:

```
The provided value for configuration 'Application' is invalid: The application validation failed:
The given key 'shortNameOfSubflow' was not present in the dictionary.
```

Ele também removeria o `TrackContactsJourney`, o `TrackEvent` automático (`builder:stateTrack`)
e os metadados `#stateId`/`#stateName` das mensagens. Mesmo falhando, o `bbuilder publish` já
deixa uma entrada falsa no histórico de publicações ("bbuilder ← live").

A correção é `scripts/patch-blip-sdk.mjs`. Ele troca a compilação do SDK pelo compilador do
portal (`scripts/portal-compiler.mjs`, o mesmo usado nos subflows). O patch:

- roda sozinho em todo `npm install`, pelo `"postinstall"` do `package.json`;
- é idempotente;
- dá para conferir com `node .claude/skills/blip-subflows/scripts/patch-blip-sdk.mjs --check`
  (sai com código ≠ 0 se não estiver aplicado);
- falha de forma explícita se uma versão nova do SDK mudar o código que ele substitui. Nesse caso,
  não publique flows com subflow pelo bbuilder até atualizar o patch.

**Antes de `bbuilder publish`, confira que o patch está aplicado** (`--check`). Sem ele, todo flow
com bloco `subflow:` é recusado pelo Blip.

## `bbuilder push` / `bbuilder publish` só dos flows escolhidos (patch do bbuilder)

O bbuilder 0.0.13 original publica **todos** os flows de `flows/` a cada `bbuilder publish`.
O `scripts/patch-bbuilder.mjs`, também aplicado no `postinstall`, muda o `push` e o `publish`
para agirem só nos flows passados no comando:

```bash
bbuilder publish devsituacoesnaentrega               # um flow
bbuilder publish devorcamento devmenuajuda1          # vários
bbuilder publish --all                               # todos (antigo comportamento, agora explícito)
bbuilder publish                                     # RECUSADO: diga quais flows, ou --all
bbuilder push devsituacoesnaentrega                  # o mesmo vale para o push (rascunho)
```

- Os identificadores são os nomes das pastas em `flows/`. Um nome inexistente é recusado, com
  a lista dos disponíveis.
- A validação roda só nos flows escolhidos. O `--force` continua existindo para isso.
- A saída diz o que vai ser feito, por exemplo `Publishing 1 of 13 flow(s): devsituacoesnaentrega`.
- `bbuilder test --publish` continua publicando todos (passa `--all`).
- Confira o patch com `node .claude/skills/blip-subflows/scripts/patch-bbuilder.mjs --check`.
  Se uma versão nova do bbuilder mudar o código, o patch falha de forma explícita e o `publish`
  volta a publicar tudo. Nesse caso, não rode `bbuilder publish` sem antes conferir.

## Layout no projeto

```
subflows/<pai>/<shortName>/
  flow.json            rascunho (edited-flow), no modelo do canvas. EDITE ESTE.
  configuration.json   configurações do subflow (edited-configurations). Editável.
  flow-published.json  o que está no ar (flow-published). Só leitura, atualizado pelo script.
  subflow.json         metadados (nome, subflowId, dono). Só leitura.
  .sync.json           hashes do que o Blip tinha no último pull/push/publish (detecta edição no canvas).
  .previous/           documentos remotos de antes do último push/publish (usado pelo undo).
```

`<pai>` é o nome da pasta em `flows/`. Tudo isso é criado pelo `npm run pull`.

## Instalar em outro repo bbuilder

A instalação tem **quatro partes**, e a pasta da skill sozinha é só a primeira. Sem as outras, o
`npm run pull` não baixa subflows, os patches não são aplicados e os agentes do repo não sabem
das regras, porque o `CLAUDE.md` não tem a seção.

| Parte | Onde |
| --- | --- |
| A skill | `.claude/skills/blip-subflows/` (esta pasta inteira) |
| Scripts npm | `package.json`: `pull`, `pull:subflows` e `postinstall` (patches do SDK e do bbuilder) |
| Git | `.gitignore`: `subflows/**/.previous/` |
| Instruções para agentes | `CLAUDE.md`: seção `references/claude-md-section.md` entre `<!-- blip-subflows:start -->` e `<!-- blip-subflows:end -->`, mais a linha `blip-subflows` na tabela de skills |

O instalador faz as quatro, é idempotente e também aplica os patches na hora:

```bash
# a partir do pacote blip-subflows-skill.zip:
node install.mjs <caminho-do-projeto> --dry-run
node install.mjs <caminho-do-projeto>

# ou, se só a pasta da skill foi copiada para o repo (rode da raiz do projeto):
node .claude/skills/blip-subflows/scripts/install.mjs --dry-run
node .claude/skills/blip-subflows/scripts/install.mjs
```

Ele **não sobrescreve** um script `pull` que já exista e seja diferente. Ele avisa, e você combina
os dois à mão. Um `postinstall` existente é mantido e os patches são encadeados com `&&`. Ele
também lista linhas do `CLAUDE.md` que ainda rodam `bbuilder pull` sozinho, para trocar por
`npm run pull`.

Depois: `npm install` (se ainda não rodou), `npm run pull` e confira que `subflows/` foi criada.

## Pré-requisitos

1. É um projeto bbuilder: tem `bbuilder.json` (tenant + router) e `npm install` já foi rodado.
2. `bbuilder login` já foi feito. O script reaproveita esse login, que usa a chave do portal.
3. Node 22+.

Script: `.claude/skills/blip-subflows/scripts/subflows.mjs`. Rode sempre **da raiz do projeto**.

```bash
S=".claude/skills/blip-subflows/scripts/subflows.mjs"
```

## O ciclo

Faça nesta ordem, sempre:

```bash
npm run pull                                  # flows + todos os subflows (ou: node $S pull <alvos>)
node $S list                                  # quais subflows existem (pai/shortName e bloco que chama)
# ...edite subflows/<pai>/<sub>/flow.json...
node $S check <alvos>                         # offline: valida + compara o compilado com o publicado
node $S diff <alvos>                          # o que mudou no rascunho e o que a publicação mudaria
node $S push <alvos>                          # salva só o rascunho (canvas). NÃO vai ao ar
node $S publish <alvos> --yes                 # rascunho + publicação. VAI AO AR
node $S undo <alvos> --yes                    # volta rascunho e publicação ao estado anterior
```

Formas de indicar alvos (dá para misturar e passar vários; eles rodam em paralelo):
`<pai>/<shortName>`, `<shortName>`, `<pai>` (todos os subflows dele) ou `--all`.
Se um alvo falha, os outros continuam, e o comando sai com código diferente de zero.

Exemplo, renomear um bloco em dois subflows e publicar os dois:

```bash
node $S pull menuposvendas9 menuqualnf2
# editar "$title" do estado desejado em cada subflows/<pai>/<sub>/flow.json
node $S diff menuposvendas9 menuqualnf2       # deve mostrar só: ~ <estado> "Novo" (was "Antigo")
node $S publish menuposvendas9 menuqualnf2 --yes
node $S diff menuposvendas9 menuqualnf2       # depois: "identical" / "nothing"
```

## Regras inegociáveis

- **`publish` é ao vivo.** Avise antes de rodar, a não ser que o pedido já implique isso. Ele
  exige `--yes`. O `push` só mexe no rascunho.
- **Feche o canvas do subflow antes de mexer pela API.** Um canvas aberto guarda o rascunho
  antigo e pode salvá-lo por cima da sua mudança. Isso já aconteceu neste projeto. O
  `push`/`publish` recusa rodar se o rascunho remoto mudou desde o último `pull`, comparando
  com `.sync.json`. Nesse caso rode `diff`, depois `pull` para pegar a mudança da outra pessoa.
  Use `--force` só se a intenção for sobrescrever.
- **Edite só `flow.json` e `configuration.json`.** O `flow-published.json` é gerado: o
  `publish` compila o rascunho local, e nunca usa esse arquivo como entrada.
- **Os estados ficam no modelo do canvas, não minificado.** Ações em `$enteringCustomActions`,
  `$contentActions` (mensagens + o `input`), `$leavingCustomActions`, `$conditionOutputs` e
  `$defaultOutput`. Para a semântica de estados, ações e condições, carregue a skill `blip-flows`.
- **Regras do subflow (validadas pelo portal e por este script):** condições de saída só com
  `source` `input` ou `context`. Sem `ProcessContentAssistant`. `Redirect` só no estado `end`.
  Toda saída precisa apontar para um estado que existe.
- **Depois de publicar, confira.** O script relê o rascunho e o publicado e compara com o que
  enviou. Um `diff` final deve mostrar `identical` / `nothing`.

## Como a publicação funciona (resumo)

Todos os comandos saem **do bot pai** (com a chave dele) para `postmaster@builder.msging.net`:

| Passo | Comando | `resource.name` | `resource.key` |
| --- | --- | --- | --- |
| Ler metadados | `get /subflows/<sn>` | | |
| Ler rascunho | `get /subflows/<sn>/configurations/edited-flow` | | |
| Ler configurações | `get /subflows/<sn>/configurations/edited-configurations` | | |
| Ler publicado | `get /subflows/<sn>/configurations/flow-published` | | |
| Salvar rascunho | `set /subflows/<sn>/publish` | `edited-flow` | `""` |
| Salvar configurações | `set /subflows/<sn>/publish` | `edited-configurations` | `""` |
| **Publicar** | `set /subflows/<sn>/publish` | `flow-published` | identidade de hosting |

O `document` vai sempre como **string JSON**. O documento publicado é o rascunho compilado
para o formato do runtime. O script porta o compilador do próprio portal (`publishSubFlow`).
Regras, protocolo completo e receitas de `curl`: [references/protocol.md](references/protocol.md).

## Problemas comuns

| Sintoma | Causa / o que fazer |
| --- | --- |
| `the Blip draft changed since the last pull` | Alguém salvou no canvas. `diff`, depois `pull`, reaplique sua edição. |
| `check` mostra diferenças logo após o `pull` | O rascunho tem mudanças não publicadas (normal). Se o rascunho e o publicado deveriam ser iguais, o compilador divergiu do portal: **não publique**, compare as diferenças. |
| `could not discover the hosting identity` | Passe `--hosting <cluster>.builder.hosting@msging.net` (veja o `diff`, ou o HAR do portal). |
| `subflow "<sn>" has no draft in <pai>` | O shortName não pertence a esse pai. Rode `list`. |
| A mudança some do canvas depois de publicar | O canvas estava aberto e salvou por cima. Feche-o, rode `pull` + `diff`, e publique de novo. |
