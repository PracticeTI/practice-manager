// Enrich & verify Equipment directory suppliers by visiting their live websites.
//
// For every supplier (published, draft, archived AND hidden) this script:
//   1. fetches the homepage (server-side, follows redirects)
//   2. asks the configured OpenAI model to extract a structured profile + a
//      legitimacy verdict from the page text
//   3. auto-applies confident changes through the admin API (full-record PATCH,
//      superadmin), including un-hiding suppliers that turn out to be real and
//      hiding published rows that are dead/parked/unrelated
//   4. appends a before/after row to a JSONL change log in local/
//
// Usage:
//   node scripts/enrich-equipment-suppliers.mjs --limit 6          # pilot: first 6
//   node scripts/enrich-equipment-suppliers.mjs --start 0 --limit 119
//   node scripts/enrich-equipment-suppliers.mjs --only aidacare.com.au,affectivehealth.com.au
//   node scripts/enrich-equipment-suppliers.mjs --dry              # log only, no PATCH
//
// Config comes from .env.local (provider API key + model, or AI_PROVIDER/AI_MODEL). The admin API is
// reached on http://localhost:3000 with the local dev superadmin bypass token.

import fs from 'node:fs'
import path from 'node:path'
import { generateChat } from '../src/lib/ai/chat.js'
import { resolveAiConfig } from '../src/lib/ai/credentials.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function loadEnv() {
    for (const file of ['.env.local', '.env']) {
        const filePath = path.join(ROOT, file)
        if (!fs.existsSync(filePath)) continue
        for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
            if (!match || process.env[match[1]] !== undefined) continue
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
        }
    }
}
loadEnv()

const BASE_URL = process.env.ENRICH_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.ENRICH_TOKEN || 'localhost-dev-admin-bypass-token'
// Provider + model come from the same registry the app uses.
const AI_CONFIG = resolveAiConfig()
const OPENAI_KEY = AI_CONFIG.hasApiKey ? AI_CONFIG.apiKey : ''
const MODEL = AI_CONFIG.model

const args = process.argv.slice(2)
const flagValue = (name, fallback) => {
    const index = args.indexOf(name)
    return index === -1 ? fallback : args[index + 1]
}
const LIMIT = Number.parseInt(flagValue('--limit', '119'), 10)
const START = Number.parseInt(flagValue('--start', '0'), 10)
const ONLY = String(flagValue('--only', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const DRY = args.includes('--dry')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(ROOT, 'local', `equipment-enrich-${stamp}.jsonl`)
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    })
    const data = await response.json().catch(() => ({}))
    return { response, data }
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}

function cleanHtml(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
}

async function fetchHomepage(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml',
            },
        })
        const html = await response.text()
        const title = String(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
        const meta = String(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)?.[1] || '').trim()
        const text = cleanHtml(html)
        return { ok: response.ok, status: response.status, finalUrl: response.url, title, meta, text, bytes: html.length }
    } catch (error) {
        return { ok: false, status: 0, finalUrl: url, title: '', meta: '', text: '', bytes: 0, error: error?.name || error?.message || 'fetch failed' }
    } finally {
        clearTimeout(timer)
    }
}

