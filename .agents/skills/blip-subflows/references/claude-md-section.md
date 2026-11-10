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
