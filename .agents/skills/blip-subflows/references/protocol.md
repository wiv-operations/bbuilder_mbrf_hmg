# Protocolo de subflows: comandos, compilação e curl

Tudo aqui foi conferido contra o portal do Blip (HAR de uma publicação real, `portal.js`) e
executado com sucesso neste projeto.

## Autenticação

Os comandos são do **bot pai**. Duas formas:

- **Pelo script / SDK:** o login do `bbuilder` (chave do portal) chama
  `client.as('<pai>').incorporate()`, que busca a access key do pai via
  `portal.getApplication`.
- **curl:** use a chave "Authorization" do bot pai (Portal → bot pai → Configurações →
  Informações de conexão). Ela já vem pronta como `Key <token>`, onde
  `token = base64("<pai>@msging.net:" + base64decode(accessKey))`.

```bash
TENANT="infinita"            # bbuilder.json → tenant
PARENT_KEY="Key xxxxxxxx"    # chave Authorization do bot PAI (não do roteador)
SN="menuposvendas9"          # shortNameOfSubflow
URL="https://$TENANT.http.msging.net/commands"
```

Nunca coloque a chave em arquivo versionado.

## Leitura (seguro)

```bash
# metadados
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: $PARENT_KEY" \
  -d '{"id":"'"$(uuidgen)"'","to":"postmaster@builder.msging.net","method":"get","uri":"/subflows/'"$SN"'"}'

# rascunho | configurações | publicado
for NAME in edited-flow edited-configurations flow-published; do
  curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: $PARENT_KEY" \
    -d '{"id":"'"$(uuidgen)"'","to":"postmaster@builder.msging.net","method":"get","uri":"/subflows/'"$SN"'/configurations/'"$NAME"'"}' \
    > "$NAME.response.json"
done
```

Resposta: `{"type":"application/vnd.iris.builder.subflows.configuration+json","resource":{"name":"edited-flow","document":"<JSON em string>"},"status":"success"}`.
Para tirar o documento: `jq -r '.resource.document | fromjson' edited-flow.response.json > flow.json`.
`resource not found` (código 67) em `flow-published` quer dizer que o subflow nunca foi publicado.

## Escrita

Os três `set` usam a mesma URI (`/subflows/<sn>/publish`) e `type: application/vnd.lime.document+json`.
O `resource.document` é o **JSON serializado em string**.

```bash
# salvar rascunho (não vai ao ar)
DOC=$(jq -c . flow.json | jq -Rs .)       # flow.json → string JSON escapada
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: $PARENT_KEY" -d @- <<EOF
{"id":"$(uuidgen)","to":"postmaster@builder.msging.net","method":"set",
 "type":"application/vnd.lime.document+json","uri":"/subflows/$SN/publish",
 "resource":{"name":"edited-flow","document":$DOC,"key":""}}
EOF

# salvar configurações: igual, com name "edited-configurations" e o configuration.json

# PUBLICAR (ao vivo): document = rascunho COMPILADO (seção abaixo), key = identidade de hosting
DOC=$(jq -c . compiled-flow-published.json | jq -Rs .)
curl -s -X POST "$URL" -H "Content-Type: application/json" -H "Authorization: $PARENT_KEY" -d @- <<EOF
{"id":"$(uuidgen)","to":"postmaster@builder.msging.net","method":"set",
 "type":"application/vnd.lime.document+json","uri":"/subflows/$SN/publish",
 "resource":{"name":"flow-published","document":$DOC,"key":"enterprise.builder.hosting@msging.net"}}
EOF
```

Para gerar o documento compilado sem publicar, rode `check` ou `diff`. Republicar exatamente o
`flow-published` atual também é válido e não muda nada; serve como teste do mecanismo.

O portal também trava a edição em volta da publicação (`set /locks/subflow/id/<sn>/node/<node>`).
Esse lock é opcional, e o script não usa.

### Identidade de hosting (`key` do flow-published)

É `<cluster>.<template>.hosting@msging.net` (template `builder`). O script descobre lendo as
configurações do bot pai: o `owner` da configuração `Application`. Neste tenant é
`enterprise.builder.hosting@msging.net`.

## Compilação: rascunho → flow-published

Porte fiel de `portal.js` (`publishSubFlow` → `TG.createModel(flow, configuration, flowId, 2)`
→ `iV.createModel` por estado → `setUpFlow` → `setStateActions` → `cleanKeysStartingWithDolar`).
O `check` confirmou que o resultado é idêntico ao publicado pelo portal nos 10 subflows deste projeto.

Documento: o próprio `flow-published` atual (`identifier`, `accessKey`, `settings`, `settingsType`),
com `settings.flow` trocado por:

```js
{ id: <flow.id atual, ou um uuid novo>, version: 2, states: [...], configuration: <edited-configurations>, type: "subflow" }
```

Por estado (`e` = estado do rascunho):

1. `id, root, end, name = e.$title, shortNameOfSubflow, deskStateVersion`.
2. `inputActions = $enteringCustomActions`. No `onboarding`, as `SetVariable` de entrada vão
   para o **fim** de `outputActions`.
3. `$contentActions`: tudo **antes** do item com `input` entra no fim de `inputActions`. O
   `input` vira `input`. Tudo **depois** vira o começo de `outputActions`. Sem `input`, tudo
   vai para `inputActions` e `input` fica indefinido.
4. `outputActions += $leavingCustomActions`.
5. `afterStateChangedActions = $afterStateChangedActions ?? []`. `localCustomActions` é mapeado
   como `{id:$id, title:$title, type, settings, conditions, order, continueOnError, description:$description}`.
6. `outputs = [...$conditionOutputs, $defaultOutput]`.
7. Metadados: toda `SendMessage`/`SendRawMessage`/`SendMessageFromHttp` recebe em
   `settings.metadata` (e toda `TrackEvent` em `settings.extras`):
   `#stateName={{state.name}}, #stateId={{state.id}}, #messageId={{input.message@id}}, #previousStateId={{state.previous.id}}, #previousStateName={{state.previous.name}}`.
8. Se `configuration["builder:stateTrack"] === "true"`: entra uma `TrackEvent` `{category:"flow", action:<name>, extras:{stateId, ...metadados}}`
   no começo de `inputActions` (no estado root, no começo de `outputActions`). **Não verificado
   em produção**: nenhum subflow deste projeto tem stateTrack ligado. Rode `check` depois do
   primeiro publish pelo portal.
9. Se a feature `track-contacts-journey` está ligada no tenant: entra
   `{type:"TrackContactsJourney", settings:{previousStateId, previousStateName, stateId, stateName}}`
   no começo de `inputActions`, com os valores `{{...}}`. No estado root ela vai no começo de
   `outputActions`, com `stateId`/`stateName` literais. O script detecta a feature pelo
   publicado atual; force com `--journey on|off`.
10. Remove toda chave que começa com `$`, recursivamente.

Se o Blip mudar o compilador, o `check` em um subflow recém-publicado pelo portal mostra a
diferença. Ajuste `compileState`/`setStateActions` no script até o `check` dar ✅ de novo,
antes de publicar qualquer coisa.
