function normalizeDomain(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeUsername(value) {
    return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 100) : ''
}

function normalizeRole(value) {
    return value === 'superadmin' ? 'superadmin' : 'admin'
}

function resolveRuntimeRole() {
    const configuredRole = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || '').trim()
    const runtimeRole = configuredRole || (process.env.NODE_ENV === 'production' ? '' : 'practice_manager_app')

    if (runtimeRole && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(runtimeRole)) {
        throw new Error('POSTGRES_RLS_RUNTIME_ROLE must be a valid PostgreSQL role name')
    }

    return runtimeRole
}

export async function withPostgresRlsContext(connection, context, operation) {
    if (!connection?.query) throw new Error('A PostgreSQL connection is required')
    if (typeof operation !== 'function') throw new Error('An RLS database operation is required')

    const domain = normalizeDomain(context?.domain)
    if (!domain) throw new Error('A domain is required for RLS database access')

    const role = normalizeRole(context?.role)
    const username = normalizeUsername(context?.username)
    const runtimeRole = resolveRuntimeRole()

    await connection.query('BEGIN')
    try {
        if (runtimeRole) {
            await connection.query(`SET LOCAL ROLE "${runtimeRole}"`)
        }
        await connection.query(
            `SELECT set_config('app.current_domain', $1, true),
              set_config('app.current_role', $2, true),
              set_config('app.current_username', $3, true)`,
            [domain, role, username]
        )
        const result = await operation(connection)
        await connection.query('COMMIT')
        return result
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => { })
        throw error
    }
}

/**
 * Bind the request's domain to a connection for its whole lifetime.
 *
 * `withPostgresRlsContext` wraps a single operation in a transaction, which suits
 * a route that makes one call. Most routes instead hold a connection open across
 * several statements (insert, activity log, contact sync, queue enqueue), and
 * rewriting each one into a callback is a large, error-prone diff. A plain `SET`
 * on a connection that is created and closed per request gives the same binding
 * with a two-line change, because the settings die with the session.
 *
 * The role is always `admin`: a superadmin acting inside a domain is still bound
 * to that domain, so no browser session is ever cross-tenant at the database.
 *
 * `username` binds `app.current_username` for tables scoped to one admin (see
 * `USER_SCOPED_TABLES` in lib/rlsPolicies.js). Omit it for tenant-only work; the
 * setting is then the empty string, which matches no username.
 *
 * @param {{ query: Function }} connection
 * @param {{ domain: string, username?: string }} context
 * @returns {Promise<{ domain: string, role: string, username: string, runtimeRole: string }>}
 */
export async function applySessionRlsContext(connection, context) {
    if (!connection?.query) throw new Error('A PostgreSQL connection is required')

    const domain = normalizeDomain(context?.domain)
    if (!domain) throw new Error('A domain is required for RLS database access')

    const username = normalizeUsername(context?.username)

    // Always `admin`: a superadmin acting inside a domain is bound to that domain
    // as well, so no session is cross-tenant at the database. Superadmin bypass is
    // reserved for the explicit `withPostgresRlsContext` path.
    const role = 'admin'
    const runtimeRole = resolveRuntimeRole()

    if (runtimeRole) {
        await connection.query(`SET ROLE "${runtimeRole}"`)
    }

    await connection.query(
        `SELECT set_config('app.current_domain', $1, false),
          set_config('app.current_role', $2, false),
          set_config('app.current_username', $3, false)`,
        [domain, role, username]
    )

    return { domain, role, username, runtimeRole }
}

/**
 * Bind a connection for an explicit superadmin request that spans tenants.
 *
 * Superadmin is the one role allowed to read across domains, and the policies
 * short-circuit on it. No domain is set: the point is the cross-tenant view. Use
 * only in routes that have already verified superadmin at the application layer,
 * and prefer `getDomainBoundConnection` for anything scoped to one tenant.
 */
export async function applySuperAdminSessionContext(connection) {
    if (!connection?.query) throw new Error('A PostgreSQL connection is required')

    const runtimeRole = resolveRuntimeRole()

    if (runtimeRole) {
        await connection.query(`SET ROLE "${runtimeRole}"`)
    }

    await connection.query(
        `SELECT set_config('app.current_domain', '', false),
          set_config('app.current_role', 'superadmin', false),
          set_config('app.current_username', '', false)`
    )

    return { role: 'superadmin', runtimeRole }
}

/** The role that will actually be assumed, or '' when the connection keeps its own. */
export function resolveActiveRlsRole(env = process.env) {
    const configuredRole = String(env.POSTGRES_RLS_RUNTIME_ROLE || '').trim()
    if (configuredRole) return configuredRole
    return env.NODE_ENV === 'production' ? '' : 'practice_manager_app'
}
