#!/usr/bin/env node
// Comparar flows alterados no PR contra tests/coverage.json
// Uso: node scripts/check-coverage.mjs <base-sha>
//
// Sai com código 0 se:
//   - nenhum state foi alterado, OU
//   - todos os states alterados têm pelo menos um CT no mapa
// Sai com código 1 e lista os states não cobertos caso contrário.
//
// Imprime um resumo em markdown que o workflow pode postar como comentário no PR.

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const baseRef = process.argv[2] || 'origin/main'

// 1) Descobre quais arquivos de flow mudaram
let changed = ''
try {
    changed = execSync(`git diff --name-only ${baseRef}...HEAD -- 'flows/*/flow.json'`, { encoding: 'utf8' })
} catch (e) {
    console.error(`Não foi possível ler o diff contra ${baseRef}: ${e.message}`)
    process.exit(2)
}
const flowFiles = changed.trim().split('\n').filter(Boolean)
if (flowFiles.length === 0) {
    console.log('## Cobertura de testes\n\n✅ Nenhum `flow.json` foi alterado neste PR.')
    process.exit(0)
}

// 2) Carrega o mapa de cobertura
const coverage = JSON.parse(readFileSync('tests/coverage.json', 'utf8')).coverage

const sections = []
let missing = 0

for (const file of flowFiles) {
    const subbot = file.split('/')[1]
    const subbotCoverage = coverage[subbot]
    if (!subbotCoverage || subbotCoverage._) {
        sections.push(`- ⚠️ \`${subbot}\`: sem mapa de cobertura (não testável automaticamente).`)
        continue
    }
    // Pega os ids de state do commit anterior e do atual para detectar quais mudaram
    const beforeRaw = execSync(`git show ${baseRef}:${file} 2>/dev/null || echo '{}'`, { encoding: 'utf8' })
    const afterRaw = readFileSync(file, 'utf8')
    const before = safeParse(beforeRaw)
    const after = safeParse(afterRaw)
    const touched = diffStates(before, after)
    if (touched.length === 0) {
        sections.push(`- 🟢 \`${subbot}\`: arquivo mudou mas nenhum state de conteúdo mudou (position/anotações).`)
        continue
    }
    const rows = []
    for (const sid of touched) {
        const cts = subbotCoverage[sid]
        if (cts && cts.length) {
            rows.push(`  - \`${sid.slice(0, 20)}\` → coberto por ${cts.map(c => `**${c}**`).join(', ')}`)
        } else {
            rows.push(`  - \`${sid.slice(0, 20)}\` → ❌ sem CT no mapa`)
            missing++
        }
    }
    sections.push(`- 📝 \`${subbot}\` — ${touched.length} state(s) alterado(s):\n${rows.join('\n')}`)
}

const header = missing === 0
    ? '## Cobertura de testes\n\n✅ Todos os states alterados têm pelo menos um cenário de teste.'
    : `## Cobertura de testes\n\n❌ ${missing} state(s) alterado(s) **sem cobertura de teste**. Adicione um cenário em \`tests/jornadas.test.ts\` e atualize \`tests/coverage.json\` antes de pedir review.`

console.log(header + '\n\n' + sections.join('\n'))
process.exit(missing === 0 ? 0 : 1)

// ─── helpers ────────────────────────────────────────────────────────────────

function safeParse(raw) {
    try { return JSON.parse(raw) } catch { return {} }
}

/** Retorna os ids de state cujo conteúdo mudou (ignora apenas $position). */
function diffStates(before, after) {
    const ids = new Set([...Object.keys(before), ...Object.keys(after)])
    const touched = []
    for (const id of ids) {
        const a = stripNoise(before[id])
        const b = stripNoise(after[id])
        if (JSON.stringify(a) !== JSON.stringify(b)) touched.push(id)
    }
    return touched
}

function stripNoise(state) {
    if (!state || typeof state !== 'object') return state
    // ignora apenas mudanças de posição no canvas; qualquer outra chave conta
    const { $position, ...rest } = state
    return rest
}
