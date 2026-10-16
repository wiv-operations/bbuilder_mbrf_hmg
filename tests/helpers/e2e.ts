import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import type { FlowTestBody } from 'bbuilder/test'

type TestContext = Parameters<FlowTestBody>[0]

// Massa de dados real fornecida pelo time (QAS). Ver cenarios_de_teste.md.
export const MASSA = {
    telefone: '31973122071',
    senha: 'Central@25',
    usuarios: ['bovino@uorak.com', 'bovinos@uorak.com'],
    emailFormatoInvalido: 'abc@',
    telefoneInvalido: '123',
    senhaIncorreta: 'SenhaErrada@00',
}

// Carrinho real fornecido pelo time, gravado nos extras do contato no lugar
// da montagem manual no catálogo Smart Sales.
export function smartsalesOrder(quantity = 3) {
    const unit = 173.28
    const total = Math.round(unit * quantity * 100) / 100
    return {
        discounts: [],
        cart: [
            {
                product: {
                    name: '[VERDE] Asa de Frango Sadia 1kg -Caixa c/12',
                    description: 'ASA INTEIRA FGO CONGELADO BDJ 1KG SADIACX 12KG PALLET 792KG',
                    originalValue: unit,
                    currentValue: unit,
                    category: 'Aves',
                    brand: 'Sadia',
                    unitType: 'un',
                    isEnable: true,
                    minQuantity: 1,
                    extras: null,
                    images: [
                        { imageUrl: 'https://brfsaprodutosprd.blob.core.windows.net/centralbrf/MKP_ASAB_31933.webp', order: 1 },
                    ],
                    packageType: null,
                    currentValueInfo: null,
                    additionalValueInfo: null,
                    sku: '000000000000031933-Z100',
                },
                quantity,
                extras: {},
                subtotal: total,
                total,
            },
        ],
        status: 'confirmed',
        subtotal: total,
        total,
        updatedAt: '2026-10-08T14:36:04.698Z',
    }
}

export function currentCart(quantity = 3) {
    return [
        {
            Name: '[VERDE] Asa de Frango Sadia 1kg -Caixa c/12',
            Description: 'ASA INTEIRA FGO CONGELADO BDJ 1KG SADIACX 12KG PALLET 792KG',
            Brand: 'Sadia',
            Category: 'Aves',
            Image: 'https://brfsaprodutosprd.blob.core.windows.net/centralbrf/MKP_ASAB_31933.webp',
            CurrentValue: 173.28,
            OriginalValue: 173.28,
            UnitType: 'un',
            MinQuantity: 0,
            Sku: '000000000000031933-Z100',
            Related: '',
            VariationFirst: 'undefined_undefined',
            VariationSecond: 'undefined_undefined',
            Quantity: quantity,
            ContactIdentity: '5531973122071@wa.gw.msging.net',
            Disclaimer:
                'This variable is legacy and will be removed in a later future, please use "contact.extras.smartsalesOrder" instead',
        },
    ]
}

export type Msg = { type: string; text: string; options: string[]; raw: unknown }

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '')

