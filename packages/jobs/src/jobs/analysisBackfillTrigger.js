/**
 * FCA Analyst backfill trigger.
 *
 * The backfill itself runs in the app (`POST /api/database/patients/analysis/run-jobs`), not in this
 * worker service. Every analyst job must carry the domain's AI selection, and that selection lives in
 * the app - so a backfill that ran here would create jobs the analyst worker could only run on a
 * hardcoded default model. That is exactly how a scheduled backfill overwrote an analysis with
 * `gpt-5-mini` while the operator had a flagship model selected.
 *
 * So this module is only a trigger, keeping the scheduling story identical to every other worker
 * while the AI configuration stays in one place.
 *
 * Disabled unless ANALYSIS_BACKFILL_TRIGGER_URL is set. The app end also accepts a Vercel Cron call,
 * so this is an optional convenience.
 */

const DEFAULT_POLL_SECONDS = 3600

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function getConfig() {
    const url = String(process.env.ANALYSIS_BACKFILL_TRIGGER_URL || '').trim()

    return {
        enabled: Boolean(url) && isTrue(process.env.ANALYSIS_BACKFILL_TRIGGER_ENABLED || 'false'),
        url,
        // Falls back to the shared service secret, so an app that already trusts this worker needs no
        // extra configuration.
        token: String(process.env.ANALYSIS_BACKFILL_TRIGGER_TOKEN || process.env.CORE_BACKEND_SECRET || '').trim(),
        pollSeconds: parsePositiveInt(process.env.ANALYSIS_BACKFILL_TRIGGER_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        batchSize: parsePositiveInt(process.env.ANALYSIS_BACKFILL_TRIGGER_BATCH_SIZE, 5),
    }
}

function buildHeaders(token) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) {
        headers.Authorization = `Bearer ${token}`
    }
    return headers
}

/** One trigger call. Never throws: a scheduler tick must not crash the service. */
export async function runAnalysisBackfillTriggerCycle(options = {}) {
    const config = getConfig()

    if (!config.url) {
        return { skipped: true, reason: 'not-configured' }
    }
    if (!config.enabled && options.forceRun !== true) {
        return { skipped: true, reason: 'disabled' }
    }

    try {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: buildHeaders(config.token),
            body: JSON.stringify({ batch_size: config.batchSize }),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || payload?.success === false) {
            return {
                skipped: false,
                ok: false,
                status: response.status,
                error: payload?.error || `Analysis backfill trigger failed (HTTP ${response.status})`,
            }
        }

        return { skipped: false, ok: true, status: response.status, result: payload?.result || null }
    } catch (error) {
        return { skipped: false, ok: false, error: error?.message || 'Analysis backfill trigger failed' }
    }
}

export function startAnalysisBackfillTrigger() {
    const config = getConfig()

    if (!config.url) {
        console.log('ANALYSIS_BACKFILL_TRIGGER_URL not set - analyst backfill trigger is disabled')
        return () => { }
    }
    if (!config.enabled) {
        console.log('ANALYSIS_BACKFILL_TRIGGER_ENABLED=false - analyst backfill trigger is disabled')
        return () => { }
    }

    let stopped = false
    let timer = null

    const run = () => runAnalysisBackfillTriggerCycle()
        .then((result) => {
            if (result?.ok === false) {
                console.error(`[${new Date().toISOString()}] Analyst backfill trigger failed: ${result.error}`)
            }
        })
        .catch((error) => console.error(`[${new Date().toISOString()}] Analyst backfill trigger error: ${error?.message || error}`))

    run()
    timer = setInterval(() => {
        if (!stopped) run()
    }, config.pollSeconds * 1000)

    return () => {
        stopped = true
        if (timer) clearInterval(timer)
    }
}

export default { startAnalysisBackfillTrigger, runAnalysisBackfillTriggerCycle }
