#!/usr/bin/env node
// Patches bbuilder (0.0.13) so `push` and `publish` act only on the flows you name:
//
//   bbuilder publish devsituacoesnaentrega            # one flow
//   bbuilder publish devorcamento devmenuajuda1       # several
//   bbuilder publish --all                            # every flow in flows/ (old behaviour, now explicit)
//   bbuilder publish                                  # refused: say which flows, or --all
//
// The same applies to `bbuilder push`. `bbuilder test --publish` keeps publishing everything
// (it now passes --all explicitly). Validation runs only on the selected flows.
//
// Idempotent and updatable (marker blocks). Fails loudly when bbuilder's code has an unknown
// shape (new version), instead of patching blindly. Run from the project root (postinstall):
//   node .agents/skills/blip-subflows/scripts/patch-bbuilder.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'node_modules', 'bbuilder', 'dist');
const CHECK = process.argv.includes('--check');
const BEGIN = '/* <bbuilder-select-flows> */';
const END = '/* </bbuilder-select-flows> */';

if (!existsSync(DIST)) {
    console.log('patch-bbuilder: bbuilder not installed, nothing to patch');
    process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// New code
// ---------------------------------------------------------------------------------------------
const WRITE_EVERY_BUILDER = `${BEGIN}
/**
 * Which flows a push/publish acts on: the identifiers given, or every flow with --all.
 * Neither is refused, so a bare "bbuilder publish" can no longer put the whole router live.
 * Returns undefined for "all".
 */
export function resolveSelection(verb, identifiers, all) {
    const ids = [...new Set(identifiers ?? [])];
    if (all && ids.length > 0) {
        throw new CommandError(\`Use either flow identifiers or --all, not both.\`);
    }
    if (!all && ids.length === 0) {
        throw new CommandError(\`Say which flows to \${verb}: "bbuilder \${verb} <identifier> [identifier...]" (folder names in flows/), or "bbuilder \${verb} --all" for every flow.\`);
    }
    return all ? undefined : ids;
}
/**
 * Sends the selected local subbots to Blip, which is all \`push\` and \`publish\` differ on.
 *
 * A subbot Blip rejects is reported without stopping the others: they are
 * independent, and running the command again finishes what did not get through.
 * The command still exits non-zero, because a router left part new and part old
 * is not a success. \`only\` undefined means every flow in flows/.
 */
export async function writeEveryBuilder(verb, force, write, only) {
    const everything = await readBuilders();
    let builders = everything;
    if (only !== undefined) {
        const unknown = only.filter(identifier => !(identifier in everything));
        if (unknown.length > 0) {
            throw new CommandError(\`No flows/<identifier>/flow.json for: \${unknown.join(', ')}. Available: \${Object.keys(everything).join(', ')}\`);
        }
        builders = Object.fromEntries(only.map(identifier => [identifier, everything[identifier]]));
    }
    if (!force) {
        assertFlowsAreValid(builders);
    }
    const blip = new Blip();
    const working = only === undefined
        ? await blip.getBuilders()
        : Object.assign({}, ...(await Promise.all(only.map(identifier => blip.getBuilders('working', identifier)))));
    const selected = Object.keys(builders);
    console.log(\`\${verb === 'publish' ? 'Publishing' : 'Pushing'} \${selected.length} of \${Object.keys(everything).length} flow(s): \${selected.join(', ')}\`);
    await applyToEach(builders, async (identifier, local) => {
        await write(blip, identifier, resolveBuilderDocuments(identifier, local, working[identifier]));
        return verb === 'publish' ? \`🚀 Published \${identifier}\` : \`✅ \${identifier}\`;
    });
}
${END}`;

const command = (verb, description, writeCall) => `${BEGIN}
import { Command, Option } from 'commander';
import { createCommand, resolveSelection, writeEveryBuilder } from './shared/index.js';
export const ${verb}Command = new Command('${verb}')
    .description('${description}')
    .argument('[identifiers...]', 'the flows to ${verb} (folder names in flows/); required unless --all')
    .addOption(new Option('--all', '${verb} every flow in flows/'))
    .addOption(new Option('--force', '${verb} even when validation fails'))
    .action(createCommand(async (identifiers, options) => writeEveryBuilder('${verb}', options.force, ${writeCall}, resolveSelection('${verb}', identifiers, options.all)), '${verb === 'publish' ? 'Publish' : 'Push'} failed'));
${END}
`;

const PATCHES = [
    {
        file: 'commands/shared/flow-utils.js',
        original: 'export async function writeEveryBuilder(verb, force, write) {',
        apply(src) {
            if (src.includes(BEGIN)) return replaceBlock(src, WRITE_EVERY_BUILDER);
            const sig = src.indexOf(this.original);
            if (sig < 0) return null;
            const docStart = src.lastIndexOf('/**', sig);
            const end = src.indexOf('\n}\n', sig);
            if (end < 0) return null;
            const start = docStart >= 0 && src.slice(docStart, sig).includes('*/') ? docStart : sig;
            let out = src.slice(0, start) + WRITE_EVERY_BUILDER + src.slice(end + 2);
            if (!/import \{[^}]*CommandError[^}]*\} from '\.\/error-handler\.js';/.test(out)) {
                out = out.replace(/import \{([^}]*)\} from '\.\/error-handler\.js';/, (m, names) => `import {${names.trimEnd()}, CommandError } from './error-handler.js';`);
            }
            return out;
        },
    },
    {
        file: 'commands/publish.js',
        original: "writeEveryBuilder('publish', options.force,",
        apply(src) {
            if (!src.includes(BEGIN) && !src.includes(this.original)) return null;
            return command('publish', 'publish the given local flows (or --all), making them live for real users', '(blip, identifier, documents) => blip.publishBuilder(identifier, documents)');
        },
    },
    {
        file: 'commands/push.js',
        original: "writeEveryBuilder('push', options.force,",
        apply(src) {
            if (!src.includes(BEGIN) && !src.includes(this.original)) return null;
            return command('push', 'write the given local flows (or --all) to the working (draft) version in Blip', '(blip, identifier, documents) => blip.setWorkingBuilder(identifier, documents)');
        },
    },
    {
        file: 'commands/test.js',
        original: "[process.argv[1], 'publish']",
        apply(src) {
            if (src.includes("[process.argv[1], 'publish', '--all']")) return src;
            if (!src.includes(this.original)) return null;
            return src.replace(this.original, "[process.argv[1], 'publish', '--all']");
        },
    },
    {
        file: 'commands/shared/flow-utils.d.ts',
        original: 'export declare function writeEveryBuilder(verb: ',
        apply(src) {
            const decl =
                "export declare function resolveSelection(verb: 'push' | 'publish', identifiers: string[] | undefined, all: boolean | undefined): string[] | undefined;\n" +
                "export declare function writeEveryBuilder(verb: 'push' | 'publish', force: boolean, write: (blip: Blip, identifier: string, documents: BuilderDocuments) => Promise<void>, only?: string[]): Promise<void>;";
            if (src.includes('export declare function resolveSelection(')) return src;
            const line = src.split('\n').find((l) => l.startsWith(this.original));
            if (!line) return null;
            return src.replace(line, decl);
        },
    },
];

function replaceBlock(src, block) {
    const b = src.indexOf(BEGIN);
    const e = src.indexOf(END, b);
    return src.slice(0, b) + block + src.slice(e + END.length);
}

// ---------------------------------------------------------------------------------------------
let failures = 0;
for (const patch of PATCHES) {
    const file = join(DIST, patch.file);
    const label = `node_modules/bbuilder/dist/${patch.file}`;
    if (!existsSync(file)) {
        console.error(`❌ patch-bbuilder: ${label} not found (bbuilder changed?)`);
        failures++;
        continue;
    }
    const src = readFileSync(file, 'utf-8');
    const out = patch.apply(src);
    if (out === null) {
        console.error(`❌ patch-bbuilder: ${label} has an unknown shape (bbuilder changed?). Not patched.`);
        failures++;
    } else if (out === src) {
        console.log(`✔️  patch-bbuilder: ${label} already patched`);
    } else if (CHECK) {
        console.error(`❌ patch-bbuilder: ${label} is NOT patched (run without --check)`);
        failures++;
    } else {
        writeFileSync(file, out);
        console.log(`✅ patch-bbuilder: ${label} patched`);
    }
}
process.exit(failures ? 1 : 0);
