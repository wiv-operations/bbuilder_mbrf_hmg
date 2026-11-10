#!/usr/bin/env node
// Package entry point: installs the skill into a bbuilder project.
// The installer itself lives inside the skill (skill/blip-subflows/scripts/install.mjs), so a
// project that only received the skill folder can finish the installation on its own.
//
//   node install.mjs <path-to-bbuilder-project> [--dry-run] [--force]
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.argv.slice(2).some((a) => !a.startsWith('--'))) {
    console.error('Usage: node install.mjs <path-to-bbuilder-project> [--dry-run] [--force]');
    process.exit(1);
}
await import(pathToFileURL(join(here, 'skill', 'blip-subflows', 'scripts', 'install.mjs')).href);
