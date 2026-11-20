// One-off script: looks up each equipment supplier's public contact email by
// fetching their website (and common contact-page paths) and extracting a
// business email address, then PATCHes it into the directory.
// Usage: node scripts/lookup-equipment-emails.mjs [--base-url http://localhost:3000]
const DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'
const baseUrlArgIndex = process.argv.indexOf('--base-url')
const BASE_URL = baseUrlArgIndex !== -1 ? process.argv[baseUrlArgIndex + 1] : 'http://localhost:3000'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const CONTACT_PATHS = ['', '/contact', '/contact-us', '/pages/contact', '/pages/contact-us', '/about/contact']
const REQUEST_TIMEOUT_MS = 9000
const REQUEST_DELAY_MS = 350

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const IGNORED_DOMAIN_SUBSTRINGS = [
    'sentry.io', 'wixpress.com', 'schema.org', 'w3.org', 'godaddy.com', 'cloudflare.com',
    'mailchimp.com', 'klaviyo.com', 'google.com', 'googleapis.com', 'facebook.com', 'apple.com',
    'example.com', 'yourdomain.com', 'shopify.com', 'sentry-cdn.com', 'wordpress.org',
    'mysite.com', 'wixsite.com', 'doe.com', 'xyz.com', 'stagheaddesigns.com', 'yourcompany.com',
]
const IGNORED_LOCAL_PARTS = ['webmaster', 'postmaster', 'noreply', 'no-reply', 'donotreply', 'unsubscribe', 'privacy']
const PREFERRED_LOCAL_PARTS = ['info', 'contact', 'sales', 'enquiries', 'enquiry', 'admin', 'hello', 'office']

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanEmail(email) {
    const match = String(email || '').match(EMAIL_PATTERN)
    return match ? match[0].toLowerCase() : ''
}

function isAcceptableEmail(email) {
    const normalized = cleanEmail(email)
    if (!normalized) return false
    const [localPart, domain] = normalized.split('@')
    if (!localPart || !domain) return false
    if (IGNORED_LOCAL_PARTS.includes(localPart)) return false
    if (IGNORED_DOMAIN_SUBSTRINGS.some((bad) => domain.includes(bad))) return false
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(domain)) return false
    return true
}

function pickBestEmail(candidates) {
    const unique = Array.from(new Set(candidates.map(cleanEmail).filter(Boolean))).filter(isAcceptableEmail)
    if (unique.length === 0) return null
    const preferred = unique.find((email) => PREFERRED_LOCAL_PARTS.includes(email.split('@')[0]))
    return preferred || unique[0]
}

async function fetchPageEmails(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        })
        if (!response.ok) return []
        const html = await response.text()
        const mailtoMatches = Array.from(html.matchAll(/mailto:([^"'?\s>]+)/gi)).map((match) => match[1])
        const textMatches = html.match(EMAIL_PATTERN) || []
        return [...mailtoMatches, ...textMatches]
    } catch {
        return []
    } finally {
        clearTimeout(timeout)
    }
}

async function findEmailForSupplier(websiteUrl) {
    let origin
    try {
        origin = new URL(websiteUrl).origin
    } catch {
        return null
    }

    for (const path of CONTACT_PATHS) {
        const candidates = await fetchPageEmails(`${origin}${path}`)
        await sleep(REQUEST_DELAY_MS)
        const best = pickBestEmail(candidates)
        if (best) return best
    }
    return null
}

async function main() {
    const listResponse = await fetch(`${BASE_URL}/api/equipment?admin=1`, {
        headers: { Authorization: `Bearer ${DEV_ADMIN_TOKEN}` },
    })
    const listData = await listResponse.json().catch(() => ({}))
    const suppliers = listData?.suppliers || []
    console.log(`Looking up emails for ${suppliers.length} suppliers ...`)

    const retryArgIndex = process.argv.indexOf('--retry')
    const retryNames = retryArgIndex !== -1
        ? process.argv[retryArgIndex + 1].split(',').map((name) => name.trim().toLowerCase())
        : null

    let found = 0
    let missing = 0
    for (const supplier of suppliers) {
        const isRetryTarget = retryNames?.includes(supplier.supplier.toLowerCase())
        if (retryNames && !isRetryTarget) continue
        if (!retryNames && String(supplier.email || '').trim()) continue
        if (!supplier.website_url) { missing += 1; continue }

        const email = await findEmailForSupplier(supplier.website_url)
        if (!email) {
            console.log(`- ${supplier.supplier}: no email found`)
            missing += 1
            continue
        }

        const response = await fetch(`${BASE_URL}/api/equipment/${supplier.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEV_ADMIN_TOKEN}` },
            body: JSON.stringify({ ...supplier, email }),
        })
        if (response.ok) {
            console.log(`+ ${supplier.supplier}: ${email}`)
            found += 1
        } else {
            const data = await response.json().catch(() => ({}))
            console.warn(`! ${supplier.supplier}: failed to save (${data?.error || response.status})`)
            missing += 1
        }
    }

    console.log(`Done. Found ${found}, missing ${missing}, total ${suppliers.length}.`)
}

main()
