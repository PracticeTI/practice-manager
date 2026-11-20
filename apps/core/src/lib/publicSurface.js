/**
 * Where Maintenance Mode applies.
 *
 * Maintenance mode is a *public frontend* concern: it replaces the rendered
 * page for visitor-facing routes. Operational surfaces must stay reachable
 * during maintenance so an operator can turn the flag back off, so `/admin`,
 * `/login`, `/settings`, `/domains`, `/presence`, `/og` and the `/api` +
 * `/_next` machinery are never treated as public.
 *
 * Note `/domains` re-exports the admin domain-settings page (see
 * `src/app/domains/page.jsx`), so it is operational despite its public-looking
 * path.
 *
 * Pure module (no Next/DB imports) so it can be shared by the root middleware
 * (edge runtime) and server components, and exercised by `node --test`.
 */

/**
 * Request header carrying the *original* request pathname. The root middleware
 * sets this before any host/path rewrite, so server components can classify the
 * request even though Next.js does not expose the pathname to layouts directly.
 */
export const PUBLIC_SURFACE_PATHNAME_HEADER = 'x-practice-pathname'

/** Path prefixes that are never part of the public frontend. */
export const NON_PUBLIC_PATH_PREFIXES = [
    '/admin',
    '/login',
    '/settings',
    '/domains',
    '/presence',
    '/og',
    '/api',
    '/_next',
]

/**
 * True when the given pathname belongs to the visitor-facing public frontend.
 *
 * Unknown/missing pathnames return false so a request we cannot classify is
 * left untouched rather than served a maintenance screen by accident.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isPublicSurfacePath(pathname) {
    const normalized = String(pathname || '').split('?')[0].split('#')[0]
    if (!normalized.startsWith('/')) return false

    return !NON_PUBLIC_PATH_PREFIXES.some(
        (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
    )
}
