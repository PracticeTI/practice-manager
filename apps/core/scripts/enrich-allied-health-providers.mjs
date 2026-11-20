// Enrich & verify Provider directory records by visiting each provider's live website.
//
// Background: the directory was bootstrapped by scripts/seed-allied-health-providers.mjs,
// which stamped every record with one of a handful of per-profession "bucket" templates
// (description, professions, service types, age groups, NDIS status, funding, and the
// boolean flags). None of that was read from the provider's own site, so 110 of the 116
// rows shared just nine descriptions and every contact field was left empty.
//
// For each provider this script:
//   1. fetches the provider's own website homepage
//   2. asks the configured OpenAI model to extract a structured profile AND to classify
//      what the business actually is (therapy practice / equipment supplier / directory /
//      dead / unrelated)
//   3. for confirmed practice websites ONLY, replaces the template fields with site-derived
//      values, restricts them to the directory's existing filter vocabulary, and clears the
//      unverified ndis_status 'Registered' claim unless the site confirms registration
//   4. appends a before/after row to a JSONL change log in local/
//
// Nothing is written for a website that is dead/parked, is not a therapy practice, or that
// could not be read — those are only reported so they can be triaged separately.
// Record status is never changed by this script.
//
// Usage:
//   node scripts/enrich-allied-health-providers.mjs --limit 6 --dry   # pilot, log only
//   node scripts/enrich-allied-health-providers.mjs --start 0 --limit 116
//   node scripts/enrich-allied-health-providers.mjs --only teammed.com.au,otwarehouse.com.au
//   node scripts/enrich-allied-health-providers.mjs --exclude example.com.au
//   node scripts/enrich-allied-health-providers.mjs --concurrency 6
//
// Config comes from .env.local (provider API key + model, or AI_PROVIDER/AI_MODEL). The admin API is reached on
// http://localhost:3000 with the local dev superadmin bypass token.