async function extractWithOpenAI({ supplier, page }) {
    if (!OPENAI_KEY) return null
    const snippet = `${page.meta}\n${page.text}`.slice(0, 6500)
    const system = [
        'You analyse Australian allied health / occupational therapy equipment supplier websites.',
        'You only return JSON. Never invent facts; base every field strictly on the page content provided.',
    ].join(' ')

    const user = [
        `Business name on record: ${supplier.supplier}`,
        `Website URL: ${page.finalUrl || supplier.website_url}`,
        `Current product_types: ${JSON.stringify(supplier.product_types || [])}`,
        `Current equipment_categories: ${JSON.stringify(supplier.equipment_categories || [])}`,
        '',
        'Page title: ' + (page.title || '(none)'),
        'Page text (truncated):',
        snippet,
        '',
        'Respond with ONLY this JSON object:',
        '{',
        '  "legitimate": boolean,',
        '  "supplierName": "actual business name shown on the site, or the on-record name",',
        '  "productTypes": ["short lowercase plural product nouns actually sold, e.g. \\"shower commodes\\", \\"ceiling hoists\\", \\"pressure mattresses\\", \\"scooters\\""],',
        '  "equipmentCategories": ["broad categories, e.g. Mobility, Bathroom, Seating, Pressure Care, Beds, Sensory, Continence, Orthotics, Home Modifications, Vehicle Modifications, Communication, Daily Living"],',
        '  "specialistEquipment": ["specialist items e.g. Bariatric, Prosthetics, Paediatric, Complex Rehab, Seating"],',
        '  "brands": ["brands they stock/make if visible"],',
        '  "description": "one or two factual sentences about who they are and what they supply",',
        '  "ndisRegistered": boolean|null,',
        '  "offersHire": boolean|null,',
        '  "homeTrials": boolean|null,',
        '  "repairs": boolean|null,',
        '  "delivery": boolean|null,',
        '  "quotes": boolean|null,',
        '  "geography": ["AU states covered or \\"Australia-wide\\""],',
        '  "funding": ["NDIS/TAC/Private/Other as shown"],',
        '  "phone": "",',
        '  "email": "",',
        '  "evidence": "one short sentence justifying the legitimate verdict"',
        '}',
        '',
        'Rules:',
        '- legitimate=false if the site is dead, parked/for-sale, a directory/social page, unrelated to equipment, or under construction.',
        '- legitimate=true only when it is a real business actively selling/supplying allied health equipment.',
        '- Empty arrays ([]) and empty strings when a value is not visible; do not fill from the on-record template.',
    ].join('\n')

    const run = async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 30000)
        try {
            const completion = await generateChat({
                ...AI_CONFIG,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                temperature: 0,
                maxOutputTokens: 900,
                signal: controller.signal,
            })
            if (!completion.ok) return null
            return String(completion.text || '').trim()
        } catch {
            return null
        } finally {
            clearTimeout(timer)
        }
    }

    const text = await run()
    if (!text) return null

    try {
        const cleaned = text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/\s*```$/g, '').trim()
        const parsed = JSON.parse(cleaned)
        return {
            legitimate: parsed.legitimate === true,
            supplierName: String(parsed.supplierName || '').trim() || supplier.supplier,
            productTypes: Array.isArray(parsed.productTypes) ? parsed.productTypes.map(String).filter(Boolean) : [],
            equipmentCategories: Array.isArray(parsed.equipmentCategories) ? parsed.equipmentCategories.map(String).filter(Boolean) : [],
            specialistEquipment: Array.isArray(parsed.specialistEquipment) ? parsed.specialistEquipment.map(String).filter(Boolean) : [],
            brands: Array.isArray(parsed.brands) ? parsed.brands.map(String).filter(Boolean) : [],
            description: String(parsed.description || '').trim(),
            ndisRegistered: parsed.ndisRegistered === true || parsed.ndisRegistered === false ? parsed.ndisRegistered : null,
            offersHire: parsed.offersHire === true || parsed.offersHire === false ? parsed.offersHire : null,
            homeTrials: parsed.homeTrials === true || parsed.homeTrials === false ? parsed.homeTrials : null,
            repairs: parsed.repairs === true || parsed.repairs === false ? parsed.repairs : null,
            delivery: parsed.delivery === true || parsed.delivery === false ? parsed.delivery : null,
            quotes: parsed.quotes === true || parsed.quotes === false ? parsed.quotes : null,
            geography: Array.isArray(parsed.geography) ? parsed.geography.map(String).filter(Boolean) : [],
            funding: Array.isArray(parsed.funding) ? parsed.funding.map(String).filter(Boolean) : [],
            phone: String(parsed.phone || '').trim(),
            email: String(parsed.email || '').trim(),
            evidence: String(parsed.evidence || '').trim(),
        }
    } catch {
        return null
    }
}

function writablePayload(supplier) {
    const payload = { ...supplier }
    for (const key of ['id', 'favorite_count', 'is_favorite', 'logo_url', 'created_at', 'updated_at']) delete payload[key]
    return payload
}

// Decide target status given current status + verdict.
function targetStatus(currentStatus, extracted) {
    const legit = extracted?.legitimate
    if (legit === true) {
        // Real business: keep/publish. Hidden or archived real suppliers come back live.
        return currentStatus === 'published' || currentStatus === 'admin_added' ? currentStatus : 'published'
    }
    if (legit === false) {
        // Dead/parked/unrelated: pull it out of the live catalog but keep it reversible.
        return currentStatus === 'published' ? 'hidden' : currentStatus
    }
    return currentStatus
}

async function enrichOne(supplier) {
    const website = String(supplier.website_url || '').trim()
    const host = hostnameOf(website)
    const started = Date.now()
    if (!host) {
        return { supplier, log: { verdict: 'no_website', note: 'No website URL on record; skipped' } }
    }

    const url = website.includes('://') ? website : `https://${website}`
    const page = await fetchHomepage(url)
    const changed = []

    // Cheap terminal verdicts that don't need an LLM call.
    if (!page.ok || page.bytes < 200 || page.text.length < 120) {
        const verdict = !page.ok ? `http_${page.status || 'error'}` : 'empty_page'
        const note = !page.ok ? (page.error || `HTTP ${page.status}`) : 'Page returned almost no content'
        const log = { verdict, note, changed, durationMs: Date.now() - started }
        return { supplier, log }
    }

    const extracted = await extractWithOpenAI({ supplier, page })
    if (!extracted) {
        return { supplier, log: { verdict: 'extract_failed', note: 'Fetched but OpenAI extraction failed; left unchanged', changed, durationMs: Date.now() - started } }
    }

    const next = writablePayload(supplier)

    // Profile fields only override the seed template when the site gave us something.
    if (extracted.productTypes.length > 0 && extracted.productTypes.join('|') !== (supplier.product_types || []).join('|')) {
        next.product_types = extracted.productTypes
        changed.push('product_types')
    }
    if (extracted.equipmentCategories.length > 0 && extracted.equipmentCategories.join('|') !== (supplier.equipment_categories || []).join('|')) {
        next.equipment_categories = extracted.equipmentCategories
        changed.push('equipment_categories')
    }
    if (extracted.specialistEquipment.length > 0 && extracted.specialistEquipment.join('|') !== (supplier.specialist_equipment || []).join('|')) {
        next.specialist_equipment = extracted.specialistEquipment
        changed.push('specialist_equipment')
    }
    if (extracted.brands.length > 0 && extracted.brands.join('|') !== (supplier.brands || []).join('|')) {
        next.brands = extracted.brands
        changed.push('brands')
    }
    if (extracted.description && extracted.description !== supplier.description) {
        next.description = extracted.description.slice(0, 400)
        changed.push('description')
    }
    if (extracted.email && extracted.email !== supplier.email) {
        next.email = extracted.email
        changed.push('email')
    }
    if (extracted.phone && extracted.phone !== supplier.phone) {
        next.phone = extracted.phone
        changed.push('phone')
    }
    if (extracted.geography.length > 0 && extracted.geography.join('|') !== (supplier.geography || []).join('|')) {
        next.geography = extracted.geography
        changed.push('geography')
    }
    if (extracted.funding.length > 0 && extracted.funding.join('|') !== (supplier.funding || []).join('|')) {
        next.funding = extracted.funding
        changed.push('funding')
    }
    if (extracted.ndisRegistered === true) {
        next.ndis_status = 'Registered'
        changed.push('ndis_status')
    }
    const boolMap = [['offersHire', 'hire_rental'], ['homeTrials', 'home_trials'], ['repairs', 'repairs'], ['delivery', 'delivery'], ['quotes', 'quotes']]
    for (const [from, to] of boolMap) {
        if (extracted[from] === true && next[to] !== true) {
            next[to] = true
            changed.push(to)
        }
    }

    const nextStatus = targetStatus(supplier.status, extracted)
    if (nextStatus !== supplier.status) {
        next.status = nextStatus
        changed.push(`status:${supplier.status}->${nextStatus}`)
    }

    const log = {
        verdict: extracted.legitimate ? 'legit' : 'not_supplier',
        evidence: extracted.evidence,
        supplierNameFromSite: extracted.supplierName,
        changed,
        durationMs: Date.now() - started,
    }

    let after = supplier
    if (changed.length > 0 && !DRY) {
        const { response, data } = await api(`/api/equipment/${supplier.id}`, {
            method: 'PATCH',
            body: JSON.stringify(next),
        })
        if (!response.ok) {
            log.patchError = data?.error || `HTTP ${response.status}`
            log.changed = [] // treat as not applied
        } else {
            after = data.supplier || next
        }
    }

    return { supplier, after, log }
}

