#!/usr/bin/env node
// Blip Builder subflows: list, pull, diff, push (draft), publish, undo — one or many at once.
//
// Run from the root of a bbuilder project (where bbuilder.json and node_modules/bbuilder live):
//   node .claude/skills/blip-subflows/scripts/subflows.mjs <command> [targets...] [options]
//
// Targets: "<parent>/<subflow>", "<subflow>", "<parent>" (all of its subflows) or --all.
// Auth: reuses `bbuilder login` (portal e-mail + access key) and bbuilder.json (tenant, router).
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------------------
// bbuilder internals (auth, client, validator). Resolved from the project, not from this file.
// ---------------------------------------------------------------------------------------------
const ROOT = process.cwd();
const BBUILDER = join(ROOT, 'node_modules', 'bbuilder', 'dist');
if (!existsSync(join(ROOT, 'bbuilder.json')) || !existsSync(BBUILDER)) {
    fail('Run this from the root of a bbuilder project (bbuilder.json + node_modules/bbuilder). Try "npm install".');
}
const load = (file) => import(pathToFileURL(join(BBUILDER, file)).href);
const { Configuration } = await load('config.js');
const { Blip } = await load('blip.js');
const { validateFlow } = await load('validator.js');
const { minifyFlow } = await import(pathToFileURL(join(ROOT, 'node_modules', '@whitewall', 'blip-sdk', 'dist', 'esm', 'index.js')).href);
const { portalCompileSubflowFlow } = await import(new URL('./portal-compiler.mjs', import.meta.url).href);
Configuration.loadConfig(join(ROOT, 'bbuilder.json'));

const FLOWS_DIR = join(ROOT, 'flows');
const SUBFLOWS_DIR = join(ROOT, 'subflows');
const BUILDER = 'postmaster@builder.msging.net';
const DOC_TYPE = 'application/vnd.lime.document+json';
const FILES = {
    draft: 'flow.json', // edited-flow: what the canvas draws. Edit this.
    configuration: 'configuration.json', // edited-configurations. Edit this.
    published: 'flow-published.json', // flow-published: what is live. Read-only snapshot.
    meta: 'subflow.json', // GET /subflows/<shortName>. Read-only.
    sync: '.sync.json', // hashes of what Blip had at the last pull/push/publish.
    previous: '.previous', // remote documents right before the last push/publish (for undo).
};

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const HELP = `Usage: node .claude/skills/blip-subflows/scripts/subflows.mjs <command> [targets...] [options]

Commands
  list                     subflows referenced by every flow in flows/ (local + Blip draft)
  pull     <targets|--all> download draft, configuration, published and metadata into subflows/
                           (creates the folders; skips a subflow whose local draft has unsent edits)
  diff     <targets|--all> local vs Blip: draft (states/configuration) and what publish would change
  check    <targets|--all> offline: compile the local draft and compare with local flow-published.json
  push     <targets|--all> write the local draft + configuration to Blip (NOT live)
  publish  <targets|--all> push, compile and publish (LIVE). Requires --yes
  undo     <targets>       put back the documents saved in .previous/ by the last push/publish. Requires --yes

Targets: <parent>/<subflow> | <subflow> | <parent> | --all

Options
  --yes            confirm a live change (publish, undo)
  --force          pull: overwrite unsent local edits. push/publish: write even if validation fails
                   or the Blip draft changed since the last pull
  --hosting <id>   hosting identity used as publish key (default: discovered from the parent bot)
  --journey on|off force TrackContactsJourney injection (default: detected from the live document)
`;

const argv = process.argv.slice(2);
const command = argv[0];
const flags = new Set(argv.filter((a) => a.startsWith('--') && !['--hosting', '--journey'].includes(a)));
const option = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--hosting', '--journey'].includes(all[i - 1]));

if (!command || command === 'help' || flags.has('--help')) {
    console.log(HELP);
    process.exit(0);
}

