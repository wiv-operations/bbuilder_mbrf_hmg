#!/usr/bin/env node
// Executa `bbuilder validate --json` e compara com .ci/validate-baseline.json.
// Falha (exit 1) somente se houver finding NOVO (que não esteja no baseline).
// Ignora o número total — o importante é não introduzir regressão.
//
// Uso:
//   node scripts/validate-against-baseline.mjs
//
// Para atualizar o baseline depois de corrigir erros:
//   node scripts/validate-against-baseline.mjs --update-baseline

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASELINE_PATH = '.ci/validate-baseline.json'
const update = process.argv.includes('--update-baseline')

// 1) Rodar bbuilder validate --json
let raw
try {
    raw = execSync('npx --no-install bbuilder validate --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
} catch (err) {
    // bbuilder validate retorna código ≠ 0 quando há erros, mas o JSON vai pro stdout
    raw = err.stdout?.toString() ?? ''
    if (!raw) {
        console.error('Falha ao executar bbuilder validate --json')
        process.exit(2)
    }
}

let report
try {
    report = JSON.parse(raw)
} catch (e) {
    console.error('Resposta do bbuilder validate não é JSON válido:', e.message)
    process.exit(2)
}

const findings = report.findings ?? []
const key = f => `${f.flow}::${f.stateId}::${f.rule}::${f.message}`

if (update) {
    const next = {
        generated_at: new Date().toISOString().slice(0, 10),
        note: 'Snapshot dos findings pré-existentes. Pre-commit e CI só reclamam de findings NOVOS.',
        summary: { errors: report.errors, warnings: report.warnings, total: findings.length },
        findings: findings.map(f => ({ severity: f.severity, rule: f.rule, flow: f.flow, stateId: f.stateId, message: f.message })),
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2))
    console.log(`✅ Baseline atualizado: ${findings.length} findings gravados em ${BASELINE_PATH}`)
    process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
    console.error(`❌ Baseline não encontrado em ${BASELINE_PATH}. Rode com --update-baseline para criar.`)
    process.exit(2)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const baselineKeys = new Set(baseline.findings.map(key))

const newFindings = findings.filter(f => !baselineKeys.has(key(f)))
const resolvedCount = baseline.findings.length - findings.filter(f => baselineKeys.has(key(f))).length

console.log(`bbuilder validate: ${report.errors} erros, ${report.warnings} warnings (baseline: ${baseline.summary.errors}/${baseline.summary.warnings}).`)
if (resolvedCount > 0) console.log(`✨ ${resolvedCount} finding(s) do baseline foi(ram) corrigido(s). Rode com --update-baseline quando quiser incorporar.`)

if (newFindings.length === 0) {
    console.log(`✅ Nenhum finding novo (${findings.length} total, todos no baseline).`)
    process.exit(0)
}

console.error(`\n❌ ${newFindings.length} finding(s) NOVO(S) — não presentes no baseline:\n`)
for (const f of newFindings) {
    const icon = f.severity === 'error' ? '✖' : '⚠'
    console.error(`  ${icon} [${f.flow} › ${f.stateId}] ${f.message} (${f.rule})`)
}
console.error('\nCorrija antes do commit ou, se o finding é aceitável, atualize o baseline com --update-baseline.')
process.exit(1)
