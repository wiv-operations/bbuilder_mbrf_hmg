#!/usr/bin/env node
// Executa `bbuilder test` com retry quando a falha é por infraestrutura do Blip
// (ex.: Cassandra LocalQuorum = 0 réplicas vivas).
//
// Uso:
//   node scripts/test-with-retry.mjs [filtro-regex] [--max-retries N]
//
// Variáveis de ambiente:
//   BBUILDER_ACCESS_KEY     — chave de acesso para bbuilder login (obrigatória no CI)
//   TEST_EMAIL              — e-mail da conta Blip (obrigatório no CI)
//
// Sai com código 0 se a execução passou após algum retry.
// Sai com código 2 se a infra do Blip ficou indisponível em todas as tentativas
//   (os jobs do GitHub Actions podem usar isso para marcar como "neutral").

import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
let maxRetries = 2
const positional = []
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-retries') maxRetries = Number(args[++i])
    else positional.push(args[i])
}
const filter = positional[0]

const INFRA_SIGNATURES = [
    /Not enough replicas available/i,
    /LocalQuorum/i,
    /NoHostAvailableException/i,
    /UnavailableException/i,
    /ECONNREFUSED.*msging\.net/i,
]

async function runOnce() {
    const cmdArgs = ['test', '--purge']
    if (filter) cmdArgs.push('-t', filter)
    return new Promise((resolve) => {
        const proc = spawn('bbuilder', cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', chunk => { const s = chunk.toString(); process.stdout.write(s); stdout += s })
        proc.stderr.on('data', chunk => { const s = chunk.toString(); process.stderr.write(s); stderr += s })
        proc.on('close', code => resolve({ code, stdout, stderr }))
    })
}

function isInfraFailure(output) {
    return INFRA_SIGNATURES.some(re => re.test(output))
}

async function main() {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const t0 = Date.now()
        const { code, stdout, stderr } = await runOnce()
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
        if (code === 0) {
            console.log(`\n✅ Suite passed on attempt ${attempt} (${elapsed}s)`)
            process.exit(0)
        }
        const combined = stdout + stderr
        if (isInfraFailure(combined) && attempt <= maxRetries) {
            const waitMs = Math.min(60_000, 15_000 * attempt)
            console.warn(`\n⚠️  Attempt ${attempt} hit Blip infra issue. Retrying in ${waitMs / 1000}s …`)
            await new Promise(r => setTimeout(r, waitMs))
            continue
        }
        if (isInfraFailure(combined)) {
            console.error(`\n🔧 Blip infra remained unavailable after ${attempt} attempts.`)
            process.exit(2) // "neutral" para o CI tratar de forma diferente de teste quebrado
        }
        console.error(`\n❌ Suite failed on attempt ${attempt} (${elapsed}s)`)
        process.exit(1)
    }
}

main().catch(err => { console.error(err); process.exit(1) })
