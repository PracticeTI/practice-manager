/**
 * Cookie carrying the active admin's assigned domain key.
 *
 * It is written when an admin session is persisted (see
 * `src/lib/clientAdminAuth.js`) so server components — `src/app/admin/layout.jsx`
 * in particular — can resolve the same active domain client code does, even when
 * the browser hostname does not match the admin's domain (e.g. a `*.vercel.app`
 * preview URL or `localhost`).
 *
 * Keep this module dependency-free: it is imported by both client and server code.
 */

export const ADMIN_DOMAIN_COOKIE = 'admin_domain_v1'

/**
 * Normalize a domain key coming from a cookie or admin user record.
 *
 * @param {unknown} value
 * @returns {string} Lowercased, trimmed domain key — or '' when absent.
 */
export function normalizeAdminDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}