function summarize(message: { type: string; content: unknown }): Msg {
    const { type, content } = message
    const c: any = content
    if (type === 'text/plain') return { type, text: stripHtml(String(c)), options: [], raw: c }
    if (type === 'application/vnd.lime.select+json') {
        return { type, text: stripHtml(c?.text ?? ''), options: (c?.options ?? []).map((o: any) => o.text), raw: c }
    }
    if (type === 'application/json') {
        const i = c?.interactive
        if (i) {
            const rows = (i.action?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => r.title))
            const buttons = (i.action?.buttons ?? []).map((b: any) => b.reply?.title ?? b.title)
            const url = i.action?.parameters?.url
            const bodyText = stripHtml(i.body?.text ?? '')
            return {
                type: `interactive/${i.type}`,
                text: bodyText + (url ? ` [URL: ${url}]` : ''),
                options: [...rows, ...buttons],
                raw: c,
            }
        }
    }
    if (type === 'application/vnd.lime.collection+json') {
        const items = c?.items ?? []
        const opts = items.flatMap((it: any) => (it.options ?? []).map((o: any) => o.label?.value ?? o.text ?? ''))
        return { type, text: JSON.stringify(c).slice(0, 400), options: opts, raw: c }
    }
    return { type, text: JSON.stringify(c).slice(0, 600), options: [], raw: c }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class Run {
    readonly ctx: TestContext
    readonly id: string
    readonly file: string
    readonly transcript: Msg[] = []
    private started = Date.now()

    constructor(ctx: TestContext, id: string) {
        this.ctx = ctx
        this.id = id
        mkdirSync('docs/evidencias', { recursive: true })
        this.file = `docs/evidencias/${id}.log`
        writeFileSync(this.file, `# ${id} — ${new Date().toISOString()}\n# contato: ${this.identity}\n`)
    }

    get identity(): string {
        return (this.ctx.user.client as any).sender.session.localNode.toIdentity()
    }

    log(line: string) {
        const t = ((Date.now() - this.started) / 1000).toFixed(1).padStart(6)
        appendFileSync(this.file, `[${t}s] ${line}\n`)
    }

    /** Coleta mensagens até `quietMs` sem novidade (ou `maxMs` no total). */
    async collect(quietMs = 10000, maxMs = 120000): Promise<Msg[]> {
        const user: any = this.ctx.user
        const out: Msg[] = []
        const start = Date.now()
        let last = Date.now()
        while (Date.now() - start < maxMs) {
            if (user.failure) {
                this.log(`!! FALHA DO BOT: ${user.failure.message}`)
                const err = user.failure
                user.failure = null
                throw err
            }
            if (user.messages.length) {
                const m = summarize(user.messages.shift())
                out.push(m)
                this.transcript.push(m)
                this.log(`BOT  (${m.type}) ${m.text.replace(/\n/g, ' ⏎ ')}${m.options.length ? `  OPÇÕES: [${m.options.join(' | ')}]` : ''}`)
                last = Date.now()
                continue
            }
            if (Date.now() - last > quietMs && (out.length || Date.now() - start > quietMs * 2)) break
            await sleep(250)
        }
        if (!out.length) this.log('BOT  (nenhuma mensagem)')
        return out
    }

    async say(text: string, quietMs?: number, maxMs?: number): Promise<Msg[]> {
        this.log(`USER ${text}`)
        await this.ctx.user.send(text)
        return this.collect(quietMs, maxMs)
    }

    async setExtras(extras: Record<string, string>) {
        const client = this.ctx.bot.client.account
        const contact = await client.getContact(this.identity as any)
        await client.mergeContact({ identity: this.identity as any, extras: { ...(contact?.extras ?? {}), ...extras } })
        this.log(`SYS  extras gravados no contato: ${Object.keys(extras).join(', ')}`)
    }

    note(text: string) {
        this.log(`QA   ${text}`)
    }
}

export function has(msgs: Msg[], fragment: string | RegExp): Msg | undefined {
    return msgs.find(m =>
        typeof fragment === 'string' ? m.text.includes(fragment) || m.options.some(o => o.includes(fragment)) : fragment.test(m.text),
    )
}

export function expectMsg(run: Run, msgs: Msg[], fragment: string | RegExp, what: string): Msg {
    const m = has(msgs, fragment)
    run.log(`${m ? 'OK  ' : 'FAIL'} esperado: ${what}`)
    if (!m) throw new Error(`[${run.id}] Esperado: ${what} (${fragment}). Recebido: ${msgs.map(x => x.text.slice(0, 80)).join(' || ') || 'nada'}`)
    return m
}

export function lastMenu(msgs: Msg[]): Msg | undefined {
    return [...msgs].reverse().find(m => m.options.length)
}

/** Executa o Bloco A da seção 4: Olá → telefone → cliente/sim → email → senha → opt-in → menu inicial.
 *  Retorna o menu inicial (último menu recebido). */
export async function blocoA(run: Run, email: string): Promise<Msg> {
    await run.say('Olá', 15000)
    await run.say(MASSA.telefone, 15000)
    await run.say('Sim', 10000)
    await run.say(email, 10000)
    await run.say(MASSA.senha, 20000)
    const msgs = await run.say('Sim', 20000, 60000)
    const menu = lastMenu(msgs)
    if (!menu || !menu.options.some(o => o.toLowerCase().includes('oferta'))) {
        throw new Error(`[${run.id}] Menu inicial não encontrado após autenticação. Última mensagem: ${msgs[msgs.length - 1]?.text?.slice(0, 160)}`)
    }
    return menu
}