function equalish(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
}

async function main() {
    if (!OPENAI_KEY) {
        console.error(`No ${AI_CONFIG.providerLabel} API key found in .env.local/.env`)
        process.exit(1)
    }
    const { data } = await api('/api/equipment/review')
    if (!data?.suppliers) {
        console.error(`Failed to load suppliers: ${data?.error || 'unexpected response'}`)
        process.exit(1)
    }

    let suppliers = data.suppliers.filter((s) => String(s.website_url || '').trim())
    if (ONLY.length) suppliers = suppliers.filter((s) => ONLY.includes(hostnameOf(s.website_url)))
    suppliers = suppliers.slice(START, START + LIMIT)

    console.log(`Enriching ${suppliers.length} suppliers (${DRY ? 'DRY RUN' : 'auto-apply'}) -> ${LOG_FILE}`)
    console.log(`Provider: ${AI_CONFIG.providerLabel} | Model: ${MODEL}`)

    const counters = {}
    let index = START
    for (const supplier of suppliers) {
        index += 1
        const { after, log } = await enrichOne(supplier)
        const host = hostnameOf(supplier.website_url)
        const verdict = log.verdict || 'error'
        counters[verdict] = (counters[verdict] || 0) + 1
        const summary = [
            `[${index}/${START + suppliers.length}]`,
            `${supplier.supplier} (${host})`,
            `status ${supplier.status} -> ${after?.status || supplier.status}`,
            `verdict=${verdict}`,
            log.evidence ? `evidence="${log.evidence}"` : '',
            log.changed?.length ? `changed=[${log.changed.join(', ')}]` : '(no change)',
            log.patchError ? `PATCH ERROR: ${log.patchError}` : '',
            `${log.durationMs || 0}ms`,
        ].filter(Boolean).join('  ')
        console.log(summary)

        const record = {
            ts: new Date().toISOString(),
            id: supplier.id,
            supplier: supplier.supplier,
            host,
            url: supplier.website_url,
            statusBefore: supplier.status,
            statusAfter: after?.status || supplier.status,
            verdict: verdict,
            evidence: log.evidence || log.note || '',
            changed: log.changed || [],
            patchError: log.patchError || null,
            before: {
                description: supplier.description,
                product_types: supplier.product_types,
                equipment_categories: supplier.equipment_categories,
                specialist_equipment: supplier.specialist_equipment,
                brands: supplier.brands,
                email: supplier.email,
                phone: supplier.phone,
            },
            after: after && !equalish(after, supplier) ? {
                description: after.description,
                product_types: after.product_types,
                equipment_categories: after.equipment_categories,
                specialist_equipment: after.specialist_equipment,
                brands: after.brands,
                email: after.email,
                phone: after.phone,
            } : null,
        }
        fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`)
    }

    console.log('\nCounters:', JSON.stringify(counters, null, 2))
    console.log(`Change log written to ${LOG_FILE}`)
}

main()
