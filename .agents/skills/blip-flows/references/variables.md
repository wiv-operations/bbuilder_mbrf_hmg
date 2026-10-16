# Variables

Every value in a flow is a string. `{{name}}` interpolates one anywhere in a message, a URI,
a header, a body or another variable's value.

```
{{userName}}                   a context variable this flow wrote
{{contact.name}}               a provider variable the runtime resolves
{{orderBody@customer.city}}    a property inside a variable holding JSON
```

## Context variables

A context variable is whatever a flow wrote: `input.variable`, `SetVariable.variable`,
`ExecuteScript.outputVariable`, `ProcessHttp.responseBodyVariable` / `responseStatusVariable`,
`ProcessCommand.variable`.

- **camelCase, letters and digits.** An input variable may also contain dots, but a dotted name
  reads as a provider namespace, so avoid it. A **hyphen is dangerous**: it matches the
  interpolation pattern and then fails to parse, which throws and aborts the whole turn rather
  than resolving to an empty string.
- **Case does not distinguish two variables.** The runtime lowercases a name when it writes it,
  so `userName` and `username` are the same variable. Keep the casing consistent anyway — it is
  the only thing making a name readable — but never rely on case to tell two apart.
- **Shared across the whole router.** A variable written in one subbot's flow is readable in
  another's. That is why `bbuilder validate` lints all flows together.
- **Reading something unset yields an empty string**, not an error. Nothing crashes; the
  message just goes out with a hole in it. Guard with an `exists` condition.
- They persist for the conversation, unless `SetVariable.expiration` (seconds) says otherwise.

## Reading into JSON with `@`

`@` walks properties of a variable that holds a JSON object:

```
{{orderBody@customer.name}}
```

It **cannot index an array**. To reach `items[0].sku`, pass the variable to an
`ExecuteScript`, `JSON.parse` it there, and return what you need.

## Provider namespaces

These are resolved by the runtime, never written by a flow. A name with a dot whose first
part is one of these is a provider read, so a context variable must not be named after one.

### contact

The person on the other side.

| Variable | Value |
| --- | --- |
| `{{contact.identity}}` | Full identity. On WhatsApp, the phone number followed by `@wa.gw.msging.net` |
| `{{contact.name}}`, `{{contact.email}}`, `{{contact.phoneNumber}}`, `{{contact.city}}` | Contact fields |
| `{{contact.extras.myKey}}` | A custom field, written by `MergeContact` |
| `{{contact.source}}` | The channel the conversation came in on |
| `{{contact.serialized}}` | The whole contact as JSON, for a script |

### input

The message that triggered this turn.

| Variable | Value |
| --- | --- |
| `{{input.content}}` | The content, serialized. For a text message, the text |
| `{{input.type}}` | Its media type, e.g. `text/plain` or `image/jpeg` |
| `{{input.length}}` | Length of the serialized content |
| `{{input.message.id}}`, `{{input.message.from}}` | Envelope properties |
| `{{input.intent.name}}`, `{{input.intent.score}}` | AI model match, when the bot uses one |
| `{{input.entity.<name>.value}}` | An extracted entity |

### calendar

**Always UTC.** Nothing configures this — the bot's timezone setting reaches the script engines
and never the calendar. A bot serving Brazil that branches on `{{calendar.hour}}` is three hours
out, permanently. Use the offset form (`{{calendar.minus3hours.hour}}`) or convert in a script.

| Variable | Value |
| --- | --- |
| `{{calendar.date}}` | `2026-07-31` |
| `{{calendar.datetime}}` | `2026-07-31T14:05:00Z` |
| `{{calendar.time}}`, `{{calendar.hour}}`, `{{calendar.minute}}`, `{{calendar.second}}` | Time parts |
| `{{calendar.day}}`, `{{calendar.month}}`, `{{calendar.year}}`, `{{calendar.dayofweek}}` | Date parts |
| `{{calendar.unixtime}}`, `{{calendar.unixtimemilliseconds}}` | Epoch |
| `{{calendar.tomorrow.date}}`, `{{calendar.yesterday.date}}` | Shifted by a day |
| `{{calendar.plus3days.date}}`, `{{calendar.minus2hours.datetime}}` | Arbitrary offset: `plus`/`minus` + number + `millisecond(s)`…`year(s)` |

### The rest

| Namespace | Use |
| --- | --- |
| `{{random.guid}}`, `{{random.integer}}`, `{{random.string}}` | Fresh value per read — store it if you need it twice |
| `{{bucket.<key>}}` | A value from the bot's bucket storage. Where API keys belong (see Secrets) |
| `{{config.<key>}}` | A value from this flow's `configuration.json` — a committed file, so never a secret |
| `{{state.id}}`, `{{state.previous.id}}` | Where the conversation is, and where it was |
| `{{application.identifier}}`, `{{application.identity}}` | The bot itself |
| `{{ticket.<field>}}` | The open Desk ticket, if any |
| `{{tunnel.owner}}`, `{{tunnel.originator}}` | Set when the conversation arrived through a router tunnel |
| `{{resource.<key>}}` | A resource configured on the bot |
| `{{secret.<key>}}` | A secret — **only resolves inside a `ProcessHttp` action** (see below) |

## Interpolation and escaping

Interpolation happens once, over the action's settings as a whole: the runtime serializes the
settings to JSON, substitutes every `{{...}}`, and parses the result back. Values are escaped
for **that** level, and the parse consumes the escaping.

So it is exactly enough for a value that lands directly in a settings field, and one level short
for a value inside a JSON body, which is itself a string in those settings:

- **A plain field is safe.** `"uri": "https://api.example.com/{{orderId}}"`, a message's text,
  a header — a quote or a newline in the value cannot break these.
- **A JSON body is not.** In `"body": "{\"note\":\"{{userNote}}\"}"`, a `"` or a newline typed by
  the user survives the parse and lands raw inside the body, which stops being valid JSON. The
  action then fails, and the turn dies with it.
- **Sanitize free text before it goes in a body**, with an `ExecuteScript` that returns the value
  JSON-encoded. This is why every plugin that sends user text to an API has a `wwsanitized…`
  script in front of it — it is not decoration.
- **To splice raw JSON, leave the quotes off**: `{"values":{{itemsJson}}}`, where `itemsJson`
  holds JSON already (a script's return value does).

## Secrets

Never write a key, token or password into a flow **or into `configuration.json`** — both are
committed to git.

- `{{bucket.apiKey}}` works anywhere and is the general answer. The bucket lives on the bot,
  not in the repository; write the value once with `bbuilder bucket set apiKey <value>`.
- `{{config.apiKey}}` reads this flow's `configuration.json` — right for a base URL, wrong
  for a credential.
- `{{secret.apiKey}}` is restricted to `ProcessHttp` settings. Anywhere else — a `SetVariable`, a
  `ProcessCommand`, a script, a message — it silently resolves to an empty string. In particular
  do not copy a secret into a variable and use the variable: the credential arrives empty and the
  API answers 401 with nothing to show for it.

A key never set, or set on the wrong subbot, resolves to empty like any other variable;
`bbuilder bucket get apiKey` shows what each subbot actually has.
