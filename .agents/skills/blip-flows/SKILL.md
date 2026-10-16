---
name: blip-flows
description: Use when reading or editing a Blip flow (flows/*/flow.json) — adding or wiring states, writing actions (SendMessage, ProcessHttp, ExecuteScript, SetVariable, Redirect, ForwardToDesk...), branching with conditions, capturing user input, or working with context variables and {{...}} interpolation. Also use when bbuilder validate reports something you do not recognise.
---

# Blip flows

A flow is a state machine, keyed by state id:

```json
{
  "onboarding": { "...state..." },
  "menu": { "...state..." }
}
```

Everything the bot does happens inside a state, and the conversation only pauses where a
state waits for input. Get the execution order right and the rest follows.

## What one turn looks like

A user message enters the flow and the runtime keeps moving until it reaches a state that
waits for input:

1. **Validate the input** against `input.validation`. On failure it sends the error message
   and stops — the user stays in this state.
2. **Store the input** in `input.variable`.
3. **`$leavingCustomActions`** run — the state's way out.
4. **Outputs are evaluated in order.** The first `$conditionOutputs` entry whose conditions
   all pass wins; `$defaultOutput` is the fallback. Order matters, put the specific first.
   An output with an empty `conditions` list always matches, so anything after it is dead.
5. **`$afterStateChangedActions`** of the state just left run, if the state actually changed.
6. **`$enteringCustomActions`** of the new state run.
7. **`$contentActions`** of the new state run: messages go out, and if the state's `input`
   is not bypassed, the turn ends here.
8. Otherwise, back to 3 in the new state.

Two consequences worth internalising:

- **A state that sends a message and captures input does both in the same turn.** Ask and
  wait are one state, not two.
- **At most 10 transitions per input.** A chain of `bypass: true` states longer than that
  throws. A state whose default output points at itself with a bypassed input is an
  immediate loop — `bbuilder validate` calls this `transition-loop`.

## The shape of a state

The minimum viable state, and the fields you will use 90% of the time:

```json
{
  "$title": "Ask for the name",
  "$position": { "top": "300px", "left": "640px" },
  "$enteringCustomActions": [],
  "$contentActions": [
    {
      "action": {
        "type": "SendMessage",
        "settings": { "type": "text/plain", "content": "What is your name?" }
      }
    },
    { "input": { "bypass": false, "variable": "userName" } }
  ],
  "$leavingCustomActions": [],
  "$conditionOutputs": [
    {
      "stateId": "greet",
      "conditions": [{ "source": "input", "comparison": "exists", "values": [] }]
    }
  ],
  "$defaultOutput": { "stateId": "fallback" }
}
```

Rules worth holding onto:

- **The entry point must wait for an input.** That is the state carrying `root: true`, or the
  one named `onboarding` when no state carries it. No input element, a bypassed one, or one
  with conditions, and the runtime refuses to load the flow at all.
- Put `SendMessage` and `SendRawMessage` in `$contentActions` — that is where the Builder draws
  them — and every other action type in `$enteringCustomActions` or `$leavingCustomActions`.
- **A state uses only the first `input` in its `$contentActions`**; any others are dropped on
  publish. Put it last, after the messages it belongs to.
- Every `stateId` in an output must exist in the same flow, or be a `{{variable}}` resolved at
  runtime. To reach another subbot, use a `Redirect` action, not an output.
- A state with no `input` at all never waits: the turn continues straight through it. If it can
  be reached again that way, the flow does not load.
- `$title` should be unique: the runtime does not care, but the Builder addresses states by it.
- Keep `$position` sensible (states are 180×90px) so the canvas stays readable for humans.

## Writing a flow

- **Name states readably**, in kebab-case: `ask-order`, `show-order`, `handoff`. The Builder
  generates UUIDs and a pulled state keeps its own, but an id you choose is what `inspect`
  reads like and what a test's `position` names. `onboarding`, `fallback` and `error` are fixed.
- **Reuse before adding.** Run `bbuilder inspect` first: the state you want often exists.
- **One responsibility per state.** "Send the menu and capture the choice" is one state.
  "Call the API, branch on the result, and answer" is three.
- **Name variables in camelCase**, letters and digits only (the runtime rejects `-` and `_`
  in an input variable).
- **Write the outputs as you write the state.** A dangling output fails validation; a
  missing one silently sends everyone to the default.

`references/example-flow.json` in the project is a complete, validating flow that uses every
pattern above — a menu, a validated input, an HTTP call with branches for success, not-found
and failure, and a handoff. Copy from it rather than from memory.

## References

Load what the task needs:

- `references/actions.md` — every action type, its settings, and what it does at runtime
- `references/variables.md` — context variables, the `{{...}}` and `@property` syntax, and
  every namespace the runtime provides (`contact`, `calendar`, `bucket`, `input`, ...)
- `references/conditions.md` — comparisons and how they actually compare
- `references/state.md` — the complete state schema, field by field
- `references/runtime.md` — limits and timeouts that shape what a flow can do

## When validate complains

`bbuilder validate` separates the two things that can be wrong. **An error means the bot does
not work** — most of them mean the runtime validates the whole flow on every message and
throws, so the bot is down for everyone, not just in that branch. A warning means it probably
does not do what you meant.

Errors:

| Rule | What it means |
| --- | --- |
| `invalid-schema` | The state does not match the flow format. The path in the message is the field. |
| `missing-root-state` | No entry point: no state carries `root: true` and none is named `onboarding`, or more than one claims it. |
| `root-must-wait` | The entry point does not wait for an input, or its input has conditions. |
| `dangling-output` | An output points at something that is neither a state in this flow nor a `{{variable}}`. |
| `input-less-loop` | A state with no input can be reached again without the user answering. |
| `transition-loop` | Every output of a state leads back to itself and it does not wait. |
| `shadowed-output` | An output with no conditions always matches, so the ones after it are dead. |
| `invalid-condition` | `context` with no variable, `exists` with values, or a comparison with none. |
| `invalid-input-validation` | A `regex` rule with no regex, a `type` rule with no type, or no error message. |
| `invalid-regex` | A validation regex or a `matches` value that does not compile. |
| `invalid-variable-name` | An input variable outside letters, numbers and dots. |
| `unreadable-variable` | A `{{name}}` the runtime cannot parse — a hyphen, or a dot in a context variable. Reading it aborts the turn. |
| `malformed-placeholder` | `{{ spaced }}` or `{{a[0]}}`: not substituted, and sent to the user as written. |
| `missing-media-type` | A message without the media type the runtime deserializes its content as. |
| `content-type-mismatch` | A message whose `content` is not the shape its `type` promises. |

Warnings:

| Rule | What it means |
| --- | --- |
| `undefined-variable` | A `{{name}}` nothing in the project writes. It resolves to an empty string. |
| `unmatched-option` | An option is offered that no output matches, so choosing it falls to the default. |
| `empty-select` | A menu with no options: nothing for the user to answer. |
| `http-aborts-turn` | A request with no `continueOnError`: a failure leaves the user with silence. |
| `http-content-type-casing` | A `Content-Type` header the runtime will not see, so the body goes out as JSON. |
| `unreachable-state` | Nothing leads here. Fine for a redirect target, otherwise dead. |
| `duplicate-title` | Two states share a `$title`; the Builder will only find one. |
| `extra-input` | More than one input in a state; only the first survives publish. |
| `missing-fallback-state` | This project expects a `fallback` state. |
| `script-missing-function` | The script never defines the function the settings name. |
| `script-arity-mismatch` | The function's parameters and `inputVariables` differ in number. |

The errors come from the flow format itself, so anything that writes a flow — this CLI, the
Builder extension, a script using the SDK — rejects the same things. The warnings are this
CLI's, which is why they can be warnings at all.

A flow that would be rejected is reported on its own: the warnings cannot run on it, and
`validate` says so rather than implying the flow is otherwise clean.
