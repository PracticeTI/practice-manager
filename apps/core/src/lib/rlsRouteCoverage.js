/**
 * Route wiring coverage for tenant tables.
 *
 * A policy only filters a query when the connection has `app.current_domain`
 * bound. A route that opens a plain connection never binds it, so it runs as
 * whatever role the deployment logs in as and ignores every policy. This module
 * reproduces the classification `scripts/rls-coverage.mjs` prints, so the admin
 * RLS panel can name the routes instead of only counting them.
 *
 * Dependency-free by design: the filesystem walk lives in
 * lib/rlsRouteCoverageFiles.js, so this module is importable by tests, the build
 * config, and the route handler alike.
 */

import { RLS_POLICY_TABLES } from './rlsPolicies.js'

/** Calls that bind the request's domain onto the connection before querying. */
export const ROUTE_BINDING_PATTERN =
    /getDomainBoundConnection|openDomainScopedConnection|getSuperAdminConnection|withPostgresRlsContext|applySessionRlsContext/

// `getSuperAdminConnection` sets a superadmin session instead of a domain. It
// counts as bound because the policies then evaluate `app.current_role`, which is
// the deliberate cross-tenant escape hatch — not the unset-session case.

// Routes that run DDL or whole-table maintenance as the schema owner. They are not
// request-tenant scoped and must keep an owner credential after the runtime role
// moves; binding them to one domain would be wrong rather than safer.
export const OPERATOR_ROUTE_PREFIXES = [
    'database/migrate',
    'database/create-tables',
    'database/fix-content-id-sequence',
    'database/migrate-to-attributes',
]

/**
 * Tenant tables a route source mentions in a FROM/INTO/UPDATE/JOIN/TABLE position.
 * @param {string} source
 * @returns {string[]}
 */
export function tablesTouchedBy(source) {
    const text = typeof source === 'string' ? source : ''
    const tables = []
    for (const table of RLS_POLICY_TABLES) {
        const pattern = new RegExp(String.raw`(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+"?${table}"?\b`, 'i')
        if (pattern.test(text)) tables.push(table)
    }
    return tables
}

/**
 * Classify one route as `bound`, `operator` (intentionally unbound) or `unwired`
 * (touches a tenant table on a plain connection). Returns null for a route that
 * never mentions a tenant table.
 *
 * @param {{ route?: string, source?: string }} [entry]
 * @returns {{ route: string, status: 'bound'|'operator'|'unwired', tables: string[] } | null}
 */
export function classifyRoute({ route, source } = {}) {
    if (typeof route !== 'string' || !route) return null

    const tables = tablesTouchedBy(source)
    if (tables.length === 0) return null

    if (ROUTE_BINDING_PATTERN.test(String(source))) return { route, status: 'bound', tables }
    if (OPERATOR_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))) {
        return { route, status: 'operator', tables }
    }
    return { route, status: 'unwired', tables }
}

/**
 * Group classified routes by status. Every collection is sorted by route so the
 * panel and `npm run rls:coverage` list the same order.
 *
 * @param {Array<{ route?: string, status?: string, tables?: string[] } | null>} entries
 */
export function buildRouteCoverage(entries) {
    const routes = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && typeof entry.route === 'string' && typeof entry.status === 'string')
        .map(({ route, status, tables }) => ({
            route,
            status,
            tables: Array.isArray(tables) ? tables : [],
        }))
        .sort((a, b) => a.route.localeCompare(b.route))

    const withStatus = (status) => routes.filter((entry) => entry.status === status)

    return {
        total: routes.length,
        bound: withStatus('bound'),
        operator: withStatus('operator'),
        unwired: withStatus('unwired'),
    }
}

/**
 * Read the coverage the build captured into `PRACTICE_RLS_ROUTE_COVERAGE`.
 * Returns null when the value is absent or unusable, so the panel can say the
 * deployment predates the capture instead of claiming zero unwired routes.
 *
 * @param {string | undefined} value
 */
export function parseRouteCoverage(value) {
    if (typeof value !== 'string' || !value.trim()) return null

    try {
        const parsed = JSON.parse(value)
        if (!parsed || !Array.isArray(parsed.unwired)) return null

        const coverage = buildRouteCoverage([
            ...(Array.isArray(parsed.bound) ? parsed.bound : []),
            ...(Array.isArray(parsed.operator) ? parsed.operator : []),
            ...parsed.unwired,
        ])

        return coverage.total > 0 ? coverage : null
    } catch {
        return null
    }
}

/**
 * Panel check for the coverage above. `warn` rather than `fail`: unwired routes
 * still work, they just run unconstrained, which is the residual exposure the
 * login-role check warns about.
 *
 * @param {ReturnType<typeof buildRouteCoverage> | null} coverage
 */
export function buildRouteCoverageCheck(coverage) {
    if (!coverage) {
        return {
            id: 'rls-route-coverage',
            label: 'RLS route coverage',
            status: 'warn',
            detail:
                'This deployment did not capture route coverage at build time, so the routes that open a plain connection are unknown here. '
                + 'Rebuild to capture it; `npm run rls:coverage` prints the same classification locally.',
        }
    }

    if (coverage.unwired.length === 0) {
        return {
            id: 'rls-route-coverage',
            label: 'RLS route coverage',
            status: 'pass',
            detail: `All ${coverage.total} routes that touch tenant tables bind app.current_domain before querying.`,
        }
    }

    return {
        id: 'rls-route-coverage',
        label: 'RLS route coverage',
        status: 'warn',
        detail: `${coverage.unwired.length} of ${coverage.total} routes that touch tenant tables open a plain connection, so their queries ignore app.current_domain and run as the login role. They are listed under "Routes without a domain binding".`,
    }
}