const blip = new Blip();

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------
async function list() {
    const refs = await discover();
    if (refs.length === 0) return console.log('No subflows referenced by any flow.');
    for (const { parent, shortName, title, stateId } of refs) {
        console.log(`${parent}/${shortName}  (block "${title}", state ${stateId})`);
    }
}

async function pull() {
    const targets = await resolveTargets({ remote: true });
    await each(targets, async (t) => {
        const remote = await fetchRemote(t);
        // Never throw away local edits that were not pushed: the draft on disk differs from what
        // Blip had at the last sync, and also from what Blip has now.
        const draftFile = join(t.dir, FILES.draft);
        const sync = await readSync(t);
        if (!flags.has('--force') && sync && existsSync(draftFile)) {
            const local = hash(await readJson(draftFile));
            if (local !== sync.draft && local !== hash(remote.draft)) {
                return `⏭️  ${t.id}: skipped, ${FILES.draft} has local edits not sent to Blip (push/publish them, or pull --force to discard)`;
            }
        }
        await writeLocal(t, remote);
        await writeSync(t, remote);
        const states = Object.keys(remote.draft).length;
        return `⬇️  ${t.id}: ${states} states${remote.published ? '' : ' (never published)'}`;
    });
}

async function diff() {
    const targets = await resolveTargets();
    await each(targets, async (t) => {
        const local = await readLocal(t);
        const remote = await fetchRemote(t);
        const lines = [`🔎 ${t.id}`];
        const draft = diffStates(remote.draft, local.draft, (s) => s.$title);
        lines.push(`   draft vs Blip draft: ${draft.length ? '' : 'identical'}`, ...draft.map((d) => `     ${d}`));
        if (canonical(remote.configuration) !== canonical(local.configuration)) {
            lines.push('   configuration differs from the Blip draft');
        }
        if (remote.published) {
            const compiled = compileSubflow(local.draft, local.configuration, remote.published, journeyEnabled(remote.published));
            const toStates = (doc) => Object.fromEntries(doc.settings.flow.states.map((s) => [s.id, s]));
            const live = diffStates(toStates(remote.published), toStates(compiled), (s) => s.name);
            lines.push(`   publish would change: ${live.length ? '' : 'nothing'}`, ...live.map((d) => `     ${d}`));
        } else {
            lines.push('   never published: publish would create the first version');
        }
        const sync = await readSync(t);
        if (sync && sync.draft !== hash(remote.draft)) {
            lines.push('   ⚠️ the Blip draft changed since the last pull (canvas edit?). Pull, or push with --force.');
        }
        lines.push(`   publish key (hosting): ${option('--hosting') ?? (await hostingIdentity(t))}`);
        return lines.join('\n');
    });
}

async function check() {
    const targets = await resolveTargets();
    await each(targets, async (t) => {
        const local = await readLocal(t);
        const problems = validationErrors(t, local.draft);
        const valid = problems.length ? `\n   ⚠️ ${problems.length} validation error(s):\n     ${problems.slice(0, 8).join('\n     ')}` : '';
        if (!local.published) return `⚪ ${t.id}: no local flow-published.json to compare with${valid}`;
        const compiled = compileSubflow(local.draft, local.configuration, local.published, journeyEnabled(local.published));
        const differences = deepDiff(compiled.settings.flow, local.published.settings.flow);
        if (differences.length === 0) return `✅ ${t.id}: compiled draft is identical to the published document${valid}`;
        return [`🟡 ${t.id}: ${differences.length} difference(s) (expected when the draft has unpublished changes)`]
            .concat(differences.slice(0, 15).map((d) => `     ${d}`))
            .join('\n') + valid;
    });
}

async function push() {
    const targets = await resolveTargets();
    await each(targets, async (t) => {
        const local = await readLocal(t);
        assertValid(t, local.draft);
        const remote = await fetchRemote(t);
        await assertNoConcurrentEdit(t, remote);
        await savePrevious(t, remote);
        await writeDraft(t, local);
        const after = await fetchRemote(t);
        if (canonical(after.draft) !== canonical(local.draft)) throw new Error('draft read back differs from what was sent');
        await writeSync(t, after);
        return `✅ ${t.id}: draft saved (not live)`;
    });
}

