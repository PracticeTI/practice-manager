/**
 * Access rule for the RLS diagnostics panel and its payload.
 *
 * The payload says whether tenant isolation is actually enforced by the database,
 * which is operator information rather than something every admin needs. Two
 * principals may read it:
 *
 *   - a superadmin, and
 *   - a simulated admin session.
 *
 * `simulated` is the one claim an admin cannot give themselves: only
 * `POST /api/auth/simulate-admin` mints it, and that route requires a superadmin.
 * So a simulated session is proof the operator opened it deliberately to test what
 * a domain admin sees. The preview-bypass principal is not simulated, and is
 * therefore refused — it is the same identity a real preview admin would hold.
 *
 * Dependency-free by design so the rule can be unit tested and shared by the route
 * and the page.
 */

export function isSimulatedAdminSession(user) {
    return Boolean(user && user.simulated === true)
}

/**
 * @param {{ simulated?: boolean } | null | undefined} user
 * @param {{ superAdmin?: boolean }} [context]
 */
export function canReadRlsDiagnostics(user, { superAdmin = false } = {}) {
    return superAdmin === true || isSimulatedAdminSession(user)
}
