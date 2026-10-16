---
name: blip-plugins
description: Use when a flow needs a White Wall plugin — Google Sheets, ChatGPT, Gemini, FAQ GPT, RD Station, Active Campaign, Bitrix, Dynamics, Exact Spotter, Tray, OpenAI text-to-speech, Smart Sales — or when reading a state whose id starts with "ww:". Covers the shape of a plugin call, how it authenticates, and the catalog of endpoints.
---

# White Wall plugins

A plugin is an integration installed from the Blip Store. In a flow it is **not** a special
action type: it is an ordinary state whose actions call the plugin's HTTP endpoint. The
Builder extension writes those actions for you; here you write them yourself.

A plugin state is a normal state with two conventions:

- Its id is `ww:` followed by a UUID, which is how the Builder extension recognises it.
- The plugin's actions live in `$leavingCustomActions`, so they run after any message the
  state sends and before the outputs are evaluated.

## The shape of every plugin call

Six steps, in this order, all in `$leavingCustomActions`:

1. **Clear the result variable** — `SetVariable` with `value: ""`. A failed or timed-out call
   writes nothing, so without this you read the previous call's answer as if it were this one's.
2. **Set the inputs** — one `SetVariable` per parameter the endpoint takes, prefixed `ww`. The
   names follow the plugin, not the parameter (`spreadsheetId` becomes `wwspreadsheet`, `email`
   becomes `wwrdemail`), so take them from the catalog rather than deriving them. This is where
   `{{...}}` interpolation happens, which is why the parameters are variables at all.
3. **Shape anything structured** — an `ExecuteScript` when the endpoint wants an array or an
   object. Google Sheets joins its column values with `#separator#` and splits them in a script;
   the other plugins take JSON straight from a variable.
4. **Read the public key** — `ProcessCommand get /buckets/ww<pluginId>pk` into
   `wwBucketResponse`. Installing the plugin is what puts the key there.
5. **Call the endpoint** — `ProcessHttp` with `continueOnError: true`, storing
   `wwResponseBody` and `wwResponseStatus`.
6. **Handle the outcome** — `SetVariable` writing the result on status `200`, and a
   `TrackEvent` in category `White Wall Error` otherwise.

Not every plugin uses all six — text-to-speech has no result to clear, the LLM ones add a
seventh step to unpack the answer text, and Smart Sales follows none of it. The catalog says so
per plugin.

Every call carries `botIdentifier` and `publicKey`; for all but Smart Sales, that pair *is* the
authentication.

```json
{
  "$title": "Save the answers",
  "$position": { "top": "300px", "left": "1200px" },
  "$enteringCustomActions": [],
  "$contentActions": [{ "input": { "bypass": true } }],
  "$leavingCustomActions": [
    { "type": "SetVariable", "settings": { "variable": "savedRow", "value": "" } },
    { "type": "SetVariable", "settings": { "variable": "wwspreadsheet", "value": "1f0YHFMoqcl_o6lXCpmtmcCT1HvkJzZuplZbYIVORYlA" } },
    { "type": "SetVariable", "settings": { "variable": "wwrange", "value": "A:C" } },
    { "type": "SetVariable", "settings": { "variable": "wwvalues", "value": "{{contact.name}}#separator#{{userEmail}}#separator#{{calendar.date}}" } },
    {
      "type": "ExecuteScript",
      "settings": {
        "function": "run",
        "source": "function run(wwvalues) {\n    return wwvalues.split('#separator#') \n}",
        "inputVariables": ["wwvalues"],
        "outputVariable": "wwsanitizedvalues"
      }
    },
    {
      "type": "ProcessCommand",
      "settings": {
        "from": "{{application.identity}}",
        "to": "postmaster@msging.net",
        "method": "get",
        "uri": "/buckets/wwgsheetspk",
        "variable": "wwBucketResponse"
      }
    },
    {
      "type": "ProcessHttp",
      "settings": {
        "method": "POST",
        "uri": "https://southamerica-east1-ww-blip-plugins.cloudfunctions.net/gsheets_append",
        "headers": {},
        "body": "{\"spreadsheetId\":\"{{wwspreadsheet}}\",\"range\":\"{{wwrange}}\",\"values\":{{wwsanitizedvalues}},\"publicKey\":\"{{wwBucketResponse@resource}}\",\"botIdentifier\":\"{{application.identifier}}\"}",
        "responseBodyVariable": "wwResponseBody",
        "responseStatusVariable": "wwResponseStatus"
      },
      "continueOnError": true
    },
    {
      "type": "SetVariable",
      "settings": { "variable": "savedRow", "value": "{{wwResponseBody@cells}}" },
      "conditions": [
        { "source": "context", "variable": "wwResponseStatus", "comparison": "equals", "values": ["200"] }
      ]
    },
    {
      "type": "TrackEvent",
      "settings": { "category": "White Wall Error", "action": "{{wwResponseStatus}}", "extras": {} },
      "conditions": [
        { "source": "context", "variable": "wwResponseStatus", "comparison": "notEquals", "values": ["200"] },
        { "source": "context", "variable": "wwResponseStatus", "comparison": "exists", "values": [] }
      ]
    }
  ],
  "$conditionOutputs": [],
  "$defaultOutput": { "stateId": "confirm" }
}
```

Note `{"values":{{wwsanitizedvalues}}}` — unquoted on purpose, because the script's return
value is already JSON. Every other parameter stays quoted.

## Rules

- **Branch on `wwResponseStatus` in the next state.** The plugin state itself only records the
  result; a plugin that fails must lead to a message, not to a dead end.
- **Never inline a public key.** It lives in the bucket, put there by the installation. If
  `{{wwBucketResponse@resource}}` is empty, the plugin is not installed on this bot — say so
  instead of working around it.
- **Keep the `ww` prefix** on the plugin's own variables. It marks them as belonging to the
  block and keeps them out of the way of the flow's own names.
- **Reuse the response variables** (`wwResponseBody`, `wwResponseStatus`) and copy what you
  need into your own variable in the same state. They are overwritten by the next plugin call.
- The public key can also be read as `{{bucket.ww<pluginId>pk}}`, which is shorter. The
  `ProcessCommand` form is what the Builder extension writes, so prefer it when you are
  editing a state the extension also touches.

## Editing in the Builder afterwards

The Builder extension keeps its own configuration for a plugin state in
`$whiteWallIntegration` — which integration, and the values it was configured with.

If the state you are looking at has that field, keep it in step with the actions: it is what
the extension's panel shows, and re-picking the integration there **replaces** the state's
leaving actions with freshly generated ones.

If it does not, this project is on a `bbuilder` whose format drops the field. A hand-written
plugin state still runs correctly — the runtime only reads the actions — but it opens with an
empty panel in the extension, so maintain it here rather than there.

## Catalog

Endpoints, parameters and response fields for all thirteen plugins:
`references/catalog.md`.