async function publish() {
    requireYes('publish');
    const targets = await resolveTargets();
    await each(targets, async (t) => {
        const local = await readLocal(t);
        assertValid(t, local.draft);
        const remote = await fetchRemote(t);
        await assertNoConcurrentEdit(t, remote);
        await savePrevious(t, remote);

        // 1. Draft first, exactly like the portal: the canvas must show what is live.
        await writeDraft(t, local);

        // 2. Compile the draft into the hosted application document and publish it.
        const journey = parseJourney() ?? journeyEnabled(remote.published) ?? true;
        const document = compileSubflow(local.draft, local.configuration, remote.published, journey, t.shortName);
        const key = option('--hosting') ?? (await hostingIdentity(t));
        await command_(t, 'set', `/subflows/${t.shortName}/publish`, {
            name: 'flow-published',
            document: JSON.stringify(document),
            key,
        });

        // 3. Read back and verify.
        const after = await fetchRemote(t);
        if (canonical(after.draft) !== canonical(local.draft)) throw new Error('draft read back differs from what was sent');
        if (canonical(after.published?.settings?.flow) !== canonical(document.settings.flow)) {
            throw new Error('published document read back differs from what was sent');
        }
        await writeLocal(t, after);
        await writeSync(t, after);
        return `🚀 ${t.id}: published (${document.settings.flow.states.length} states, key ${key})`;
    });
}

async function undo() {
    requireYes('undo');
    const targets = await resolveTargets();
    await each(targets, async (t) => {
        const dir = join(t.dir, FILES.previous);
        if (!existsSync(dir)) throw new Error(`nothing to undo: ${dir} does not exist`);
        const previous = {
            draft: await readJson(join(dir, FILES.draft)),
            configuration: await readJson(join(dir, FILES.configuration), null),
            published: await readJson(join(dir, FILES.published), null),
        };
        await writeDraft(t, previous);
        if (previous.published) {
            const key = option('--hosting') ?? (await hostingIdentity(t));
            await command_(t, 'set', `/subflows/${t.shortName}/publish`, {
                name: 'flow-published',
                document: JSON.stringify(previous.published),
                key,
            });
        }
        const after = await fetchRemote(t);
        await writeLocal(t, after);
        await writeSync(t, after);
        return `↩️  ${t.id}: draft${previous.published ? ' and publication' : ''} restored from ${FILES.previous}/`;
    });
}

// ---------------------------------------------------------------------------------------------
// Compiler: draft (canvas model) -> hosted application document.
// A faithful port of the Blip portal (portal.js: publishSubFlow -> TG.createModel(flow, config,
// flowId, 2) -> iV.createModel per state -> setUpFlow -> setStateActions -> cleanKeysStartingWithDolar).
// ---------------------------------------------------------------------------------------------
/** The hosted application document the portal sends as `flow-published`. */
function compileSubflow(draft, configuration, base, journey, shortName) {
    const flow = portalCompileSubflowFlow(base?.settings?.flow?.id ?? randomUUID(), draft, configuration, journey);
    const application = base
        ? structuredClone(base)
        : { identifier: shortName, accessKey: '', settings: {}, settingsType: 'Settings' };
    application.settings = { ...application.settings, flow };
    return application;
}

const journeyEnabled = (published) =>
    published ? JSON.stringify(published.settings?.flow?.states ?? []).includes('"TrackContactsJourney"') : undefined;
const parseJourney = () => {
    const v = option('--journey');
    return v === undefined ? undefined : v === 'on';
};

// ---------------------------------------------------------------------------------------------
// Blip I/O. Every command goes from the PARENT bot to postmaster@builder.msging.net.
// ---------------------------------------------------------------------------------------------
const botClients = new Map();
function botClient(parent) {
    if (!botClients.has(parent)) botClients.set(parent, blip.client.as(parent).incorporate());
    return botClients.get(parent);
}

