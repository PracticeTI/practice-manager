/**
 * Admin domain override requested through the URL.
 *
 * `?domain=<key>` on an admin surface (for example
 * `https://dev.example.com/admin?domain=acme`) points the portal at a
 * specific domain. Branded hosts map to their own domain through the hostname,
 * and the hostname outranks the saved Settings preference, so the request has to
 * be remembered separately for the choice to survive navigation that drops the
 * query string.
 *
 * The override lives in a cookie (`admin_domain_override_v1`) rather than
 * localStorage because three readers have to agree on it:
 *   - the edge middleware, which remembers a `?domain=` request and sets the
 *     domain mode override header,
 *   - the admin layout, which renders the server-side title and domain colours,
 *   - the browser, which resolves the domain the admin pages query.
 *
 * Only admin surfaces read this value (see `isAdminSurfacePathname` in
 * `src/lib/domainMode.js`), so the public frontend keeps resolving strictly from
 * the hostname. Domain-scoped admins are never affected: their assigned domain
 * outranks the override (see `src/lib/adminActiveDomain.js`) and the API
 * enforces the same rule in `src/lib/adminDomainScopePolicy.js`.
 *
 * Keep this module dependency-free: it is imported by both client and server
 * code (including the edge middleware).
 */

export const ADMIN_DOMAIN_OVERRIDE_COOKIE = 'admin_domain_override_v1'

/** How long a `?domain=` request is remembered for. */
export const ADMIN_DOMAIN_OVERRIDE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/**
 * Resolution source reported for a `?domain=` request, whether it came from the
 * current URL or from the remembered override.
 */
export const ADMIN_DOMAIN_OVERRIDE_SOURCE = 'domain-override'

/** Safe domain-key shape: lowercase letters, digits, hyphens and underscores. */
const DOMAIN_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/

/**
 * Only a superadmin may point the portal at another domain through the URL.
 * Every other session keeps the domain it is scoped to, so a URL can never
 * widen what an admin can reach.
 *
 * @param {object|null} user - Decoded admin user (`getCurrentUser()` shape).
 * @returns {boolean}
 */
export function canUseAdminDomainOverride(user) {
    return user?.role === 'superadmin'
}

/**
 * Normalize a domain key requested through the URL.
 *
 * Unknown keys are allowed (domains are configured at runtime, see
 * `/api/settings/domains`) but the value must still look like a domain key so a
 * stray parameter can never smuggle in an arbitrary string.
 *
 * @param {unknown} value
 * @returns {string} Normalized domain key — or '' when the value is unusable.
 */
export function normalizeAdminDomainOverride(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return DOMAIN_KEY_PATTERN.test(normalized) ? normalized : ''
}

/**
 * Cookie attributes shared by the browser write and the middleware response.
 *
 * @param {{ secure?: boolean }} [options]
 * @returns {{ path: string, maxAge: number, sameSite: 'lax', secure: boolean }}
 */
export function adminDomainOverrideCookieOptions({ secure = false } = {}) {
    return {
        path: '/',
        maxAge: ADMIN_DOMAIN_OVERRIDE_MAX_AGE_SECONDS,
        sameSite: 'lax',
        secure,
    }
}

/**
 * Read the override out of a `document.cookie` string or `Cookie` header.
 *
 * @param {unknown} cookieString
 * @returns {string} Normalized domain key — or '' when no override is present.
 */
export function parseAdminDomainOverrideCookie(cookieString) {
    for (const entry of String(cookieString || '').split(';')) {
        const separatorIndex = entry.indexOf('=')
        if (separatorIndex < 0) continue

        if (entry.slice(0, separatorIndex).trim() !== ADMIN_DOMAIN_OVERRIDE_COOKIE) continue

        let value = entry.slice(separatorIndex + 1).trim()
        try {
            value = decodeURIComponent(value)
        } catch {
            // Keep the raw value when it is not valid percent-encoding.
        }

        return normalizeAdminDomainOverride(value)
    }

    return ''
}

/**
 * Read the remembered admin domain override in the browser.
 *
 * @returns {string} Normalized domain key — or '' when none is stored.
 */
export function readAdminDomainOverride() {
    if (typeof document === 'undefined') return ''
    return parseAdminDomainOverrideCookie(document.cookie)
}

/**
 * Remember the admin domain override for this browser.
 *
 * @param {unknown} domain - Domain key to store; an unusable value clears the override.
 * @returns {string} The stored domain key — or '' when nothing was written.
 */
export function writeAdminDomainOverride(domain) {
    const normalized = normalizeAdminDomainOverride(domain)
    if (!normalized || typeof document === 'undefined') return ''

    try {
        const { path, maxAge, sameSite, secure } = adminDomainOverrideCookieOptions({
            secure: typeof window !== 'undefined' && window.location?.protocol === 'https:',
        })
        document.cookie = `${ADMIN_DOMAIN_OVERRIDE_COOKIE}=${encodeURIComponent(normalized)}; path=${path}; max-age=${maxAge}; samesite=${sameSite}${secure ? '; secure' : ''}`
    } catch {
        // Ignore cookie write failures.
    }

    return normalized
}

/** Forget the remembered admin domain override. */
export function clearAdminDomainOverride() {
    if (typeof document === 'undefined') return

    try {
        document.cookie = `${ADMIN_DOMAIN_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`
    } catch {
        // Ignore cookie clear failures.
    }
}
