---
name: blip-flow-testing
description: Use when writing, running or debugging chatbot tests in tests/*.test.ts — the flowtest harness, asserting what the bot sends (text, menus, media, links), answering menus, starting from a specific state, WhatsApp Flow responses, or a test that times out or hangs.
---

# Testing a flow

A test is a real conversation. `flowtest` creates a throwaway contact, connects it, and talks
to the **published** bot — so a test exercises what is live, not what is on disk.

```ts
import { flowtest } from 'bbuilder/test'

flowtest('greets and asks what the user needs', async ctx => {
    await ctx.user.send('hi')

    await ctx.user.text.matches('Welcome')
    await ctx.user.select.hasOptions('Track my order', 'Talk to someone')
})
```

Run them with `bbuilder test`, or `bbuilder test --publish` to publish the local flows first.
A test file that is not published yet tests the previous version of the flow — that is the
single most common reason for a confusing failure.

To run one test, `bbuilder test -t "<regex>"` filters by test name — the positional argument
is a file glob, not a name, and matches nothing when handed one.

`npm install` has to have run once, or `bbuilder/test` cannot be imported. `npm run type-check`
checks the test files without running them, which is worth doing before a publish.

## The context

### Sending

| Call | Sends |
| --- | --- |
| `ctx.user.send('text')` | A plain text message |
| `ctx.user.send({ type, content })` | Any content type |
| `ctx.user.select.choose('Track my order')` | Asserts the option was offered, then sends its label |
| `ctx.user.sendFlowResponse({ ... })` | A WhatsApp Flow submission (see `blip-whatsapp`) |

To send a file, upload it to Blip's storage first — a media link pointing anywhere else is
refused with *"The destination blocked external media links"*:

```ts
const uri = await ctx.user.client.media.uploadMedia('audio/ogg', readFileSync(fixture))
await ctx.user.send({ type: 'application/vnd.lime.media-link+json', content: { uri, type: 'audio/ogg' } })
```

### Receiving

Every assertion consumes exactly one message, in order. Typing indicators are filtered out;
everything else counts, so assert on each message the bot sends or the next assertion reads
the wrong one.

| Call | Asserts |
| --- | --- |
| `ctx.user.text.equals('...')` | The whole text, exactly |
| `ctx.user.text.matches('...' \| /re/)` | A substring or a pattern |
| `ctx.user.text.expect(t => ...)` | Anything else about the text |
| `ctx.user.select.hasOptions('A', 'B')` | The menu offers exactly these labels, in order |
| `ctx.user.select.matches('...')` | The menu's own text |
| `ctx.user.select.options()` | Returns the labels, for a looser check |
| `ctx.user.media.isOfType('image/')` | A media message of that type |
| `ctx.user.link.pointsTo('example.com')` | A web link |
| `ctx.user.raw.received()` | Raw channel content (`application/json`) |
| `ctx.user.text.received()` etc. | Returns the message, when you need the content itself |
| `ctx.user.consume()` | The next message whatever its type — for discovering what a state sends |

Each of these fails with what the bot actually sent, including its type, so a "wrong type"
failure tells you immediately that the flow answered with a menu where you expected text.

## Starting mid-flow

Walking through onboarding for every test is slow and couples every test to the greeting. To
test one branch, park the conversation on the state before it:

```ts
flowtest(
    'rejects an invalid email',
    { position: { subbotIdentifier: 'my-registration-flow', subbotState: 'ask-email' } },
    async ctx => {
        await ctx.user.send('not-an-email')
        await ctx.user.text.matches('valid email')
    }
)
```

`subbotIdentifier` is the flow's own identifier — the directory name under `flows/`, which is
the subbot the flow belongs to. `subbotState` is the state id, which is why a readable id is
worth having.

The bot does not run the state on arrival — nothing has happened from its point of view — so
the test still sends the first message.

## What to test

Cover the journeys, not the states:

- **The happy path of every journey a user can start.** One test each, end to end.
- **Every branch of a menu.** A menu with three options needs three tests, or one test that
  restarts. `unmatched-option` in `bbuilder validate` finds the option you forgot to wire;
  a test proves the branch does the right thing.
- **Each validation failure**, and that the retry then succeeds.
- **The fallback**: send something meaningless and assert the bot recovers.
- **Every integration's failure path**, not just its success. An HTTP 500 must reach a
  message, not a dead end.

Do not test the exact wording of every sentence — `matches` on the part that carries the
meaning survives a copy edit, `equals` does not. Do use `equals` for option labels: those are
the contract between the message and the flow's conditions.

Two things that need care:

- **A message the flow only sometimes sends.** A state that picks between two wordings with
  conditions sends exactly one of them, so assert once, on what they have in common:
  `await ctx.user.text.expect(text => text.includes('em preparo'))`. `bbuilder inspect` marks a
  conditional message with a `?`, so `sends text?+text?` means one message, not two.
- **Data the test needs from a real system.** An integration test needs a record that actually
  exists — an order number, a customer id. Ask for those; they belong in `CHATBOT.md` next to
  the endpoint. If you have to proceed without them, name the constants at the top of the file
  and say in your summary which tests cannot pass until they are filled in.

## What the test channel cannot prove

The test contact rides Blip's tunnel channel, not WhatsApp. Line breaks, raw payloads and
active-message identity all behave differently on the real channel (see `blip-whatsapp`), so
a passing suite proves the conversation, not the channel — finish a WhatsApp journey with one
real conversation on a real phone.

## When a test hangs or fails

- **Timed out after 60s** — the bot sent nothing. Either the flow is not published, or the
  state does not answer at all, or the conversation is parked somewhere else. Check with
  `bbuilder inspect --state <id>` that the state actually sends something. When the state is
  genuinely slow — an LLM call, a long HTTP action — raise the wait instead:
  `flowtest('...', { timeout: 120_000 }, async ctx => ...)`.
- **An interpolation comes back empty** — there is no way to watch the runtime's variables,
  but there is a crude window: temporarily replace the state's message with
  `DIAG status=[{{httpStatus}}] body=[{{httpBody}}]`, publish, run the one test that reaches
  it, read the values, restore.
- **"The bot failed to process the message"** — the runtime threw: a failing action, a script
  error, or the 10-transition limit. Look at the state's actions; an HTTP call without
  `continueOnError` is the usual culprit.
- **Expected a 'text/plain' message but the bot sent '...select+json'** — the assertions are
  off by one message, or the flow sends the menu first. Read the order in
  `bbuilder inspect --state <id>`.
- **A test that passes alone and fails in a suite** — it depends on conversation state it did
  not set. Give it a `position`, or send everything it needs from scratch.
- Tests leave their contacts behind. `bbuilder test --purge` clears them first.
