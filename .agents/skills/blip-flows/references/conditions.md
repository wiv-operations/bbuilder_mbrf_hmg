# Conditions

A condition compares one value against a list:

```json
{
  "source": "context",
  "variable": "userChoice",
  "comparison": "equals",
  "operator": "or",
  "values": ["Track my order", "Where is my order"]
}
```

- `source` — `input` (the message that triggered this turn) or `context` (a variable, named in
  `variable`). `context` without `variable` is rejected by the runtime.
- `operator` — how the `values` combine: `or` (default, any matches) or `and` (all match).
  `notEquals` ignores this and always means "equals none of them".
- `exists` / `notExists` take **no** values. Every other comparison needs at least one.

`variable` is resolved exactly like the inside of a `{{...}}`, which is more than it looks:

```json
{ "source": "context", "variable": "orderBody@customer.city", "comparison": "equals", "values": ["São Paulo"] }
{ "source": "context", "variable": "input.type", "comparison": "notEquals", "values": ["text/plain"] }
```

So a condition can reach into a JSON response with `@property`, and can read any provider
namespace (`input.*`, `contact.*`, `calendar.*`, `bucket.*`). There is no need to copy a value
into a plain variable with a script first.

They appear in four places, and mean the same thing everywhere:

| Where | Effect |
| --- | --- |
| `$conditionOutputs[].conditions` | Which state comes next |
| `action.conditions` | Whether that action runs |
| `input.conditions` | Whether the state waits for input at all |

**A list of conditions is ANDed.** `operator` only combines the `values` inside one
condition. Two entries in the same `conditions` array must both pass.

**Outputs are evaluated in array order** and the first match wins, so put the specific ones
before the general ones and keep `input exists` last.

## How each comparison actually compares

| Comparison | Behaviour |
| --- | --- |
| `equals`, `notEquals` | Case-insensitive **and** accent-insensitive: `São` equals `sao` |
| `contains`, `startsWith`, `endsWith` | Case-insensitive, but **accent-sensitive**: `sao` does not contain `São` |
| `matches` | .NET regular expression, **searched anywhere** in the value — anchor it with `^…$` to test a whole value |
| `approximateTo` | Edit distance within 25% of the incoming value's length; lowercased, accents kept |
| `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals` | Numeric; **false** if either side does not parse as a number |
| `exists` | The value is not null and not empty |
| `notExists` | The value is null or empty |

Consequences worth remembering:

- You do not need to normalise case or accents to match a quick reply label — with `equals`.
  With `contains`, `São` and `sao` are different strings.
- `"comparison": "matches", "values": ["\\d{5}"]` is true of `my order 123456789 please`. If
  you mean "the whole answer is five digits", write `^\\d{5}$`.
- A numeric comparison against an unset variable is quietly false, not an error. Check
  `exists` first if the difference matters.
- A typed answer to a menu is best handled by a **second** condition output using `contains` or
  `approximateTo`, not by adding phrasings to the `equals` values — see below.

## The patterns you will keep writing

Branch on a menu choice — one output per option, matching the label exactly:

```json
"$conditionOutputs": [
  {
    "stateId": "order-tracking",
    "conditions": [
      { "source": "input", "comparison": "equals", "values": ["Track my order"] }
    ]
  },
  {
    "stateId": "human",
    "conditions": [
      { "source": "input", "comparison": "equals", "values": ["Talk to someone"] }
    ]
  }
]
```

Branch on an HTTP result:

```json
"$conditionOutputs": [
  {
    "stateId": "show-order",
    "conditions": [
      { "source": "context", "variable": "orderStatus", "comparison": "equals", "values": ["200"] }
    ]
  },
  {
    "stateId": "not-found",
    "conditions": [
      { "source": "context", "variable": "orderStatus", "comparison": "equals", "values": ["404"] }
    ]
  }
]
```

Anything else falls through to `$defaultOutput`, which is where the error state belongs.

Accept the typed answer as well as the tapped one — as a **separate output**, so the `equals`
output stays a list of labels you actually offered:

```json
"$conditionOutputs": [
  {
    "stateId": "order-tracking",
    "conditions": [
      { "source": "input", "comparison": "equals", "values": ["Track my order"] }
    ]
  },
  {
    "stateId": "order-tracking",
    "conditions": [
      { "source": "input", "comparison": "contains", "values": ["order", "tracking", "where is"] }
    ]
  }
]
```

Two outputs to the same state is normal and costs nothing. Mixing the two — putting `order`
and `tracking` into the `equals` list — is what you want to avoid: it reads as "these are the
options", and the first output stops being a faithful list of the buttons.

Run an action only when a value is missing:

```json
{
  "type": "ProcessHttp",
  "settings": { "...": "..." },
  "conditions": [
    { "source": "context", "variable": "customerId", "comparison": "notExists", "values": [] }
  ]
}
```