import fs from 'node:fs'
import path from 'node:path'
import { generateChat } from '../src/lib/ai/chat.js'
import { resolveAiConfig } from '../src/lib/ai/credentials.js'
import { rewriteDescriptionTone } from '../src/lib/descriptionTone.js'

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
const LIMIT = Number.parseInt(flagValue('--limit', '500'), 10)
const START = Number.parseInt(flagValue('--start', '0'), 10)
const ONLY = String(flagValue('--only', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const EXCLUDE = String(flagValue('--exclude', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const DRY = args.includes('--dry')

// The directory filters match these fields by exact string, so the model's answers are
// restricted to the vocabulary already in use.
const ALLOWED_PROFESSIONS = [
    'Occupational Therapy', 'Physiotherapy', 'Speech Pathology', 'Podiatry', 'Psychology',
    'Dietetics', 'Exercise Physiology', 'Social Work', 'Audiology', 'Behaviour Support',
]
const ALLOWED_SERVICE_TYPES = ['Clinic-based', 'Home visits', 'Telehealth']
const ALLOWED_AGE_GROUPS = ['Paediatric', 'Adolescent', 'Adult', 'Older adult/Geriatric']
const ALLOWED_FUNDING = ['NDIS', 'Medicare', 'Private', 'Aged care (HCP/CHSP)', 'TAC', 'DVA', 'Workers compensation']
const ALLOWED_GEOGRAPHY = ['Australia-wide', 'VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']
const ALLOWED_REGISTRATION_BODIES = new Map([['ahpra', 'AHPRA']])

// Provider badges and registration claims are commonly rendered as logos whose label lives
// in alt/aria text (e.g. 'NDIS logo for Registered Provider'), so registration is detected
// from the whole page rather than left entirely to the model.
const NDIS_REGISTERED_RE = /\bndis\s+registered\b|\bregistered\s+(?:ndis\s+)?provider\b|\bregistered\s+(?:with|under)\s+the\s+ndis\b/i
const NDIS_NOT_REGISTERED_RE = /\bndis\b[^.]{0,40}\b(?:not|non)[-\s]?registered\b|\bndis\b[^.]{0,40}\bunregistered\b/i

function detectNdisRegistration(page) {
    const haystack = `${page.title} ${page.meta} ${page.altText} ${page.text} ${page.streamText}`.slice(0, 40000)
    if (NDIS_NOT_REGISTERED_RE.test(haystack)) return false
    return NDIS_REGISTERED_RE.test(haystack) ? true : null
}

// Minimum readable prose before we trust a page enough to let the model describe it. Below
// this the page is a JS shell, a bot-block or a stub, and guessing from it is worse than
// leaving the stored record untouched.
const MIN_PAGE_TEXT = 400

// Next.js App Router streams part of its markup inside self.__next_f.push([1,"..."]) calls,
// so the served body can be an almost-empty shell. Recover those string literals, then drop
// the React flight bookkeeping (chunk ids, element references) that comes with them.
function extractStreamedPayload(html) {
    const chunks = []
    for (const match of String(html || '').matchAll(/self\.__next_f\.push\(\[\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g)) {
        try {
            chunks.push(JSON.parse(`"${match[1]}"`))
        } catch {
            // Ignore malformed chunks rather than discarding the whole payload.
        }
    }
    return chunks.join('')
}

const RSC_NOISE_RE = /[$[\]{}<>]|="|static\/chunks|__next|crossOrigin|precedence|\bundefined\b/i

function stripRscNoise(text) {
    return String(text || '').split(/\s+/).filter((token) => !RSC_NOISE_RE.test(token)).join(' ')
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\.[A-Za-z]{2,}$/

// Cloudflare-obfuscated addresses arrive as the literal string '[email protected]'.
function saneEmail(value) {
    const email = String(value || '').trim()
    if (!email) return ''
    if (/\[email|protected\]|example\.(?:com|org)|yourdomain/i.test(email)) return ''
    return EMAIL_RE.test(email) ? email : ''
}

function sanePhone(value) {
    const phone = String(value || '').trim()
    if (!phone || !/^[\d\s()+.-]+$/.test(phone)) return ''
    const digits = (phone.match(/\d/g) || []).length
    return digits >= 6 && digits <= 15 ? phone : ''
}

const today = new Date().toISOString().slice(0, 10)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(ROOT, 'local', `provider-enrich-${stamp}.jsonl`)
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

function keepAllowed(values, allowed) {
    const byLower = new Map(allowed.map((value) => [value.toLowerCase(), value]))
    const seen = new Set()
    const result = []
    for (const value of values || []) {
        const canonical = byLower.get(String(value || '').trim().toLowerCase())
        if (!canonical || seen.has(canonical)) continue
        seen.add(canonical)
        result.push(canonical)
    }
    return result
}

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
        // Registration claims are frequently carried by logos ("NDIS logo for Registered
        // Provider"), so keep alt / aria-label text alongside the visible copy.
        const altText = Array.from(html.matchAll(/\b(?:alt|aria-label)=["']([^"']{2,120})["']/gi))
            .map((match) => match[1]).join(' . ')
        const text = cleanHtml(html)
        // Next.js App Router pages can stream part of their markup inside
        // self.__next_f.push([1,"..."]) calls. That is only ever used to supplement the
        // body copy, never to qualify a page on its own, since the payload also carries
        // React flight bookkeeping that looks like content if you only measure length.
        const streamText = stripRscNoise(cleanHtml(extractStreamedPayload(html)))
        return { ok: response.ok, status: response.status, finalUrl: response.url, title, meta, altText, text, streamText, bytes: html.length }
    } catch (error) {
        return { ok: false, status: 0, finalUrl: url, title: '', meta: '', altText: '', text: '', streamText: '', bytes: 0, error: error?.name || error?.message || 'fetch failed' }
    } finally {
        clearTimeout(timer)
    }
}

async function extractWithOpenAI({ provider, page }) {
    if (!OPENAI_KEY) return null
    // Server-rendered copy is prioritised; the streamed payload and label list follow so
    // they can never crowd out the visible text.
    const snippet = [
        page.meta,
        page.text.slice(0, 5000),
        page.streamText ? page.streamText.slice(0, 1500) : '',
        'Image and link labels: ' + page.altText.slice(0, 1200),
    ].filter(Boolean).join('\n').slice(0, 8000)
    const system = [
        'You analyse Australian allied health provider websites.',
        'You only return JSON. Never invent facts; base every field strictly on the page content provided.',
    ].join(' ')

    const user = [
        `Business name on record: ${provider.provider}`,
        `Website URL: ${page.finalUrl || provider.website_url}`,
        '',
        'Page title: ' + (page.title || '(none)'),
        'Page text (truncated):',
        snippet,
        '',
        'Respond with ONLY this JSON object:',
        '{',
        '  "kind": "practice" | "supplier" | "directory" | "dead" | "unrelated",',
        '  "providerName": "actual business name shown in the content, or the on-record name",',
        '  "description": "one or two factual sentences describing who they are and what they do, written in the third person",',
        '  "professions": ["from this list only: Occupational Therapy, Physiotherapy, Speech Pathology, Podiatry, Psychology, Dietetics, Exercise Physiology, Social Work, Audiology, Behaviour Support"],',
        '  "serviceTypes": ["from this list only: Clinic-based, Home visits, Telehealth"],',
        '  "ageGroups": ["from this list only: Paediatric, Adolescent, Adult, Older adult/Geriatric"],',
        '  "ndisRegistered": true | false | null,',
        '  "funding": ["from this list only: NDIS, Medicare, Private, Aged care (HCP/CHSP), TAC, DVA, Workers compensation"],',
        '  "geography": ["states served or \\"Australia-wide\\"; only when the content states it"],',
        '  "telehealth": true | false | null,',
        '  "homeVisits": true | false | null,',
        '  "referralRequired": true | false | null,',
        '  "acceptingNewClients": true | false | null,',
        '  "registrationBody": "e.g. NDIS, AHPRA, SWEP - only when named in the content",',
        '  "waitTime": "stated wait time, e.g. \\"2-3 weeks\\" - only when named in the content",',
        '  "phone": "practice phone number, else empty",',
        '  "email": "practice email address, else empty",',
        '  "evidence": "one short sentence justifying the kind verdict"',
        '}',
        '',
        'Rules:',
        '- kind="practice" only when the business delivers therapy/services to clients (a clinic, mobile therapist or allied health team).',
        '- kind="supplier" when it sells or hires equipment/products rather than delivering therapy.',
        '- kind="directory" when it is a listing/lead-generation site that advertises other providers.',
        '- kind="dead" when the page is a parked/for-sale/suspended/holding page or clearly empty.',
        '- kind="unrelated" when the site is not allied health at all.',
        '- Use [] and empty strings for anything the page does not state. Do not copy the on-record text.',
        '- Write the description as the directory describing the business directly. Never write "the site", "the website", "the page", "according to", or "X describes itself as Y" — the reader should see facts about the business, not where the facts came from.',
        '- ndisRegistered/telehealth/homeVisits/referralRequired/acceptingNewClients must be null unless the page supports the answer.',
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

    const tri = (value) => (value === true || value === false ? value : null)

    try {
        const cleaned = text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/\s*```$/g, '').trim()
        const parsed = JSON.parse(cleaned)
        const kind = String(parsed.kind || '').trim().toLowerCase()
        return {
            kind: ['practice', 'supplier', 'directory', 'dead', 'unrelated'].includes(kind) ? kind : 'unknown',
            providerName: String(parsed.providerName || '').trim() || provider.provider,
            description: String(parsed.description || '').trim(),
            professions: keepAllowed(parsed.professions, ALLOWED_PROFESSIONS),
            serviceTypes: keepAllowed(parsed.serviceTypes, ALLOWED_SERVICE_TYPES),
            ageGroups: keepAllowed(parsed.ageGroups, ALLOWED_AGE_GROUPS),
            ndisRegistered: tri(parsed.ndisRegistered),
            funding: keepAllowed(parsed.funding, ALLOWED_FUNDING),
            geography: keepAllowed(parsed.geography, ALLOWED_GEOGRAPHY),
            telehealth: tri(parsed.telehealth),
            homeVisits: tri(parsed.homeVisits),
            referralRequired: tri(parsed.referralRequired),
            acceptingNewClients: tri(parsed.acceptingNewClients),
            registrationBody: String(parsed.registrationBody || '').trim(),
            waitTime: String(parsed.waitTime || '').trim(),
            phone: String(parsed.phone || '').trim(),
            email: String(parsed.email || '').trim(),
            evidence: String(parsed.evidence || '').trim(),
        }
    } catch {
        return null
    }
}

// updateProvider is a full-record replace, so the whole row has to be sent back.
function writablePayload(provider) {
    const payload = { ...provider }
    for (const key of ['id', 'favorite_count', 'is_favorite', 'logo_url', 'created_at', 'updated_at']) delete payload[key]
    return payload
}

function sameList(a, b) {
    return JSON.stringify(a || []) === JSON.stringify(b || [])
}

async function enrichOne(provider) {
    const website = String(provider.website_url || '').trim()
    const host = hostnameOf(website)
    const started = Date.now()
    if (!host) {
        return { provider, log: { verdict: 'no_website', note: 'No website URL on record; skipped' } }
    }

    const url = website.includes('://') ? website : `https://${website}`
    const page = await fetchHomepage(url)

    // Cheap terminal verdicts that don't need an LLM call.
    if (!page.ok || page.bytes < 200 || page.text.length < MIN_PAGE_TEXT) {
        const verdict = !page.ok ? `http_${page.status || 'error'}` : 'thin_page'
        const note = !page.ok
            ? (page.error || `HTTP ${page.status}`)
            : `Only ${page.text.length} chars of readable text; page is likely a JS shell, stub or bot-block`
        return { provider, log: { verdict, note, textLength: page.text.length, changed: [], durationMs: Date.now() - started } }
    }

    const extracted = await extractWithOpenAI({ provider, page })
    if (!extracted) {
        return { provider, log: { verdict: 'extract_failed', note: 'Fetched but OpenAI extraction failed; left unchanged', changed: [], durationMs: Date.now() - started } }
    }

    // Only a confirmed therapy practice may overwrite the stored profile. Suppliers,
    // directories and dead sites are reported for review but never written to.
    if (extracted.kind !== 'practice') {
        return {
            provider,
            log: {
                verdict: extracted.kind,
                evidence: extracted.evidence,
                nameFromSite: extracted.providerName,
                changed: [],
                durationMs: Date.now() - started,
            },
        }
    }

    const next = writablePayload(provider)
    const ndisSignal = detectNdisRegistration(page)
    const changed = []
    const setIf = (field, value, keepStored = false) => {
        const current = provider[field]
        if (value === undefined || value === null) return
        if (keepStored && (Array.isArray(value) ? value.length === 0 : value === '')) return
        if (Array.isArray(value) ? sameList(current, value) : current === value) return
        next[field] = value
        changed.push(field)
    }

    // Page-derived description replaces the bucket template whenever the model gave us one.
    // Published copy is first-party, so any source framing is stripped before it is stored;
    // a description that still credits a website is reported instead of published.
    const description = rewriteDescriptionTone(extracted.description)
    const descriptionTone = !extracted.description
        ? 'none'
        : (description.unresolved ? 'unresolved' : (description.changed ? 'rewritten' : 'ok'))
    if (extracted.description && !description.unresolved) {
        setIf('description', description.text.slice(0, 400))
    }

    // These four exist purely as bucket defaults, so site silence clears them rather than
    // leaving a claim nobody verified.
    setIf('professions', extracted.professions)
    setIf('service_types', extracted.serviceTypes)
    setIf('age_groups', extracted.ageGroups)
    setIf('funding', extracted.funding)

    setIf('geography', extracted.geography, true)

    // ndis_status was hardcoded to 'Registered' for most buckets; keep it only when the page
    // supports registration, and only clear it when the page gives a real answer.
    const ndisRegistered = extracted.ndisRegistered === true || ndisSignal === true
        ? true
        : (extracted.ndisRegistered === false || ndisSignal === false ? false : null)
    setIf('ndis_status', ndisRegistered === true ? 'Registered' : '')
    // registration_body and typical_wait_time are VARCHAR(120) columns.
    setIf('registration_body', (ndisRegistered === true
        ? 'NDIS'
        : (ALLOWED_REGISTRATION_BODIES.get(extracted.registrationBody.toLowerCase()) || '')).slice(0, 120))
    setIf('typical_wait_time', extracted.waitTime.slice(0, 120))

    setIf('phone', sanePhone(extracted.phone), true)
    setIf('email', saneEmail(extracted.email), true)

    for (const [from, to] of [
        ['telehealth', 'telehealth'],
        ['homeVisits', 'home_visits'],
        ['referralRequired', 'referral_required'],
        ['acceptingNewClients', 'accepting_new_clients'],
    ]) {
        setIf(to, extracted[from] === true)
    }

    // We read the site today, so the verification date is a fact regardless of the rest.
    setIf('last_verified_at', today)

    const log = {
        verdict: 'practice',
        evidence: extracted.evidence,
        ndisSignal,
        textLength: page.text.length,
        nameFromSite: extracted.providerName,
        changed,
        durationMs: Date.now() - started,
        descriptionTone,
        // Only carried through when the description could not be made first-party.
        descriptionReview: description.unresolved,
        descriptionDraft: description.unresolved ? extracted.description : null,
    }

    let after = provider
    if (changed.length > 0) {
        if (DRY) {
            // Log the proposed values so a dry run can be reviewed in full.
            after = next
        } else {
            const { response, data } = await api(`/api/providers/${provider.id}`, {
                method: 'PATCH',
                body: JSON.stringify(next),
            })
            if (!response.ok) {
                log.patchError = data?.error || `HTTP ${response.status}`
                log.changed = [] // treat as not applied
            } else {
                after = data.provider || next
            }
        }
    }

    return { provider, after, log }
}

function equalish(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
}

const LOGGED_FIELDS = [
    'description', 'professions', 'service_types', 'age_groups', 'ndis_status', 'funding',
    'geography', 'telehealth', 'home_visits', 'referral_required', 'accepting_new_clients',
    'registration_body', 'typical_wait_time', 'phone', 'email', 'last_verified_at',
]

function pick(record) {
    return Object.fromEntries(LOGGED_FIELDS.map((field) => [field, record?.[field] ?? null]))
}

async function main() {
    if (!OPENAI_KEY) {
        console.error(`No ${AI_CONFIG.providerLabel} API key found in .env.local/.env`)
        process.exit(1)
    }
    const { data } = await api('/api/providers/review')
    if (!data?.providers) {
        console.error(`Failed to load providers: ${data?.error || 'unexpected response'}`)
        process.exit(1)
    }

    let providers = data.providers.filter((p) => String(p.website_url || '').trim())
    if (ONLY.length) providers = providers.filter((p) => ONLY.includes(hostnameOf(p.website_url)))
    if (EXCLUDE.length) providers = providers.filter((p) => !EXCLUDE.includes(hostnameOf(p.website_url)))
    providers = providers.slice(START, START + LIMIT)

    console.log(`Enriching ${providers.length} providers (${DRY ? 'DRY RUN' : 'auto-apply'}) -> ${LOG_FILE}`)
    console.log(`Provider: ${AI_CONFIG.providerLabel} | Model: ${MODEL}`)

    const counters = {}
    const needsReview = []
    const descriptionIssues = []
    let completed = 0
    const total = providers.length

    const handleOne = async (provider, position) => {
        const { after, log } = await enrichOne(provider)
        completed += 1
        const host = hostnameOf(provider.website_url)
        const verdict = log.verdict || 'error'
        counters[verdict] = (counters[verdict] || 0) + 1
        if (!['practice', 'extract_failed'].includes(verdict)) {
            needsReview.push({ id: provider.id, name: provider.provider, host, verdict, evidence: log.evidence || log.note || '' })
        }
        if (log.descriptionReview) {
            descriptionIssues.push({ id: provider.id, name: provider.provider, host, draft: log.descriptionDraft || '' })
        }

        console.log([
            `[${position}/${START + total}]`,
            `(${completed} done)`,
            `${provider.provider} (${host})`,
            `verdict=${verdict}`,
            log.evidence ? `evidence="${log.evidence}"` : '',
            log.changed?.length ? `changed=[${log.changed.join(', ')}]` : '(no change)',
            log.patchError ? `PATCH ERROR: ${log.patchError}` : '',
            `${log.durationMs || 0}ms`,
        ].filter(Boolean).join('  '))

        fs.appendFileSync(LOG_FILE, `${JSON.stringify({
            ts: new Date().toISOString(),
            id: provider.id,
            provider: provider.provider,
            host,
            url: provider.website_url,
            verdict,
            evidence: log.evidence || log.note || '',
            ndisSignal: log.ndisSignal ?? null,
            textLength: log.textLength ?? null,
            nameFromSite: log.nameFromSite || null,
            descriptionTone: log.descriptionTone || null,
            changed: log.changed || [],
            patchError: log.patchError || null,
            before: pick(provider),
            after: after && !equalish(after, provider) ? pick(after) : null,
        })}\n`)
    }

    // Bounded concurrency: every row costs one page fetch plus one model call, so a
    // sequential pass over the whole directory would take well over ten minutes.
    const CONCURRENCY = Math.max(1, Number.parseInt(flagValue('--concurrency', '4'), 10))
    const queue = providers.map((provider, offset) => ({ provider, position: START + offset + 1 }))
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
            const next = queue.shift()
            await handleOne(next.provider, next.position)
        }
    }))

    console.log('\nCounters:', JSON.stringify(counters, null, 2))
    if (descriptionIssues.length > 0) {
        console.log(`\n${descriptionIssues.length} description(s) still credited a website and were left unchanged:`)
        for (const item of descriptionIssues) {
            console.log(`  - ${item.name} (${item.host}): ${item.draft}`)
        }
    }
    if (needsReview.length > 0) {
        console.log(`\n${needsReview.length} record(s) are not confirmed therapy practices and were NOT modified:`)
        for (const item of needsReview) {
            console.log(`  - [${item.verdict}] ${item.name} (${item.host}) — ${item.evidence}`)
        }
    }
    console.log(`\nChange log written to ${LOG_FILE}`)
}

main()
