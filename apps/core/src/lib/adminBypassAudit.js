/**
 * Audit trail for bypass-authenticated requests.
 *
 * Bypass tokens are fixed strings, so their use is otherwise invisible: nothing
 * is written to the database, and the only trace is a request log an operator
 * has to think to look at. Every accepted bypass therefore emits one structured
 * line naming the principal, the deployment and the route.
 *
 * Repeated hits on the same route (polling, admin dashboards) are collapsed to
 * one line per window so a polling tab cannot bury the signal. The dedupe state
 * is per process and deliberately not persisted: the log line is the durable
 * record.
 */

const WINDOW_MS = 60_000
const MAX_KEYS = 500

const lastLoggedAt = new Map()

/**
 * @param {{username?: string, role?: string, domain?: string, bypass?: string}|null} user
 * @param {{path?: string, method?: string, host?: string}} [context]
 * @param {number} [now]
 * @returns {object|null} The emitted entry, or null when the user is not a bypass principal or the call was deduped.
 */
export function recordBypassUse(user, context = {}, now = Date.now()) {
  if (!user?.bypass) return null

  const path = typeof context.path === 'string' ? context.path : ''
  const key = `${user.bypass}:${path}`
  const previous = lastLoggedAt.get(key)
  if (previous !== undefined && now - previous < WINDOW_MS) return null

  if (lastLoggedAt.size >= MAX_KEYS) lastLoggedAt.clear()
  lastLoggedAt.set(key, now)

  const entry = {
    bypass: user.bypass,
    principal: user.username || null,
    role: user.role || null,
    domain: user.domain || null,
    method: context.method || null,
    path: path || null,
    host: context.host || null,
    deployment: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || null,
    at: new Date(now).toISOString(),
  }

  console.warn(`[admin-bypass] ${JSON.stringify(entry)}`)

  return entry
}

/** Test hook: forget which routes were logged. */
export function resetBypassAuditState() {
  lastLoggedAt.clear()
}
