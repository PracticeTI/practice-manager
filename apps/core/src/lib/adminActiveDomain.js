/**
 * Active domain resolution for the admin portal.
 *
 * Domain-scoped admins (role !== 'superadmin' with an assigned `domain`) always
 * operate on their own domain, even when the browser hostname does not match it
 * — for example a `*.vercel.app` preview URL, `localhost`, or another branded
 * host. Superadmins and bypass sessions keep the normal precedence.
 *
 * Resolution order:
 *   1. Assigned domain of the signed-in admin user (`source: 'admin-domain'`)
 *   2. Explicit pathname/override, `?domain=` request, hostname, saved
 *      preference, default (delegated to `getEffectiveDomainMode`)
 *
 * A superadmin can point the portal at another domain with `?domain=<key>`
 * (for example `https://dev.example.com/admin?domain=acme`). The request is
 * remembered for the browser so it survives navigation that drops the query
 * string; see `src/lib/adminDomainOverride.js`.
 */

import { getCurrentUser } from '@/lib/clientAdminAuth'
import { normalizeAdminDomainKey } from '@/lib/adminDomainCookie'
import { ADMIN_DOMAIN_OVERRIDE_SOURCE, canUseAdminDomainOverride } from '@/lib/adminDomainOverride'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { DEFAULT_DOMAIN_STORAGE_KEY, readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

export { DEFAULT_DOMAIN_STORAGE_KEY }
export const ADMIN_DOMAIN_SCOPE_SOURCE = 'admin-domain'

/**
 * Domain assigned to a domain-scoped admin user.
 *
 * @param {object|null} [user] - Admin user override; defaults to `getCurrentUser()`.
 * @returns {string|null} Domain key, or null for superadmins/bypass/anonymous.
 */
export function getAdminAssignedDomain(user = undefined) {
    const resolvedUser = user === undefined ? getCurrentUser() : user
    if (!resolvedUser) return null
    if (resolvedUser.role === 'superadmin') return null

    return normalizeAdminDomainKey(resolvedUser.domain) || null
}

/**
 * Resolve the active admin domain, preferring the signed-in user's assigned domain.
 *
 * @param {object} [options]
 * @param {string|null} [options.hostname]
 * @param {string|null} [options.storedValue] - Saved default-domain preference.
 * @param {string} [options.pathname]
 * @param {string|null} [options.overrideMode]
 * @param {object|null} [options.user] - Admin user override.
 * @returns {{ mode: string, source: string }}
 */
export function getEffectiveAdminDomainMode({
    hostname = null,
    storedValue = null,
    pathname = '',
    overrideMode = null,
    user = undefined,
} = {}) {
    const assignedDomain = getAdminAssignedDomain(user)
    if (assignedDomain) {
        return { mode: assignedDomain, source: ADMIN_DOMAIN_SCOPE_SOURCE }
    }

    const resolvedUser = user === undefined ? getCurrentUser() : user

    return getEffectiveDomainMode(hostname, storedValue, pathname, overrideMode, {
        allowAdminDomainOverride: canUseAdminDomainOverride(resolvedUser),
    })
}

/**
 * Browser convenience wrapper: reads hostname, pathname, and the saved default
 * domain preference itself. Returns the default mode during server rendering.
 *
 * @param {object} [options]
 * @param {string} [options.pathname] - Defaults to the current pathname.
 * @param {string|null} [options.overrideMode]
 * @param {object|null} [options.user] - Admin user override.
 * @returns {{ mode: string, source: string }}
 */
export function getEffectiveAdminDomainModeFromStorage({ pathname = '', overrideMode = null, user = undefined } = {}) {
    if (typeof window === 'undefined') {
        return { mode: DEFAULT_DOMAIN_MODE, source: 'default' }
    }

    let storedValue = null
    try {
        storedValue = readStoredDefaultDomain(window.localStorage)
    } catch {
        storedValue = null
    }

    return getEffectiveAdminDomainMode({
        hostname: window.location.hostname,
        storedValue,
        pathname: pathname || window.location.pathname,
        overrideMode,
        user,
    })
}

/**
 * Convenience wrapper returning only the resolved domain key.
 *
 * @param {string} [pathname]
 * @param {string|null} [overrideMode]
 * @returns {string}
 */
export function getAdminDomainMode(pathname = '', overrideMode = null) {
    return getEffectiveAdminDomainModeFromStorage({ pathname, overrideMode }).mode
}

/**
 * Human-readable label for the resolution source shown in the admin banner.
 *
 * @param {string} source
 * @returns {string}
 */
export function getAdminDomainSourceLabel(source) {
    if (source === ADMIN_DOMAIN_SCOPE_SOURCE) return 'assigned domain'
    if (source === ADMIN_DOMAIN_OVERRIDE_SOURCE) return 'URL override'
    return String(source || '')
}
