/**
 * Scheduling reminder trigger.
 *
 * Reminder rows, message rendering and delivery live in the app: they need the
 * appointment, patient and token-signing helpers that only the app owns. So
 * this module is only the clock. On each cycle it calls the app's
 * `POST /api/scheduling/reminders/run`, which claims due rows once and sends
 * them, so overlapping ticks are harmless.
 *
 * Disabled unless SCHEDULING_REMINDER_WORKER_ENABLED=true.
 */

const DEFAULT_POLL_SECONDS = 300
const DEFAULT_APP_API_URL = 'http://localhost:3000/api'

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function getConfig() {
    const appApiUrl = String(process.env.CORE_BACKEND_URL || DEFAULT_APP_API_URL)
        .trim()
        .replace(/\/+$/, '')
    const explicitUrl = String(process.env.SCHEDULING_REMINDER_RUN_URL || '').trim()

    return {
        enabled: isTrue(process.env.SCHEDULING_REMINDER_WORKER_ENABLED || 'false'),
        url: explicitUrl || `${appApiUrl}/scheduling/reminders/run`,
        // Falls back to the shared service secret, which the app also accepts.
        token: String(
            process.env.SCHEDULING_REMINDER_RUN_SECRET
            || process.env.CRON_SECRET
            || process.env.CORE_BACKEND_SECRET
            || ''
        ).trim(),
        domain: String(process.env.SCHEDULING_REMINDER_WORKER_DOMAIN || '').trim().toLowerCase(),
        pollSeconds: parsePositiveInt(process.env.SCHEDULING_REMINDER_WORKER_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    }
}

function buildRequestUrl(config) {
    if (!config.domain) return config.url
    const url = new URL(config.url)
    url.searchParams.set('domain', config.domain)
    return url.toString()
}

/** One trigger call. Never throws: a scheduler tick must not crash the service. */
export async function runSchedulingReminderCycle(options = {}) {
    const config = getConfig()

    if (!config.enabled && options.forceRun !== true) {
        return { skipped: true, reason: 'disabled' }
    }
    if (!config.token) {
        // The runner only accepts an unauthenticated call from an admin session,
        // which a worker does not have.
        return { skipped: true, reason: 'no-secret' }
    }

    try {
        const response = await fetch(buildRequestUrl(config), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.token}`,
            },
            body: '{}',
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || payload?.success === false) {
            return {
                skipped: false,
                ok: false,
                status: response.status,
                error: payload?.error || `Reminder run failed (HTTP ${response.status})`,
            }
        }

        return { skipped: false, ok: true, status: response.status, summary: payload?.data || null }
    } catch (error) {
        return { skipped: false, ok: false, error: error?.message || 'Reminder run failed' }
    }
}

export function startSchedulingReminderWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('SCHEDULING_REMINDER_WORKER_ENABLED=false - scheduling reminder trigger is disabled')
        return () => { }
    }
    if (!config.token) {
        console.log('SCHEDULING_REMINDER_RUN_SECRET (or CORE_BACKEND_SECRET) not set - scheduling reminder trigger is disabled')
        return () => { }
    }

    let stopped = false
    let running = false
    let timer = null

    const run = () => {
        if (stopped || running) return
        running = true
        runSchedulingReminderCycle()
            .then((result) => {
                if (result?.skipped) return
                if (result?.ok === false) {
                    console.error(`[${new Date().toISOString()}] Scheduling reminder run failed: ${result.error}`)
                    return
                }
                const summary = result?.summary || {}
                console.log(
                    `[${new Date().toISOString()}] Scheduling reminders: sent ${summary.sent || 0}, `
                    + `skipped ${summary.skipped || 0}, failed ${summary.failed || 0} `
                    + `(${(summary.domains || []).length} domain(s))`
                )
            })
            .catch((error) => console.error(`[${new Date().toISOString()}] Scheduling reminder trigger error: ${error?.message || error}`))
            .finally(() => { running = false })
    }

    run()
    timer = setInterval(run, config.pollSeconds * 1000)

    return () => {
        stopped = true
        if (timer) clearInterval(timer)
    }
}

export default { startSchedulingReminderWorker, runSchedulingReminderCycle }
