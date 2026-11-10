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
npm install                   # once, so tests/ can import bbuilder/test (postinstall applies the blip-subflows patches)
npm run pull                  # flows/ + subflows/ from Blip; never plain `bbuilder pull`
bbuilder inspect              # read the flow as a map, not as JSON
# ...edit flows/<identifier>/flow.json...
bbuilder validate             # static checks, no network; run after every edit
npm run type-check            # only if you touched tests/
bbuilder diff                 # what publishing would change, before it changes it
bbuilder publish <identifier> # makes the change live; only the flows named (--all for every flow)
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
| `blip-subflows` | Subflows (`subflow:` states, `subflows/<parent>/<shortName>/`): pull, edit, push draft, publish one or many, undo |

## Design input

If a Figma MCP server is available, the design is the specification: reproduce its exact
messages, option labels and message order. Use only `get_image` — the other Figma tools add
noise. With no Figma, follow `CHATBOT.md` and the style of `references/*`.

<!-- blip-subflows:start -->
## Subflows (Builder `subflow:` blocks)

Flows can call Builder subflows: a state with `shortNameOfSubflow` (id `subflow:<guid>`). Each
subflow is its own flow, owned by the parent bot, and it is published on its own: publishing
it does **not** publish the parent, and it goes live at once for everyone who reaches the block.
`bbuilder` does not know subflows exist. `bbuilder pull/push/publish` ignore them.

- `subflows/<parent>/<shortName>/flow.json` is the subflow draft (canvas model, not minified).
  Edit it here. `configuration.json` is editable too. `flow-published.json` and `subflow.json`
  are read-only snapshots. The whole `subflows/` tree is created by `npm run pull`; never create
  it by hand.

### Downloading the bot: always `npm run pull`

```bash
npm run pull          # = bbuilder pull (flows/ + backup/), then every subflow into subflows/<parent>/<shortName>/
```

**Never run `bbuilder pull` on its own.** It only brings `flows/`, so `subflows/` goes stale
without any warning. `npm run pull` runs `bbuilder pull` first (subflows are discovered from
the flows it writes) and only if it succeeded downloads the subflows. A subflow whose local
`flow.json` has edits not yet sent is skipped with a warning, not overwritten.
`npm run pull:subflows` refreshes only the subflows.

### Changing subflows: load the `blip-subflows` skill

Load it before touching anything under `subflows/`. In short:

```bash
S=.agents/skills/blip-subflows/scripts/subflows.mjs
node $S check <targets>          # offline: validation + compiled draft vs live
node $S diff <targets>           # what changed, and what publishing would change
node $S push <targets>           # draft only, not live
node $S publish <targets> --yes  # LIVE. Say so before running it.
node $S undo <targets> --yes     # back to the state before the last push/publish
```

Targets: `<parent>/<shortName>`, `<shortName>`, `<parent>` or `--all`; several run in parallel.
Close the subflow's canvas in the browser before push/publish: an open canvas saves its stale
draft over yours.

### Publishing flows that contain subflow blocks: SDK patch

Unpatched, `bbuilder publish` and `bbuilder rollback` (SDK 0.0.193) drop `shortNameOfSubflow` and
Blip rejects every flow that has a `subflow:` block ("The given key 'shortNameOfSubflow' was not
present in the dictionary"). They also drop the portal's tracking. `postinstall` patches the SDK
to compile like the portal. Before any `bbuilder publish`, confirm it:

```bash
node .agents/skills/blip-subflows/scripts/patch-blip-sdk.mjs --check   # exit 0 = patched
```

If `--check` fails after an SDK upgrade, do not publish flows with subflow blocks through bbuilder.

### `bbuilder push` / `bbuilder publish` act only on the flows you name

`postinstall` also patches bbuilder (`scripts/patch-bbuilder.mjs`): push and publish take the
flows as arguments, and a bare command is refused.

```bash
bbuilder publish <identifier> [identifier...]   # only these flows (folder names in flows/)
bbuilder publish --all                          # every flow: only when that is really the intent
bbuilder push <identifier> [identifier...]      # same for the draft
```

Publish only the flows you changed. Confirm the patch with
`node .agents/skills/blip-subflows/scripts/patch-bbuilder.mjs --check` (exit 0). If it fails after
a bbuilder upgrade, `bbuilder publish` publishes every flow again, so do not run it until it is fixed.
<!-- blip-subflows:end -->
