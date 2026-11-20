/**
 * Open a connection already bound to the request's tenant.
 *
 * Row-level security only filters a query when the session has `app.current_domain`
 * set. Routes that read patient tables must therefore bind it before their first
 * statement — more precisely, before *any* statement, or the policy sees NULL and
 * returns no rows.
 *
 * Two entry points, because routes differ:
 *   getDomainBoundConnection(domain)                    the route already resolved it
 *   openDomainScopedConnection(request, requestedDomain) resolve and open in one step
 *
 * Both assume `role: 'admin'`. A superadmin acting inside a domain is bound to that
 * domain too, so no request is ever cross-tenant in the database — the requested
 * domain *is* the target.
 *
 * Failure to bind is a hard error rather than a silent fallback: a query that runs
 * without context against a constrained role returns an empty result, which looks
 * exactly like "this tenant has no data".
 */

import { getDatabaseConnection } from './database.js'
import { resolveAdminDomainScope } from './adminDomainScope.js'
import { applySessionRlsContext, applySuperAdminSessionContext } from './postgresRlsContext.js'

/**
 * @param {string} domain
 * @param {object} [options] `username` binds `app.current_username` for per-user
 *   tables; the rest is passed through to getDatabaseConnection.
 * @returns {Promise<object>} A connection whose session is scoped to `domain`.
 */
export async function getDomainBoundConnection(domain, options = {}) {
  const { username, ...connectionOptions } = options || {}
  const connection = await getDatabaseConnection(connectionOptions)

  try {
    await applySessionRlsContext(connection, { domain, username })
  } catch (error) {
    await connection.end?.().catch(() => {})
    throw error
  }

  return connection
}

/**
 * Open a connection bound as a cross-tenant superadmin session.
 *
 * The caller must have verified superadmin itself; this only sets the database
 * session's role so the policies permit every domain. There is no `app.current_domain`.
 */
export async function getSuperAdminConnection(options = {}) {
  const connection = await getDatabaseConnection(options)

  try {
    await applySuperAdminSessionContext(connection)
  } catch (error) {
    await connection.end?.().catch(() => {})
    throw error
  }

  return connection
}

/**
 * Resolve the caller's domain scope and open a connection bound to it.
 *
 * Returns `{ error, status }` when the caller may not act on the requested domain,
 * matching the shape `resolveAdminDomainScope` already returns.
 *
 * @param {Request} request
 * @param {string|null} requestedDomain
 * @param {object} [options]
 */
export async function openDomainScopedConnection(request, requestedDomain, options = {}) {
  const scope = await resolveAdminDomainScope(request, requestedDomain)
  if (scope.error) {
    return { error: scope.error, status: scope.status }
  }

  const connection = await getDomainBoundConnection(scope.domain, options)

  return { connection, domain: scope.domain, user: scope.adminUser }
}
