import { ADMIN_DOMAIN_COOKIE, normalizeAdminDomainKey } from '@/lib/adminDomainCookie'
import { getPrivateDevOrigins } from '@/lib/domainExtension'

const LOCALHOST_DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'
const LOCALHOST_DEV_ADMIN_USERNAME = 'localhost-dev'
const PREVIEW_DEPLOYMENT_ADMIN_TOKEN = 'vercel-preview-admin-bypass-token'
const PREVIEW_DEPLOYMENT_ADMIN_USERNAME = 'vercel-preview'
const ADMIN_PRESENCE_COOKIE = 'admin_presence_v1'
const ADMIN_SETUP_STATUS_CACHE_KEY = 'adminSetupStatus.v1'
const ADMIN_SETUP_STATUS_CACHE_TTL_MS = 30 * 1000
const LOCAL_DEV_HOSTNAMES = new Set(getPrivateDevOrigins())

function isLocalHostname(hostname) {
    const normalized = typeof hostname === 'string' ? hostname.toLowerCase() : ''
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '[::1]' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        LOCAL_DEV_HOSTNAMES.has(normalized)
    )
}

/**
 * Assigned domain carried by a domain-scoped admin token. Empty for superadmins,
 * bypass sessions, and non-JWT tokens.
 */
function readTokenDomain(token) {
    const payload = parseJwtPayload(token)
    if (!payload || payload.role === 'superadmin') return ''

    return normalizeAdminDomainKey(payload.domain)
}

/**
 * Mirror the session's assigned domain into a cookie so server components can
 * resolve the active admin domain without access to localStorage.
 */
function persistAdminDomainCookie(domain) {
    if (typeof document === 'undefined') return

    try {
        if (!domain) {
            document.cookie = `${ADMIN_DOMAIN_COOKIE}=; path=/; max-age=0; samesite=lax`
            return
        }

        const isSecure = window.location.protocol === 'https:'
        document.cookie = `${ADMIN_DOMAIN_COOKIE}=${encodeURIComponent(domain)}; path=/; max-age=86400; samesite=lax${isSecure ? '; secure' : ''}`
    } catch {
        // Ignore cookie write failures.
    }
}

/**
 * Authorization header for admin API calls, or an empty object when no session
 * exists yet.
 *
 * Patient-bearing routes verify the bearer token server-side, so a caller that
 * omits this gets a 401 rather than data. Falls back to minting the
 * development/preview bypass token exactly as the admin pages do on mount.
 */
export async function getAdminAuthHeaders() {
    if (typeof window === 'undefined') return {}

    let token = ''
    try {
        token = window.localStorage.getItem('adminToken') || ''
    } catch {
        token = ''
    }

    if (!token || isAdminTokenExpired(token)) {
        try {
            token = (await getOrCreateAdminTokenForLocalhost()) || ''
        } catch {
            token = ''
        }
    }

    return token ? { Authorization: `Bearer ${token}` } : {}
}

export function persistAdminSession(token, username, domain = '') {
    window.localStorage.setItem('adminToken', token)

    if (username) {
        window.localStorage.setItem('adminUsername', username)
    }

    if (domain) {
        window.localStorage.setItem('adminBypassDomain', domain)
    } else {
        window.localStorage.removeItem('adminBypassDomain')
    }

    try {
        const isSecure = window.location.protocol === 'https:'
        document.cookie = `${ADMIN_PRESENCE_COOKIE}=1; path=/; max-age=86400; samesite=lax${isSecure ? '; secure' : ''}`
    } catch {
        // Ignore cookie write failures.
    }

    persistAdminDomainCookie(readTokenDomain(token) || domain)
}

function parseJwtPayload(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null

    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
        return JSON.parse(atob(padded))
    } catch {
        return null
    }
}

/**
 * True when a stored token can no longer authenticate: a JWT whose `exp` claim
 * has passed, or a value that is not a token at all. Bypass tokens carry no
 * expiry — the server gates them on the deployment that mints them instead.
 *
 * A stale token is worse than no token: the admin pages treat it as a session,
 * load normally, and then every authenticated request answers 401.
 */
export function isAdminTokenExpired(token) {
    const normalized = typeof token === 'string' ? token.trim() : ''
    if (!normalized) return true
    if (normalized === LOCALHOST_DEV_ADMIN_TOKEN || normalized === PREVIEW_DEPLOYMENT_ADMIN_TOKEN) return false

    const payload = parseJwtPayload(normalized)
    if (!payload) return true
    if (typeof payload.exp !== 'number') return false

    return payload.exp * 1000 <= Date.now()
}

function isSimulatedAdminToken(token) {
    const payload = parseJwtPayload(token)
    return payload?.simulated === true
}

function readCachedAdminSetupStatus() {
    if (typeof window === 'undefined') return null

    try {
        const rawValue = window.sessionStorage.getItem(ADMIN_SETUP_STATUS_CACHE_KEY)
        if (!rawValue) {
            return null
        }

        const parsedValue = JSON.parse(rawValue)
        if (!parsedValue?.cachedAt || !parsedValue?.data) {
            return null
        }

        if ((Date.now() - parsedValue.cachedAt) > ADMIN_SETUP_STATUS_CACHE_TTL_MS) {
            window.sessionStorage.removeItem(ADMIN_SETUP_STATUS_CACHE_KEY)
            return null
        }

        return parsedValue.data
    } catch {
        return null
    }
}

