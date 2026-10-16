# The state schema

This is the on-disk format: the Builder document with the metadata it regenerates on its own
stripped out (ids, canvas cards, `$invalid` flags, typing indicators). `bbuilder push` puts
them back, so do not write them by hand and do not be surprised when a `pull` drops them.

`bbuilder validate` rejects an unknown key **on a state, an input or a content action**, because
a typo there would otherwise be dropped silently on the next push. It does not reach inside an
action's `settings`: a misspelled `metadatas` or `valeu` passes validation and is dropped on
publish, so re-read the settings keys yourself against `actions.md`.

```ts
type State = {
    // Unique across the flow. The Builder addresses states by title.
    $title: string

    // Marks the entry point, on exactly one state. A flow that carries none falls
    // back to the state named `onboarding`.
    root?: true

    // Canvas layout. States are 180x90px; keep them from overlapping.
    $position?: { top: string; left: string }

    // Run on arrival, before the messages go out.
    $enteringCustomActions: CustomAction[]

    // Messages, and at most one input. The only place SendMessage may appear.
    $contentActions: Array<{
        action?: ContentAction
        input?: Input
    }>

    // Run on the way out, before the outputs are evaluated.
    $leavingCustomActions: CustomAction[]

    // Evaluated in order; the first whose conditions all pass wins.
    $conditionOutputs: Array<{
        stateId: string
        // 'variable' means stateId holds a {{variable}} resolved at runtime.
        typeOfStateId?: 'state' | 'variable'
        conditions: Condition[]
    }>

    // Where the conversation goes when no condition output matched.
    $defaultOutput: {
        stateId: string
        typeOfStateId?: 'state' | 'variable'
    }

    // Run after the transition, only when the state actually changed.
    $afterStateChangedActions?: CustomAction[]

    // Available to the state without being part of its normal path.
    $localCustomActions?: CustomAction[]
}

type Input = {
    // true: the state does not wait, the turn continues straight through.
    bypass: boolean

    // Where the user's answer is stored.
    variable?: string

    validation?: {
        rule: 'text' | 'number' | 'date' | 'regex' | 'type'
        // Required when rule is 'regex'.
        regex?: string
        // Required when rule is 'type'; a media type such as 'image/jpeg'.
        type?: string
        // Sent to the user when the answer does not validate. Required.
        error: string
    }

    // How long to wait, as a duration: "0:30" is thirty minutes, "2:00" is two
    // hours. NOT a number of minutes — "5" parses as five days. Omit unless the
    // flow has a timeout path.
    expiration?: string

    // When these do not pass, the state does not wait for input.
    conditions?: Condition[]
}

type ContentAction = {
    // The message goes out only when all of these pass. This is how a state sends
    // one of two wordings — one action per case, with opposite conditions.
    conditions?: Condition[]
    continueOnError?: boolean
} & (
    | { type: 'SendMessage'; settings: { type: MimeType; content: unknown; metadata?: Record<string, string> } }
    | { type: 'SendRawMessage'; settings: { type: MimeType; rawContent: string } }
)
```

Both action lists take the same envelope — see `actions.md` for every `type` and its
`settings`:

```ts
type CustomAction = {
    $title?: string
    conditions?: Condition[]
    continueOnError?: boolean
    type: 'SetVariable' | 'ProcessHttp' | 'ExecuteScript' | 'ExecuteScriptV2' | 'ProcessCommand'
        | 'TrackEvent' | 'MergeContact' | 'Redirect' | 'ForwardToDesk' | 'LeavingFromDesk'
    settings: Record<string, unknown>
}

type Condition = {
    source: 'input' | 'context'
    variable?: string
    comparison: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith'
        | 'greaterThan' | 'lessThan' | 'greaterThanOrEquals' | 'lessThanOrEquals'
        | 'matches' | 'approximateTo' | 'exists' | 'notExists'
    operator?: 'or' | 'and'
    values: string[]
}
```

## Input validation

`rule` decides what counts as valid; the runtime sends `error` and keeps the user in the
state when it does not:

| Rule | Accepts |
| --- | --- |
| `text` | Any text message |
| `number` | Something parseable as a number |
| `date` | `dd/MM/yyyy`, `MM/dd/yyyy`, `dd-MM-yyyy`, `dd/MM`, `yyyy-MM-ddTHH:mm:ssK` and similar — **not** plain `yyyy-MM-dd` |
| `regex` | A match for `regex`, searched anywhere unless you anchor it with `^…$` |
| `type` | A message of the media type in `type` — how you require a photo or a document |

`error` is required for **every** rule, not just `regex`: without it the flow does not load.

Validation only runs when the input has content, and a failed attempt does not count as a
transition: the user can try again as many times as they like.

## Named states

| Id | Role |
| --- | --- |
| `onboarding` | The entry point, unless another state carries `root: true`. It **must** wait for an input: no input, a bypassed one, or one with conditions, and the flow does not load |
| `fallback` | Where unrecognized input goes. A project convention, which `validate` warns about; the runtime does not require it |
| `error` | The conventional home for an error message |

Anything else can be named freely. The Builder generates a UUID, and a state pulled from it
keeps one, but a readable kebab-case id (`ask-order`, `show-order`) is better for a state you
write: it is what the flow reads like in `bbuilder inspect`, and what a test names in its
`position`. A White Wall plugin state is prefixed with `ww:` — see the `blip-plugins` skill.