async function command_(t, method, path, resource) {
    const bot = await botClient(t.parent);
    return bot.builder.sendCommand(
        { method, uri: { path, query: new Map() }, ...(resource ? { type: DOC_TYPE, resource } : {}) },
        { to: BUILDER },
    );
}

const parseDoc = (r) => (r?.document === undefined ? null : typeof r.document === 'string' ? JSON.parse(r.document) : r.document);

async function getConfig(t, name) {
    try {
        return parseDoc(await command_(t, 'get', `/subflows/${t.shortName}/configurations/${name}`));
    } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
    }
}

async function fetchRemote(t) {
    const [meta, draft, configuration, published] = await Promise.all([
        command_(t, 'get', `/subflows/${t.shortName}`),
        getConfig(t, 'edited-flow'),
        getConfig(t, 'edited-configurations'),
        getConfig(t, 'flow-published'),
    ]);
    if (!draft) throw new Error(`subflow "${t.shortName}" has no draft in ${t.parent}`);
    return { meta, draft, configuration, published };
}

async function writeDraft(t, docs) {
    await command_(t, 'set', `/subflows/${t.shortName}/publish`, { name: 'edited-flow', document: JSON.stringify(docs.draft), key: '' });
    if (docs.configuration) {
        await command_(t, 'set', `/subflows/${t.shortName}/publish`, {
            name: 'edited-configurations',
            document: JSON.stringify(docs.configuration),
            key: '',
        });
    }
}

/** <cluster>.builder.hosting@msging.net — the owner of the parent's "Application" configuration. */
const hostingCache = new Map();
async function hostingIdentity(t) {
    if (!hostingCache.has(t.parent)) {
        hostingCache.set(
            t.parent,
            (async () => {
                const bot = await botClient(t.parent);
                const configurations = await bot.account.getCallerConfigurations();
                const application = configurations.find((c) => c.name === 'Application' && !c.owner.startsWith('construction.'));
                if (!application?.owner) throw new Error(`could not discover the hosting identity of ${t.parent}; pass --hosting`);
                return application.owner;
            })(),
        );
    }
    return hostingCache.get(t.parent);
}

const isNotFound = (err) => err?.code === 67 || /not found/i.test(err?.message ?? '');

