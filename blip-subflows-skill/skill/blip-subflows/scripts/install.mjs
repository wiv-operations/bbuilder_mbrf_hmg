#!/usr/bin/env node
// Installs the blip-subflows skill into a bbuilder project. Idempotent: running it twice changes nothing.
// It lives INSIDE the skill, so a copy of the skill folder is enough to finish the installation:
//
//   node <skill>/scripts/install.mjs [<path-to-bbuilder-project>] [--dry-run] [--force]
//   (project defaults to the current directory)
//
// What it does (and nothing else):
//   1. copies the skill folder to <project>/.claude/skills/blip-subflows/ (skipped when it already runs from there)
//   2. adds "pull", "pull:subflows" and "postinstall" (SDK + bbuilder patches) to <project>/package.json
//   3. adds "subflows/**/.previous/" to <project>/.gitignore
//   4. adds the subflows section (between markers) and the skills-table row to <project>/CLAUDE.md
//   5. applies both patches once (node_modules/@whitewall/blip-sdk, node_modules/bbuilder), if installed
// It never talks to Blip, never runs pull/push/publish.
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(HERE);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const target = args.find((a) => !a.startsWith('--')) ?? process.cwd();
const project = resolve(target);

const PULL = 'bbuilder pull && npm run pull:subflows';
const PULL_SUBFLOWS = 'node .claude/skills/blip-subflows/scripts/subflows.mjs pull --all';
const POSTINSTALL_SDK = 'node .claude/skills/blip-subflows/scripts/patch-blip-sdk.mjs';
const POSTINSTALL_BBUILDER = 'node .claude/skills/blip-subflows/scripts/patch-bbuilder.mjs';
const IGNORE = 'subflows/**/.previous/';
const START = '<!-- blip-subflows:start -->';
const END = '<!-- blip-subflows:end -->';
const TABLE_ROW =
    '| `blip-subflows` | Subflows (`subflow:` states, `subflows/<parent>/<shortName>/`): pull, edit, push draft, publish one or many, undo |';

const log = (icon, msg) => console.log(`${icon} ${msg}`);
const write = async (file, content) => {
    if (!dryRun) await fs.writeFile(file, content);
};

// --- 0. preconditions ------------------------------------------------------------------------
const missing = ['bbuilder.json', 'package.json'].filter((f) => !existsSync(join(project, f)));
if (missing.length) {
    console.error(`${project} does not look like a bbuilder project (missing: ${missing.join(', ')}).`);
    process.exit(1);
}
const pkgFile = join(project, 'package.json');
const pkgText = await fs.readFile(pkgFile, 'utf-8');
const pkg = JSON.parse(pkgText);
const bbuilderVersion = pkg.dependencies?.bbuilder ?? pkg.devDependencies?.bbuilder;
if (!bbuilderVersion) log('⚠️ ', 'package.json does not depend on bbuilder; the skill needs it (npm install bbuilder).');
else if (bbuilderVersion !== '0.0.13') log('⚠️ ', `bbuilder ${bbuilderVersion}: the skill was validated with 0.0.13. Run "check --all" after installing.`);
if (!existsSync(join(project, 'node_modules', 'bbuilder'))) log('⚠️ ', 'node_modules/bbuilder not found: run "npm install" in the project.');
if (dryRun) log('🔍', 'dry run: nothing will be written');

// --- 1. skill files --------------------------------------------------------------------------
const skillSrc = SKILL_ROOT;
const skillDst = join(project, '.claude', 'skills', 'blip-subflows');
async function copyDir(src, dst) {
    if (!dryRun) await fs.mkdir(dst, { recursive: true });
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        const s = join(src, entry.name);
        const d = join(dst, entry.name);
        if (entry.isDirectory()) await copyDir(s, d);
        else if (!dryRun) await fs.copyFile(s, d);
    }
}
const samePlace = (await fs.realpath(skillSrc).catch(() => skillSrc)).toLowerCase() ===
    (await fs.realpath(skillDst).catch(() => skillDst)).toLowerCase();
if (samePlace) {
    log('✔️ ', `skill already in place at ${skillDst}`);
} else {
    await copyDir(skillSrc, skillDst);
    log(dryRun ? '🔍' : '✅', `skill ${dryRun ? 'would be copied' : 'copied'} to ${skillDst}`);
}

// --- 2. package.json scripts -----------------------------------------------------------------
pkg.scripts ??= {};
let pkgChanged = false;
for (const [name, value] of [['pull', PULL], ['pull:subflows', PULL_SUBFLOWS]]) {
    if (pkg.scripts[name] === value) {
        log('✔️ ', `package.json "${name}" already set`);
    } else if (pkg.scripts[name] && !force) {
        log('❌', `package.json already has "${name}": "${pkg.scripts[name]}". Not overwritten; merge it by hand or rerun with --force.`);
        process.exitCode = 1;
    } else {
        pkg.scripts[name] = value;
        pkgChanged = true;
        log('✅', `package.json "${name}": "${value}"`);
    }
}
// postinstall: applies both patches after every npm install. Chained, never replaced.
{
    let current = pkg.scripts.postinstall ?? '';
    const before = current;
    for (const step of [POSTINSTALL_SDK, POSTINSTALL_BBUILDER]) {
        const file = step.split('/').pop();
        if (!current.includes(file)) current = current ? `${current} && ${step}` : step;
    }
    if (current === before) {
        log('✔️ ', 'package.json "postinstall" already applies both patches');
    } else {
        pkg.scripts.postinstall = current;
        pkgChanged = true;
        log('✅', `package.json "postinstall": "${current}"`);
    }
}
if (pkgChanged) {
    const indent = pkgText.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
    await write(pkgFile, `${JSON.stringify(pkg, null, indent)}\n`);
}

