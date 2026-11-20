/**
 * Deny-by-default rule for the `/api/database` surface.
 *
 * Most of these routes were written with their own auth check, or none at all, and
 * the ones that forgot were indistinguishable from the ones that didn't: an
 * audit found patient records, database credentials and destructive migrations all
 * reachable without a token. A route-by-route fix only holds until the next route
 * is added, so the prefix is closed by default and opened deliberately.
 *
 * Anything a public page needs goes in `DATABASE_API_PUBLIC_PATHS`. Adding to that
 * list is a security decision, not a convenience.
 *
 * Pure module: imported by middleware, so no Next.js or database imports.
 */

export const DATABASE_API_PREFIX = '/api/database/'

/**
 * Routes the public frontend calls without a session. Nothing under the prefix is
 * public today: a listing route that used to live here has been
 * retired, so everything else is admin or operator tooling.
 */
export const DATABASE_API_PUBLIC_PATHS = []

/** `enforce` blocks unauthenticated requests; `report` logs and lets them through. */
export const GATE_MODES = ['enforce', 'report']

/** Reads the same `API_GATE` knob as the wider API gate, so one variable governs both. */
export function resolveGateMode(env = process.env) {
  const requested = String(env.API_GATE || '').trim().toLowerCase()
  return GATE_MODES.includes(requested) ? requested : 'enforce'
}

/** True for the database API surface, excluding the bare prefix itself. */
export function isDatabaseApiPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith(DATABASE_API_PREFIX)
}

/** True when the path may be served without a token. */
export function isPublicDatabaseApiPath(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '')
  return DATABASE_API_PUBLIC_PATHS.includes(normalized)
}

/**
 * Decide what to do with a request to the database API.
 *
 * @param {{ pathname?: string, method?: string, authenticated?: boolean, isService?: boolean }} input
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ action: 'allow'|'deny'|'log', reason: string, status?: number }}
 */
export function decideDatabaseApiAccess(input, env = process.env) {
  const pathname = String(input?.pathname || '')
  const method = String(input?.method || '').toUpperCase()

  if (!isDatabaseApiPath(pathname)) return { action: 'allow', reason: 'not-database-api' }
  // CORS preflight carries no credentials by design.
  if (method === 'OPTIONS') return { action: 'allow', reason: 'preflight' }
  if (input?.isService) return { action: 'allow', reason: 'service' }
  if (input?.authenticated) return { action: 'allow', reason: 'admin' }
  if (isPublicDatabaseApiPath(pathname)) return { action: 'allow', reason: 'public-allowlist' }

  if (resolveGateMode(env) === 'report') {
    return { action: 'log', reason: 'unauthenticated' }
  }

  return { action: 'deny', reason: 'unauthenticated', status: 401 }
}
