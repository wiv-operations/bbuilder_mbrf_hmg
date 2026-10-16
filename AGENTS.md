# Blip chatbot project

This repository **is** a chatbot. Its behaviour lives in `flows/<identifier>/flow.json` —
conversational state machines that run on the Blip Builder runtime. You change the chatbot
by editing those files and publishing them.

- `CHATBOT.md` — the business: who this bot is, what it may and may not do. Read it first.
- `flows/<identifier>/flow.json` — one file per subbot of this router. The source of truth.
- `flows/<identifier>/global-actions.json` — the one state Blip runs on **every** message,
  before the flow sees it. A variable it writes is readable from every flow, and a request in
  it that fails takes down every conversation. `bbuilder inspect` does not show it; read the
  file.
- `flows/<identifier>/configuration.json` — the settings the runtime reads alongside the flow.
- `tests/*.test.ts` — conversations that must keep working.
- `references/example-flow.json` — a small, complete flow: menu, validated input, HTTP call
  with error branches, handoff. Read it once before writing your first state.
- `references/*` — flows from other bots, kept as examples of shape and style.
- `backup/*` — the raw flows as Blip last returned them. Never edit; `bbuilder restore` uses it.

## The loop

Work in this order, every time. Each step is cheap and catches a different class of mistake.

```bash
npm install                   # once, so tests/ can import bbuilder/test
bbuilder inspect              # read the flow as a map, not as JSON
# ...edit flows/<identifier>/flow.json...
bbuilder validate             # static checks, no network; run after every edit
npm run type-check            # only if you touched tests/
bbuilder diff                 # what publishing would change, before it changes it
bbuilder publish              # makes the change live
bbuilder test                 # runs tests/ against the published bot
```

`bbuilder test --publish` chains the last two. `bbuilder validate --json` is the form to
parse. Do not stop until `validate` is clean and every test passes.

**Never read a whole `flow.json` to find your way around.** It is machine-shaped and long.
`bbuilder inspect` prints one line per state, and `bbuilder inspect --state <id>` prints a
single state in readable form. This is about orientation: reading the state you are about to
edit is expected, and so is reading a file you are rewriting wholesale.

## Rules that are not negotiable

- **Publishing is live.** `bbuilder publish` changes what real users get. Say so before
  running it, unless the request already implies it. `bbuilder push` only writes the draft.
  `bbuilder rollback <identifier>` puts the previous publication back if one goes wrong.
- **`bbuilder diff --published` before you assume the project is what is live.** Somebody may
  have edited the bot in the canvas since the last pull, and a push replaces whole documents,
  so their change disappears without being mentioned.
- **Branch on labels, never on ids or payloads.** When a user picks an option, the bot
  receives the option's text. Match that text.
- **Every flow needs an `onboarding` state and a `fallback` state.** `onboarding` is the
  entry point; `fallback` is where unrecognized input goes.
- **No placeholders.** No mock endpoints, no `TODO`, no invented URLs. If a value is
  unknown, ask for it.
- **Test an HTTP call with `curl` before putting it in a flow.** At runtime you get a status
  code and a body, and nothing else to debug with. If the endpoint in the spec cannot be
  reached from here, use it exactly as written and say plainly which calls you could not verify.
- **An error from `validate` takes the whole bot down, not one branch.** The runtime validates
  the entire flow on every message. `--force` is a decision about every conversation, so do not
  reach for it to get past a state you meant to finish later.
- **Keep tests current.** A flow change that breaks a test means one of the two is wrong;
  fix the right one, and add a test for every journey you add.

## Skills

Load the skill before writing, not after something fails:

| Skill | Use it for |
| --- | --- |
| `blip-flows` | Anything that edits `flow.json`: states, actions, variables, conditions, execution order |
| `blip-flow-testing` | Writing or debugging `tests/*.test.ts` |
| `blip-whatsapp` | WhatsApp-specific content: buttons, lists, WhatsApp Flows, raw payloads |
| `blip-plugins` | White Wall plugins (`ww:` states): Google Sheets, ChatGPT, RD Station, CRMs |
| `blip-conversation-design` | Deciding what the bot should say, and in what order |

## Design input

If a Figma MCP server is available, the design is the specification: reproduce its exact
messages, option labels and message order. Use only `get_image` — the other Figma tools add
noise. With no Figma, follow `CHATBOT.md` and the style of `references/*`.
