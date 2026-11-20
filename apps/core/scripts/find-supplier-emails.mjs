// Contact-page email pass: for every live (published) supplier missing an email, fetch
// likely contact/about pages and extract a mailto/address from the page HTML, then PATCH
// the best candidate via the superadmin API. Logs to local/find-emails-*.jsonl.
//
// Usage: node scripts/find-supplier-emails.mjs [--dry]

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const BASE_URL = process.env.ENRICH_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.ENRICH_TOKEN || 'localhost-dev-admin-bypass-token'
const DRY = process.argv.includes('--dry')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(ROOT, 'local', `find-emails-${stamp}.jsonl`)
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

const GOOD_LOCAL_PARTS = new Set([
    'info', 'sales', 'admin', 'orders', 'support', 'hello', 'enquiries', 'enquiry',
    'contact', 'service', 'accounts', 'customerservice', 'customer', 'team', 'hello',
    'shop', 'store',
])
const BAD_DOMAINS = [
    'example.com', 'yourdomain', 'sentry', 'wixpress.com', 'sentry.io', 'schema.org',
    'w3.org', 'domain.com', 'email.com', 'mail.com', 'gmail.com', 'hotmail.com',
    'outlook.com', 'yahoo.com', 'doe.com', 'example.org', 'example.net',
]
const BAD_LOCAL = ['noreply', 'no-reply', 'unsubscribe', 'donotreply', 'feedback']

function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}

function extractEmails(html, host) {
    const found = new Set()
    // mailto links
    for (const match of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
        const email = match[1].trim().toLowerCase()
        if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) found.add(email)
    }
    // bare addresses
    for (const match of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        const email = match[0].trim().toLowerCase()
        if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) found.add(email)
    }
    // score: host match first, then generic good local parts; drop junk
    const ranked = [...found]
        .filter((email) => {
            const local = email.split('@')[0]
            const domain = email.split('@')[1]
            if (BAD_LOCAL.some((bad) => local.includes(bad))) return false
            if (BAD_DOMAINS.some((bad) => domain.includes(bad))) return false
            return true
        })
        .sort((left, right) => {
            const score = (email) => {
                const domain = email.split('@')[1]
                let s = 0
                if (domain === host || domain.endsWith(`.${host}`) || host.endsWith(domain)) s += 100
                const local = email.split('@')[0]
                if (GOOD_LOCAL_PARTS.has(local)) s += 30
                if (local.includes('@')) s -= 50 // clearly an artifact
                return s
            }
            return score(right) - score(left)
        })
    return ranked[0] || ''
}

async function fetchRaw(url, timeoutMs = 10000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', Accept: 'text/html,*/*' },
        })
        const text = await response.text()
        return { ok: response.ok, status: response.status, text }
    } catch (error) {
        return { ok: false, status: 0, text: '', error: error?.name || 'fetch failed' }
    } finally {
        clearTimeout(timer)
    }
}

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: { Authorization: `Bearer ${TOKEN}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    return { response, data: await response.json().catch(() => ({})) }
}

function absolutize(href, base) {
    try {
        return new URL(href, base).href
    } catch {
        return ''
    }
}

// Find likely contact/about/enquiry page URLs linked from the homepage.
function discoverContactUrls(html, base) {
    const found = new Set()
    for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
        const url = absolutize(match[1], base)
        if (!url) continue
        if (/\/(contact|contact-us|enquir|about|connect|get-in-touch|help|contactus)/i.test(url)) found.add(url)
    }
    return [...found].slice(0, 4)
}

async function main() {
    const { data } = await api('/api/equipment/review')
    if (!data?.suppliers) {
        console.error(`Failed to load suppliers: ${data?.error || 'unexpected'}`)
        process.exit(1)
    }
    const onlyArg = process.argv.indexOf('--only')
    const only = onlyArg !== -1 ? String(process.argv[onlyArg + 1] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
    const targets = data.suppliers.filter((s) => s.status === 'published' && !String(s.email || '').trim())
        .filter((s) => only.length === 0 || only.includes(hostnameOf(s.website_url)))
    console.log(`Searching emails for ${targets.length} live suppliers without an email.`)

    let found = 0
    let unresolved = []
    for (const supplier of targets) {
        const website = String(supplier.website_url || '').trim()
        const host = hostnameOf(website)
        if (!host) continue
        const base = website.includes('://') ? website.replace(/\/+$/, '') : `https://${website}`

        const homepage = await fetchRaw(base)
        let email = homepage.ok ? extractEmails(homepage.text, host) : ''
        let status = homepage.ok ? 'homepage' : `http_${homepage.status || homepage.error || 'error'}`

        if (!email && homepage.ok) {
            const contactUrls = discoverContactUrls(homepage.text, base)
            for (const url of contactUrls) {
                const page = await fetchRaw(url)
                if (!page.ok) continue
                email = extractEmails(page.text, host)
                if (email) {
                    status = `found@${url.replace(base, '') || '/'}`
                    break
                }
            }
        }
        const record = { ts: new Date().toISOString(), id: supplier.id, supplier: supplier.supplier, host, status: email ? status : 'no_email_found', email }
        fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`)

        if (email && !DRY) {
            const id = supplier.id
            const payload = { ...supplier }
            for (const key of ['id', 'favorite_count', 'is_favorite', 'logo_url', 'created_at', 'updated_at']) delete payload[key]
            payload.email = email
            const { response, data: patchData } = await api(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            if (!response.ok) {
                record.patchError = patchData?.error || `HTTP ${response.status}`
                fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`)
                console.warn(`✗ ${supplier.supplier}: ${record.patchError}`)
                continue
            }
            found += 1
            console.log(`[ok] ${supplier.supplier} (${host}) -> ${email} (${status})`)
        } else {
            if (email) found += 1
            else unresolved.push(`${supplier.supplier} (${host}) [${status}]`)
            console.log(`${DRY ? '[dry]' : '[miss]'} ${supplier.supplier} (${host}) ${email ? `-> ${email} (${status})` : `no email (${status})`}`)
        }
    }
    console.log(`\nEmails found: ${found} / ${targets.length}`)
    if (unresolved.length) {
        console.log('Unresolved (form-only, bot-blocked, or email not on public pages):')
        for (const item of unresolved) console.log(`  - ${item}`)
    }
    console.log(`Log: ${LOG_FILE}`)
}

main()
