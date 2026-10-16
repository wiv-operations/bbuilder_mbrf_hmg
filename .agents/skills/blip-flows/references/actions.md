# Actions

Every action has this envelope:

```json
{
  "$title": "Human label shown on the canvas",
  "type": "SetVariable",
  "settings": {},
  "conditions": [],
  "continueOnError": false
}
```

- `conditions` — the action runs only if **all** of them pass. See `conditions.md`.
- `continueOnError` — when true, a failing action does not abort the turn. Use it on any
  `ProcessHttp` whose failure you handle yourself by branching on the status variable.
- `$title` is optional; `bbuilder push` derives one when it is missing.

`SendMessage` and `SendRawMessage` live in `$contentActions`. Everything below them goes in
`$enteringCustomActions` (on arrival) or `$leavingCustomActions` (on the way out).

## SendMessage

```json
{
  "type": "SendMessage",
  "settings": {
    "type": "text/plain",
    "content": "Hello {{contact.name}}!",
    "metadata": {}
  }
}
```

`settings.type` is required and decides the shape of `content`:

| `settings.type` | `content` |
| --- | --- |
| `text/plain` | a string |
| `application/vnd.lime.select+json` | `{ text, scope?, options: [{ text }] }` |
| `application/vnd.lime.media-link+json` | `{ uri, type, title?, text? }` — `type` is the file's MIME type |
| `application/vnd.lime.web-link+json` | `{ uri, text, title?, target? }` |

A select is a menu:

```json
{
  "type": "SendMessage",
  "settings": {
    "type": "application/vnd.lime.select+json",
    "content": {
      "text": "What do you need?",
      "scope": "immediate",
      "options": [{ "text": "Track my order" }, { "text": "Talk to someone" }]
    }
  }
}
```

- `scope: "immediate"` renders as quick replies (WhatsApp buttons) and is what you almost
  always want. Omit it and the channel renders a numbered list the user answers by number.
- **The bot receives the option's `text`**, so the condition outputs of the capturing state
  must compare against exactly those strings. Nothing else identifies the choice.
- Channel limits apply to the labels — see the `blip-whatsapp` skill before writing them.

## SendRawMessage

Sends a document verbatim. `type` is the media type the raw content is deserialized as, and
it is required.

```json
{
  "type": "SendRawMessage",
  "settings": { "type": "application/vnd.lime.select+json", "rawContent": "{{menu}}" }
}
```

Two uses: a channel-native payload (`application/json`, see `blip-whatsapp`), or a document
built at runtime by an `ExecuteScript` — the standard way to render a dynamic menu, since
`options` cannot be interpolated from an array.

## SetVariable

```json
{ "type": "SetVariable", "settings": { "variable": "gptUses", "value": "0", "expiration": 3600 } }
```

Values are always strings; `expiration` is in seconds. Setting a variable to `""` is how you
clear it before a block that may not write it.

## ProcessHttp

```json
{
  "type": "ProcessHttp",
  "settings": {
    "method": "POST",
    "uri": "https://api.example.com/orders/{{orderId}}",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer {{config.apiKey}}" },
    "body": "{\"email\":\"{{userEmail}}\"}",
    "responseBodyVariable": "orderBody",
    "responseStatusVariable": "orderStatus"
  },
  "continueOnError": true
}
```

- **Always branch on `responseStatusVariable`.** It holds the HTTP status as a string; a
  non-2xx response is not an error the runtime raises for you.
- **Clear both response variables before the call**, with a `SetVariable` to `""`. On a
  timeout the runtime writes neither, and on an empty body it writes no body — so without
  clearing them you branch on the *previous* call's status and read the previous body. This is
  why every plugin block starts by resetting its result variable.
- **`continueOnError: true` on any call that can fail.** Without it a failure or a timeout
  aborts the turn: no message goes out, and the user is left with silence.
- **Sanitize free text before putting it in a JSON body.** Interpolation escapes for the
  settings, and a body is a string inside those settings, so a `"` or a newline typed by the
  user survives into the body and breaks it. Pass the value through an `ExecuteScript` that
  returns it JSON-encoded. A value that lands in a plain field — the `uri`, a header, a
  message — needs no such care.
- **To splice raw JSON, leave the quotes off**: `{"values":{{list}}}`, where `list` already
  holds JSON (a script's output variable does).
- The header lookup for `Content-Type` is case-sensitive and defaults to
  `application/json`; write it exactly like that or it is ignored.
- **The effective timeout is 30 seconds**, not the 60 the action asks for: every action runs
  inside a 30s budget, and the whole turn inside 60s. Two slow calls in one turn will not fit.
- `body`, `responseBodyVariable` and `responseStatusVariable` are required by the format, even
  for a `GET`. Leave `body` as `""`.
- Test the call with `curl` first. Always.

## ExecuteScript

```json
{
  "type": "ExecuteScript",
  "settings": {
    "function": "run",
    "source": "function run(order) {\n  order = JSON.parse(order)\n  return order.items.length\n}",
    "inputVariables": ["orderBody"],
    "outputVariable": "itemCount"
  }
}
```

- `inputVariables` map to the parameters **by position**, and arrive as strings — `JSON.parse`
  anything structured, and never trust the value: it can be `null` or `""`.
- Returning an object or array stores it as JSON; returning `null`/`undefined` **deletes**
  the output variable.
- Write ES5. The engine accepts more (`let` and `const` work), but nothing beyond ES5 is
  guaranteed. There is no `require`, no `fetch`, no timers, no `async`.
- Limits: 5s, **1000 statements**, 100MB, recursion depth 50. The statement cap is the one you
  hit first: a loop over a long list runs out of statements long before it runs out of time.
- This is the only way to work with arrays: `@property` cannot index into one.
- **Always call the function `run`.** The format requires it, and every script in every flow
  looking the same is worth more than a name that describes this one.
- Give it one parameter per entry in `inputVariables`, in the same order. Nothing enforces the
  count — extra arguments are ignored and missing ones arrive `undefined` — so a mismatch is a
  silently wrong result rather than an error.

## Choosing where an output goes

`ProcessCommand` talks to Blip's own API over Lime:

```json
{
  "type": "ProcessCommand",
  "settings": {
    "from": "{{application.identity}}",
    "to": "postmaster@msging.net",
    "method": "get",
    "uri": "/buckets/myKey",
    "variable": "bucketResponse"
  }
}
```

The response document lands in `variable`; read a bucket's value with
`{{bucketResponse@resource}}`. For a plain bucket read, `{{bucket.myKey}}` is shorter and
does the same thing.

## The rest

| Action | Settings | Notes |
| --- | --- | --- |
| `TrackEvent` | `category`, `action`, `extras` | Shows up in Blip's event reports. Category is the funnel, action the step. |
| `MergeContact` | `name`, `email`, `city`, `extras` | Writes to the contact, readable later as `{{contact.extras.key}}`. |
| `Redirect` | `address`, `context: { type: "text/plain", value }` | Hands the conversation to another subbot or Builder flow; `value` becomes its input. |
| `ForwardToDesk` | none | Sends the conversation to human attendance. |
| `LeavingFromDesk` | none | Runs when attendance ends. |
| `ExecuteScriptV2` | same as `ExecuteScript` | A different engine (V8): 10s, no statement cap, and it *can* make HTTP calls and await. Reach for it when a script is too big for 1000 statements. |

`Redirect` **does not stop the state**. The remaining actions still run, the outputs are still
evaluated, and the conversation is still parked wherever they point — so the user comes back to
that state later. Put the redirect last, and give the state a deliberate output.
