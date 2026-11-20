/**
 * Quote Writer trigger.
 *
 * The quote drafting itself runs inside the app, not in this worker service:
 * every line it writes is priced and validated against the app's curated NDIS
 * support catalogue and stored in the app's `patient_quotes` / `quote_items`
 * tables. Copying that catalogue here would create a second answer to "what is
 * the price limit for this support item?".
 *
 * So this module is only a trigger. On each cycle it POSTs to the app's
 * `POST /api/database/quotes/run-jobs`, which drains the `patient_quote_jobs`
 * queue. That keeps the scheduling story identical to every other worker while
 * the pricing logic stays in one place.
 *
 * Disabled unless QUOTE_WRITER_TRIGGER_URL is set. The app end also accepts a
 * Vercel Cron / manual call, so this is an optional convenience.
 *
 * Each tick also checks that the app's published NDIS catalogue is readable from
 * this service's database. That check only *warns*: the app republishes on its
 * next quote operation, so refusing to trigger would deadlock a fresh
 * environment. The point is to name the problem in the worker's logs instead of
 * letting the first draft fail quietly.
 */

import { describeNdisCatalogue, tryReadPublishedNdisCatalogue } from '../ndisCatalogue.js'

const DEFAULT_POLL_SECONDS = 120

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function getConfig() {
    const url = String(process.env.QUOTE_WRITER_TRIGGER_URL || '').trim()

    return {
        enabled: Boolean(url) && isTrue(process.env.QUOTE_WRITER_TRIGGER_ENABLED || 'false'),
        url,
        // Falls back to the shared service secret, so an app that already trusts
        // this worker needs no extra configuration.
        token: String(process.env.QUOTE_WRITER_TRIGGER_TOKEN || process.env.CORE_BACKEND_SECRET || '').trim(),
        pollSeconds: parsePositiveInt(process.env.QUOTE_WRITER_TRIGGER_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    }
}

function buildHeaders(token) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) {
        headers.Authorization = `Bearer ${token}`
    }
    return headers
}

/** Non-blocking: report the shared catalogue's state, warning when it is unreadable. */
async function inspectSharedCatalogue() {
    const result = await tryReadPublishedNdisCatalogue()
    if (result.ok) {
        return describeNdisCatalogue(result.catalogue)
    }

    console.warn(`[${new Date().toISOString()}] ${result.error}`)
    return null
}

/** One trigger call. Never throws: a scheduler tick must not crash the service. */
export async function runQuoteWriterTriggerCycle(options = {}) {
    const config = getConfig()

    if (!config.url) {
        return { skipped: true, reason: 'not-configured' }
    }
    if (!config.enabled && options.forceRun !== true) {
        return { skipped: true, reason: 'disabled' }
    }

    const catalogue = await inspectSharedCatalogue()

    try {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: buildHeaders(config.token),
            body: JSON.stringify({}),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || payload?.success === false) {
            return {
                skipped: false,
                ok: false,
                status: response.status,
                error: payload?.error || `Quote Writer trigger failed (HTTP ${response.status})`,
            }
        }

        return { skipped: false, ok: true, status: response.status, catalogue, result: payload?.result || null }
    } catch (error) {
        return { skipped: false, ok: false, error: error?.message || 'Quote Writer trigger failed' }
    }
}

export function startQuoteWriterTrigger() {
    const config = getConfig()

    if (!config.url) {
        console.log('QUOTE_WRITER_TRIGGER_URL not set - quote writer trigger is disabled')
        return () => { }
    }
    if (!config.enabled) {
        console.log('QUOTE_WRITER_TRIGGER_ENABLED=false - quote writer trigger is disabled')
        return () => { }
    }

    let stopped = false
    let timer = null

    const run = () => runQuoteWriterTriggerCycle()
        .then((result) => {
            if (result?.ok === false) {
                console.error(`[${new Date().toISOString()}] Quote Writer trigger failed: ${result.error}`)
            }
        })
        .catch((error) => console.error(`[${new Date().toISOString()}] Quote Writer trigger error: ${error?.message || error}`))

    run()
    timer = setInterval(() => {
        if (!stopped) run()
    }, config.pollSeconds * 1000)

    return () => {
        stopped = true
        if (timer) clearInterval(timer)
    }
}

export default { startQuoteWriterTrigger, runQuoteWriterTriggerCycle }