// --- 3. .gitignore ---------------------------------------------------------------------------
const ignoreFile = join(project, '.gitignore');
const ignoreText = existsSync(ignoreFile) ? await fs.readFile(ignoreFile, 'utf-8') : '';
if (ignoreText.split(/\r?\n/).includes(IGNORE)) {
    log('✔️ ', `.gitignore already has ${IGNORE}`);
} else {
    await write(ignoreFile, `${ignoreText}${ignoreText && !ignoreText.endsWith('\n') ? '\n' : ''}${IGNORE}\n`);
    log('✅', `.gitignore += ${IGNORE}`);
}

// --- 4. CLAUDE.md ----------------------------------------------------------------------------
const claudeFile = join(project, 'CLAUDE.md');
let claude = existsSync(claudeFile) ? await fs.readFile(claudeFile, 'utf-8') : '';
const section = `${START}\n${(await fs.readFile(join(SKILL_ROOT, 'references', 'claude-md-section.md'), 'utf-8')).trim()}\n${END}`;
const before = claude;
if (claude.includes(START) && claude.includes(END)) {
    claude = claude.replace(new RegExp(`${START}[\\s\\S]*?${END}`), section);
} else {
    claude = `${claude.trimEnd()}\n\n${section}\n`;
}
// skills table row, right after the last existing "| `blip-..." row
if (!claude.includes('| `blip-subflows` |')) {
    const rows = [...claude.matchAll(/^\| `blip-[^`]+` \|.*$/gm)];
    if (rows.length) {
        const last = rows[rows.length - 1];
        const at = last.index + last[0].length;
        claude = `${claude.slice(0, at)}\n${TABLE_ROW}${claude.slice(at)}`;
    } else {
        log('⚠️ ', 'CLAUDE.md has no skills table; the section alone points agents to the skill.');
    }
}
if (claude === before) {
    log('✔️ ', 'CLAUDE.md already up to date');
} else {
    await write(claudeFile, claude);
    log('✅', 'CLAUDE.md updated (subflows section between markers, plus the skills-table row when a table exists)');
}
// Only command lines count ("bbuilder pull", "$ bbuilder pull", "npx bbuilder pull"), not prose
// that explains why plain "bbuilder pull" must not be used.
const plainPulls = claude
    .replace(new RegExp(`${START}[\\s\\S]*?${END}`), '')
    .split(/\r?\n/)
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*(\$\s*)?(npx\s+)?bbuilder pull\b(?!\s*&&)/.test(line));
if (plainPulls.length) {
    log('⚠️ ', 'CLAUDE.md still mentions plain "bbuilder pull" (replace with "npm run pull"):');
    for (const [n, line] of plainPulls) console.log(`      line ${n}: ${line.trim()}`);
}

// --- 5. apply the patches now (postinstall covers every later npm install) -----------------
if (!dryRun) {
    const { spawnSync } = await import('node:child_process');
    for (const [script, pkgDir, what] of [
        ['patch-blip-sdk.mjs', join('node_modules', '@whitewall', 'blip-sdk'), 'SDK'],
        ['patch-bbuilder.mjs', join('node_modules', 'bbuilder'), 'bbuilder'],
    ]) {
        if (!existsSync(join(project, pkgDir))) {
            log('⚠️ ', `${what} not installed yet: "npm install" will apply its patch through postinstall.`);
            continue;
        }
        const r = spawnSync(process.execPath, [join(skillDst, 'scripts', script)], { cwd: project, encoding: 'utf-8' });
        process.stdout.write(r.stdout ?? '');
        process.stderr.write(r.stderr ?? '');
        if (r.status !== 0) {
            log('❌', `${what} patch failed: see the messages above before running "bbuilder publish".`);
            process.exitCode = 1;
        }
    }
}

console.log(`\nNext (in ${project}):
  bbuilder login                      # if not logged in yet
  node .claude/skills/blip-subflows/scripts/patch-blip-sdk.mjs --check   # SDK patch applied?
  node .claude/skills/blip-subflows/scripts/patch-bbuilder.mjs --check   # selective push/publish applied?
  bbuilder diff                       # make sure flows/ has no local edits you would lose
  npm run pull                        # flows/ + subflows/
  node .claude/skills/blip-subflows/scripts/subflows.mjs check --all   # must be ✅ (or 🟡 only for unpublished drafts)`);