function cacheAdminSetupStatus(data) {
    if (typeof window === 'undefined') return

    try {
        window.sessionStorage.setItem(
            ADMIN_SETUP_STATUS_CACHE_KEY,
            JSON.stringify({
                cachedAt: Date.now(),
                data
            })
        )
    } catch {
        // Ignore cache write failures.
    }
}

export function clearAdminSession() {
    if (typeof window === 'undefined') return

    window.localStorage.removeItem('adminToken')
    window.localStorage.removeItem('adminUsername')
    try {
        document.cookie = `${ADMIN_PRESENCE_COOKIE}=; path=/; max-age=0; samesite=lax`
    } catch {
        // Ignore cookie clear failures.
    }

    persistAdminDomainCookie('')
}

export async function getAdminSetupStatus(options = {}) {
    if (typeof window === 'undefined') return null

    const { forceRefresh = false } = options

    if (!forceRefresh) {
        const cachedStatus = readCachedAdminSetupStatus()
        if (cachedStatus) {
            return cachedStatus
        }
    }

    try {
        const response = await fetch('/api/auth/setup-status', { cache: 'no-store' })
        if (!response.ok) {
            return null
        }

        const data = await response.json()
        cacheAdminSetupStatus(data)
        return data
    } catch {
        return null
    }
}

export function isPreviewDeploymentAdminBypassEnabled(setupStatus) {
    return setupStatus?.previewAdminBypassEnabled === true
}

export function isLocalhostDevBypassEnabled() {
    if (typeof window === 'undefined') return false

    return process.env.NODE_ENV === 'development' && isLocalHostname(window.location.hostname)
}

export async function getOrCreateAdminTokenForLocalhost() {
    if (typeof window === 'undefined') return null

    let existingToken = window.localStorage.getItem('adminToken')

    if (existingToken && isAdminTokenExpired(existingToken)) {
        clearAdminSession()
        existingToken = null
    }

    // In local development, always use the deterministic bypass token instead of
    // reusing potentially stale/expired JWTs from previous sessions.
    // Exception: preserve explicit simulated-admin sessions.
    if (isLocalhostDevBypassEnabled()) {
        if (existingToken && isSimulatedAdminToken(existingToken)) {
            persistAdminSession(existingToken, window.localStorage.getItem('adminUsername'))
            return existingToken
        }

        persistAdminSession(LOCALHOST_DEV_ADMIN_TOKEN, LOCALHOST_DEV_ADMIN_USERNAME)
        return LOCALHOST_DEV_ADMIN_TOKEN
    }

    if (existingToken) {
        persistAdminSession(
            existingToken,
            window.localStorage.getItem('adminUsername'),
            existingToken === PREVIEW_DEPLOYMENT_ADMIN_TOKEN
                ? (window.localStorage.getItem('adminBypassDomain') || '')
                : ''
        )
        return existingToken
    }

    const setupStatus = await getAdminSetupStatus()
    if (!isPreviewDeploymentAdminBypassEnabled(setupStatus)) {
        return null
    }

    persistAdminSession(
        PREVIEW_DEPLOYMENT_ADMIN_TOKEN,
        setupStatus.previewAdminUsername || PREVIEW_DEPLOYMENT_ADMIN_USERNAME,
        setupStatus.previewAdminDomain || ''
    )

    return PREVIEW_DEPLOYMENT_ADMIN_TOKEN
}

const TOKEN_WAIT_ATTEMPTS = 6
const TOKEN_WAIT_MS = 400

/**
 * Resolve an admin token for the current page, waiting briefly for pages that
 * mint their own bypass token on mount (localhost dev, preview deployments).
 * Returns an empty string when no token becomes available.
 */
export async function resolveAdminAuthToken({ attempts = TOKEN_WAIT_ATTEMPTS, delayMs = TOKEN_WAIT_MS } = {}) {
    if (typeof window === 'undefined') return ''

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        let token = ''
        try {
            token = window.localStorage.getItem('adminToken') || ''
        } catch {
            token = ''
        }
        if (token && !isAdminTokenExpired(token)) return token

        try {
            const localToken = await getOrCreateAdminTokenForLocalhost()
            if (localToken) return localToken
        } catch {
            // Fall through and retry.
        }

        if (attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs))
        }
    }

    return ''
}

/**
 * Decode the stored admin token and return basic user info.
 * Returns { username, role, domain } — or null if no usable token is stored.
 * - Bypass tokens are always treated as superadmin.
 * - JWTs are decoded (not verified — verification happens server-side).
 */
export function getCurrentUser() {
    if (typeof window === 'undefined') return null

    const token = window.localStorage.getItem('adminToken')
    if (!token || isAdminTokenExpired(token)) return null

    if (token === LOCALHOST_DEV_ADMIN_TOKEN) {
        return { username: LOCALHOST_DEV_ADMIN_USERNAME, role: 'superadmin', domain: null, simulated: false }
    }
    if (token === PREVIEW_DEPLOYMENT_ADMIN_TOKEN) {
        return {
            username: window.localStorage.getItem('adminUsername') || PREVIEW_DEPLOYMENT_ADMIN_USERNAME,
            // Scoped to one domain, never a superadmin — mirror the principal the
            // server resolves so the UI cannot offer controls the API rejects.
            role: 'admin',
            domain: window.localStorage.getItem('adminBypassDomain') || null,
            simulated: false,
        }
    }

    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
        const payload = JSON.parse(atob(padded))
        return {
            username: payload.username || null,
            role: payload.role || 'admin',
            domain: payload.domain || null,
            simulated: payload.simulated === true,
            simulatedBy: payload.simulated_by || null,
        }
    } catch {
        return null
    }
}