// ---------------------------------------------------------------------------------------------
// Discovery and targets
// ---------------------------------------------------------------------------------------------
async function discover({ remote = true } = {}) {
    if (!existsSync(FLOWS_DIR)) fail('No flows/ directory. Run "bbuilder pull" first.');
    const parents = (await fs.readdir(FLOWS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    const found = new Map();
    const collect = (parent, flow) => {
        for (const [stateId, state] of Object.entries(flow ?? {})) {
            if (typeof state?.shortNameOfSubflow === 'string' && state.shortNameOfSubflow) {
                const key = `${parent}/${state.shortNameOfSubflow}`;
                if (!found.has(key)) found.set(key, { parent, shortName: state.shortNameOfSubflow, stateId, title: state.$title });
            }
        }
    };
    await Promise.all(
        parents.map(async (parent) => {
            const file = join(FLOWS_DIR, parent, 'flow.json');
            if (existsSync(file)) collect(parent, await readJson(file));
            if (remote) {
                try {
                    collect(parent, await blip.client.as(parent).account.getBuilderFlow('working'));
                } catch {
                    // not a builder bot, or no access: the local file is all there is
                }
            }
        }),
    );
    return [...found.values()].sort((a, b) => `${a.parent}/${a.shortName}`.localeCompare(`${b.parent}/${b.shortName}`));
}

async function localTargets() {
    if (!existsSync(SUBFLOWS_DIR)) return [];
    const out = [];
    for (const parent of await fs.readdir(SUBFLOWS_DIR)) {
        const pdir = join(SUBFLOWS_DIR, parent);
        if (!(await fs.stat(pdir)).isDirectory()) continue;
        for (const shortName of await fs.readdir(pdir)) {
            if (existsSync(join(pdir, shortName, FILES.draft))) out.push({ parent, shortName });
        }
    }
    return out;
}

async function resolveTargets({ remote = false } = {}) {
    const known = remote ? await discover() : await localTargets();
    const pool = remote ? known : known.length ? known : await discover();
    const all = flags.has('--all');
    if (!all && positional.length === 0) fail('Give at least one target (<parent>/<subflow>, <subflow>, <parent>) or --all.');
    const picked = new Map();
    const add = (x) => picked.set(`${x.parent}/${x.shortName}`, x);
    if (all) pool.forEach(add);
    for (const p of positional) {
        const [a, b] = p.split('/');
        const matches = b
            ? pool.filter((x) => x.parent === a && x.shortName === b)
            : pool.filter((x) => x.shortName === a || x.parent === a);
        if (matches.length === 0) {
            if (b) add({ parent: a, shortName: b }); // explicit pair: trust it
            else fail(`No subflow matches "${p}". Run "list" (or "pull" first for local commands).`);
        }
        matches.forEach(add);
    }
    return [...picked.values()].map((x) => ({ ...x, id: `${x.parent}/${x.shortName}`, dir: join(SUBFLOWS_DIR, x.parent, x.shortName) }));
}

// ---------------------------------------------------------------------------------------------
// Local files
// ---------------------------------------------------------------------------------------------
async function readLocal(t) {
    const draftFile = join(t.dir, FILES.draft);
    if (!existsSync(draftFile)) throw new Error(`${draftFile} not found; run "pull ${t.id}" first`);
    return {
        draft: await readJson(draftFile),
        configuration: await readJson(join(t.dir, FILES.configuration), null),
        published: await readJson(join(t.dir, FILES.published), null),
    };
}

async function writeLocal(t, remote) {
    await fs.mkdir(t.dir, { recursive: true });
    await writeJson(join(t.dir, FILES.draft), remote.draft);
    if (remote.configuration) await writeJson(join(t.dir, FILES.configuration), remote.configuration);
    if (remote.published) await writeJson(join(t.dir, FILES.published), remote.published);
    if (remote.meta) await writeJson(join(t.dir, FILES.meta), remote.meta);
}

async function savePrevious(t, remote) {
    const dir = join(t.dir, FILES.previous);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await writeJson(join(dir, FILES.draft), remote.draft);
    if (remote.configuration) await writeJson(join(dir, FILES.configuration), remote.configuration);
    if (remote.published) await writeJson(join(dir, FILES.published), remote.published);
}

const readSync = (t) => readJson(join(t.dir, FILES.sync), null);
const writeSync = (t, remote) =>
    writeJson(join(t.dir, FILES.sync), {
        at: new Date().toISOString(),
        draft: hash(remote.draft),
        configuration: hash(remote.configuration),
        published: hash(remote.published),
    });

async function assertNoConcurrentEdit(t, remote) {
    if (flags.has('--force')) return;
    const sync = await readSync(t);
    if (sync && sync.draft !== hash(remote.draft)) {
        throw new Error(
            'the Blip draft changed since the last pull (someone saved it in the canvas). ' +
                'Run "diff", then "pull" to take their change, or repeat with --force to overwrite it.',
        );
    }
}

function assertValid(t, draft) {
    const all = validationErrors(t, draft);
    if (all.length && !flags.has('--force')) {
        throw new Error(`${all.length} validation error(s), use --force to write anyway:\n       ${all.slice(0, 8).join('\n       ')}`);
    }
}

function validationErrors(t, draft) {
    // bbuilder's validator speaks the minified dialect; a subflow draft is the full canvas model,
    // so minify it first. Keys the schema does not know (canvas bookkeeping such as $$hashKey,
    // or the subflow-only "end" flag) are not runtime errors and are ignored.
    const errors = validateFlow(minifyFlow(structuredClone(draft)), t.id).filter(
        (f) => f.severity === 'error' && !/Unrecognized key/.test(f.message),
    );
    const subflowErrors = validateSubflowRules(draft);
    return [...errors.map((f) => `[${f.stateId ?? '-'}] ${f.message} (${f.rule})`), ...subflowErrors];
}

/** The portal's own subflow rules (portal.js, class IG). */
function validateSubflowRules(draft) {
    const errors = [];
    const ids = new Set(Object.keys(draft));
    for (const [id, s] of Object.entries(draft)) {
        for (const out of [...(s.$conditionOutputs ?? []), s.$defaultOutput].filter(Boolean)) {
            if (out.stateId && !ids.has(out.stateId)) errors.push(`[${id}] output goes to "${out.stateId}", which is not a state of this subflow`);
        }
        for (const out of s.$conditionOutputs ?? []) {
            for (const c of out.conditions ?? []) {
                if (c.source !== 'input' && c.source !== 'context') errors.push(`[${id}] subflows only support input/context output conditions (got "${c.source}")`);
            }
        }
        for (const a of [...(s.$enteringCustomActions ?? []), ...(s.$leavingCustomActions ?? [])]) {
            if (a.type === 'ProcessContentAssistant' || (id !== 'end' && a.type === 'Redirect')) {
                errors.push(`[${id}] subflows do not support ${a.type} here`);
            }
        }
    }
    return errors;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
async function each(targets, fn) {
    const failures = [];
    await Promise.all(
        targets.map(async (t) => {
            try {
                console.log(await fn(t));
            } catch (err) {
                failures.push(t.id);
                console.error(`❌ ${t.id}: ${err?.message ?? err}`);
            }
        }),
    );
    for (const p of await Promise.all(botClients.values()).catch(() => [])) await p?.close?.();
    if (failures.length) {
        console.error(`\n${failures.length} of ${targets.length} failed: ${failures.join(', ')}`);
        process.exitCode = 1;
    }
}

function diffStates(before, after, title) {
    const out = [];
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!(id in before)) out.push(`+ ${id} "${title(after[id])}"`);
        else if (!(id in after)) out.push(`- ${id} "${title(before[id])}"`);
        else if (canonical(before[id]) !== canonical(after[id])) {
            const was = title(before[id]);
            const now = title(after[id]);
            out.push(`~ ${id} "${now}"${was !== now ? ` (was "${was}")` : ''}`);
        }
    }
    return out;
}

function deepDiff(a, b, path = '', out = []) {
    if (canonical(a) === canonical(b)) return out;
    if (Array.isArray(a) && Array.isArray(b) && path.endsWith('.states')) {
        const ia = Object.fromEntries(a.map((s) => [s.id, s]));
        const ib = Object.fromEntries(b.map((s) => [s.id, s]));
        return deepDiff(ia, ib, path, out);
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], `${path}.${k}`, out);
    } else {
        out.push(`${path}: compiled=${JSON.stringify(a)?.slice(0, 100)} | published=${JSON.stringify(b)?.slice(0, 100)}`);
    }
    return out;
}

function canonical(v) {
    const norm = (x) =>
        Array.isArray(x)
            ? x.map(norm)
            : x && typeof x === 'object'
              ? Object.fromEntries(Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => [k, norm(x[k])]))
              : x;
    return JSON.stringify(norm(v ?? null));
}

const hash = (v) => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 16);
const readJson = async (file, fallback) => {
    if (fallback !== undefined && !existsSync(file)) return fallback;
    return JSON.parse(await fs.readFile(file, 'utf-8'));
};
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

function requireYes(what) {
    if (!flags.has('--yes')) fail(`"${what}" changes what real users get. Repeat with --yes to confirm.`);
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Entry point (last, so every const above is initialised)
// ---------------------------------------------------------------------------------------------
const commands = { list, pull, diff, check, push, publish, undo };
if (!commands[command]) fail(`Unknown command "${command}".\n\n${HELP}`);
await commands[command]();
