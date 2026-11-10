#!/usr/bin/env node
// Patches @whitewall/blip-sdk so that `bbuilder publish` / `bbuilder rollback` build the runtime
// document exactly like the Blip portal does (portal-compiler.mjs), instead of the SDK's own
// simplified compilation.
//
// Why: the SDK (0.0.193) drops `shortNameOfSubflow` from subflow blocks (Blip then REJECTS the
// publication: "The given key 'shortNameOfSubflow' was not present in the dictionary"), and it
// also drops TrackContactsJourney, the automatic state TrackEvent ("builder:stateTrack") and the
// #stateId/#stateName message metadata the portal injects.
//
// Idempotent and updatable: everything injected lives between markers and is replaced on rerun.
// Run from the project root (wired as "postinstall" in package.json):
//   node .claude/skills/blip-subflows/scripts/patch-blip-sdk.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = join(process.cwd(), 'node_modules', '@whitewall', 'blip-sdk', 'dist');
const FILES = [join(SDK, 'esm', 'namespaces', 'account.js'), join(SDK, 'cjs', 'namespaces', 'account.js')];
const CHECK = process.argv.includes('--check');

const BEGIN = '/* <bbuilder-portal-compiler> */';
const END = '/* </bbuilder-portal-compiler> */';
const CALL = '/* bbuilder-portal-compiler:call */';
const ORIGINAL_START = 'publishedFlowConfiguration.settings.flow = JSON.parse(JSON.stringify({';
const ORIGINAL_END = "}, (key, value) => (key.startsWith('$') ? undefined : value)));";
const REPLACEMENT =
    'publishedFlowConfiguration.settings.flow = portalCompileFlow(flowId, flow, configuration, globalActions, ' +
    `typeof process === 'undefined' || process.env.BLIP_TRACK_CONTACTS_JOURNEY !== 'false'); ${CALL}`;

if (!existsSync(SDK)) {
    console.log('patch-blip-sdk: @whitewall/blip-sdk not installed, nothing to patch');
    process.exit(0);
}

const compiler = readFileSync(join(HERE, 'portal-compiler.mjs'), 'utf-8').replace(/^export /gm, '');
const block = `\n${BEGIN}\n${compiler}\n${END}\n`;

let failures = 0;
for (const file of FILES) {
    if (!existsSync(file)) continue;
    let src = readFileSync(file, 'utf-8');
    const before = src;

    // 1. the compile call inside publishBuilderFlow
    if (!src.includes(CALL)) {
        const start = src.indexOf(ORIGINAL_START);
        const end = start >= 0 ? src.indexOf(ORIGINAL_END, start) : -1;
        if (start < 0 || end < 0) {
            console.error(`❌ patch-blip-sdk: ${file}: publishBuilderFlow has an unknown shape (SDK changed?). Not patched.`);
            failures++;
            continue;
        }
        src = src.slice(0, start) + REPLACEMENT + src.slice(end + ORIGINAL_END.length);
    }

    // 2. the compiler itself, appended (function declarations are hoisted; consts are read at call time)
    const b = src.indexOf(BEGIN);
    const e = src.indexOf(END);
    src = b >= 0 && e > b ? src.slice(0, b).trimEnd() + block + src.slice(e + END.length).replace(/^\n/, '') : `${src.trimEnd()}${block}`;

    if (src === before) {
        console.log(`✔️  patch-blip-sdk: ${file.replace(process.cwd(), '.')} already patched`);
    } else if (CHECK) {
        console.error(`❌ patch-blip-sdk: ${file.replace(process.cwd(), '.')} is NOT patched (run without --check)`);
        failures++;
    } else {
        writeFileSync(file, src);
        console.log(`✅ patch-blip-sdk: ${file.replace(process.cwd(), '.')} patched`);
    }
}
process.exit(failures ? 1 : 0);
