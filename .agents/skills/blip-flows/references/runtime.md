# Runtime limits

The numbers the Builder runtime enforces. They are what makes some designs impossible, so
check here before assuming a flow can do something.

| Limit | Value | What happens when you cross it |
| --- | --- | --- |
| State transitions per input | **10** | The turn throws. Chains of `bypass: true` states are the usual cause |
| Time to process one input | **1 min** | The turn is cancelled |
| Time for one action | **30s** | The action is cancelled — this is the real ceiling on an HTTP call |
| `ProcessHttp` own timeout | 60s, but capped by the 30s above | See below: a timeout is swallowed |
| `ExecuteScript` timeout | **5s** | The action fails |
| `ExecuteScript` statements | **1000** | The cap you actually hit. A loop over a long list dies here |
| `ExecuteScript` memory | ~100MB | |
| `ExecuteScript` recursion depth | 50 | |
| `ExecuteScriptV2` timeout | **10s**, and no statement cap | The engine for work that does not fit in 1000 statements |
| Input expiration loops | 50 | A self-expiring state cannot spin forever |

## What the transition limit means in practice

Each of these is one transition: leaving a state after an answer, and moving through a state
whose input is bypassed. A design like

> capture the answer → call the API → branch → set a variable → send the message → wait

is 5 transitions and fine. A chain of eleven bypassed states is not, and neither is a loop
that walks a list one state at a time. When you need to do something eleven times, do it in
one `ExecuteScript`.

## Time budget

An action gets 30 seconds and the whole turn gets a minute, so two slow HTTP calls in one turn
will not both finish. When a flow needs several, either do them in one endpoint or split them
across turns with a message in between.

## Scripts

`function run(...)` is invoked with the `inputVariables` in order, as strings. The engine is
sandboxed: no network, no filesystem, no timers, no `require`, no `async`. Dates default to
Brazil time (`E. South America Standard Time`) unless the bot configures another timezone —
note that this affects scripts only, never `{{calendar.*}}`, which is always UTC.

Write ES5. `let` and `const` work, but nothing past ES5 is guaranteed, and a script that
fails to parse fails the whole turn.

`ExecuteScriptV2` is a different engine (V8) with a 10s budget and no statement limit, and it
can make HTTP calls and await promises. The reason to switch is the statement cap, not the time.

## When something fails

An action that throws aborts the turn unless it carries `continueOnError`. What that actually
looks like to the user, and to the next turn, is worth being precise about:

- **Messages already sent stay sent.** A state that sends two messages and then fails leaves
  the user reading half a script with no ending.
- **Nothing rolls back.** Variables written before the failure stay written.
- **The conversation has already moved.** The state is stored before the new state's actions
  run, so a failure in an entering or content action parks the user *in that state*: their next
  message re-enters it and re-runs those actions from the top — re-sending what did go out, and
  re-issuing any HTTP call. A failure in a leaving action leaves them in the current state, so
  those leaving actions run again on the next input.
- **So a non-idempotent call in a leaving list can happen twice.** If a request charges a card
  or creates a ticket, guard it with a variable that records it was done.

A timeout is worse than an error, because it is silent: `ProcessHttp` swallows it, writes
neither the status nor the body, and the flow carries on with whatever those variables held
before. Clear them with `SetVariable` to `""` before the call, and branch on the status.

## An invalid flow is not a partly-working flow

The runtime validates the **whole flow on every message**. One malformed condition, one output
pointing nowhere, one root state that does not wait for input, and every message from every
user throws — not just the branch you broke.

That is why `bbuilder validate` calls those errors, and why `--force` on a push is a decision
about the entire bot rather than about one state.
