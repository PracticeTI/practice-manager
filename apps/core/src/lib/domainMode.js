/**
 * Domain mode detection utilities.
 *
 * Resolves the active domain experience from the browser hostname, path, or
 * saved admin preference.
 *
 * Priority order (highest → lowest):
 *   1. Explicit override via the `overrideMode` argument
 *   2. `?domain=` on an admin surface, or the domain it remembered
 *   3. Path prefix (/acme/...), or the request header the middleware sets
 *   4. Non-default hostname-based detection
 *   5. Saved localStorage preference (Admin Settings → Default Domain)
 *   6. Default hostname-based detection
 *   7. Overlay-selected default, or the unbranded public default
 *
 * Only identifiers in `VALID_DOMAIN_MODES` are resolved: a path prefix, saved
 * preference, header, cookie or hostname that points anywhere else is ignored so
 * the app falls through to the default domain instead.
 */

import {
  ADMIN_DOMAIN_OVERRIDE_SOURCE,
  normalizeAdminDomainOverride,
  readAdminDomainOverride,
} from './adminDomainOverride.js'
import {
  getPrivateDomainLabels,
  getPrivateDefaultContentDomain,
  getPrivateDefaultDomainMode,
  getPrivateDomainModes,
  getPrivateHostLabelHints,
  getPrivateHostnameMap,
} from './domainExtension.js'

/**
 * Domain modes shipped in the open-source distribution. Customer-specific domains
 * arrive from the private overlay (see lib/domainExtension.js) and are appended here,
 * so every consumer keeps one authoritative list.
 */
export const DEFAULT_DOMAIN_KEY = 'default'
export const CORE_DOMAIN_MODES = [DEFAULT_DOMAIN_KEY]
export const VALID_DOMAIN_MODES = [...new Set([...CORE_DOMAIN_MODES, ...getPrivateDomainModes()])]
export const DEFAULT_DOMAIN_MODE = getPrivateDefaultDomainMode() || DEFAULT_DOMAIN_KEY
export const DEFAULT_CONTENT_DOMAIN = getPrivateDefaultContentDomain() || DEFAULT_DOMAIN_KEY
export const DOMAIN_MODE_OVERRIDE_HEADER = 'x-domain-mode-override'
export const DOMAIN_MODE_QUERY_PARAM = 'domain'
const DOMAIN_MODE_PATHNAME_HEADERS = ['next-url', 'x-matched-path', 'x-invoke-path']

function normalizeDomainMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  return VALID_DOMAIN_MODES.includes(normalized) ? normalized : null
}

/**
 * Built-in hostname-to-domain mappings.
 * A hostname matches if it equals an entry or ends with '.<entry>'.
 * Keys are lowercase domain strings; values are domain mode identifiers.
 */
/**
 * Parse an optional JSON environment variable that allows operators to
 * supply additional hostname → domain mappings without touching source code.
 *
 * In Next.js, NEXT_PUBLIC_* values are inlined at build time and are
 * available in the browser bundle — this function runs on both server and
 * client without issues.
 *
 * Expected format (JSON object):
 *   NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP='{"my-custom-domain.com":"my-domain"}'
 *
 * @returns {Record<string, string>} Validated map of hostname → domain mode.
 */
function parseEnvHostnameMap() {
  try {
    // NEXT_PUBLIC_HOSTNAME_SCOUT_MAP predates the WordScout rename; still read so
    // an existing deployment's hostname overrides keep working.
    const raw = process.env.NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP
      || process.env.NEXT_PUBLIC_HOSTNAME_SCOUT_MAP
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result = {}
    for (const [host, mode] of Object.entries(parsed)) {
      if (typeof host === 'string' && VALID_DOMAIN_MODES.includes(mode)) {
        result[host.toLowerCase()] = mode
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Return the combined hostname → domain mode map (env overrides take
 * precedence over built-in entries so operators can remap any domain).
 *
 * @returns {Record<string, string>}
 */
export function getHostnameDomainMap() {
  return { ...getPrivateHostnameMap(), ...parseEnvHostnameMap() }
}

/**
 * Detect domain mode from the first pathname segment.
 *
 * Examples:
 *   /acme/contact -> acme
 *   /acme/news -> acme
 *   /contact -> null
 *
 * @param {string} pathname
 * @returns {string|null}
 */
export function detectDomainFromPathname(pathname) {
  if (!pathname || typeof pathname !== 'string') return null
  const firstSegment = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)[0]
  return normalizeDomainMode(firstSegment)
}

/**
 * Top-level routes that render the admin layout (see the re-exports in
 * `src/app/settings` and `src/app/domains`), so a URL override reaches them the
 * same way it reaches `/admin`.
 */
const ADMIN_SURFACE_ROOT_SEGMENTS = ['admin', 'settings', 'domains']

/**
 * True for the admin portal surface: `/admin/...`, the admin layout routes
 * hosted at the top level (`/settings/...`, `/domains/...`), or the same routes
 * behind a domain-mode path prefix (`/acme/admin/...`).
 *
 * Used to keep URL-based domain switching inside the portal, so the public
 * frontend never resolves a domain from a query string.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isAdminSurfacePathname(pathname) {
  const normalized = String(pathname || '').split('?')[0].split('#')[0]
  if (!normalized.startsWith('/')) return false

  const segments = normalized.split('/').filter(Boolean)
  if (ADMIN_SURFACE_ROOT_SEGMENTS.includes(segments[0])) return true

  return segments.length > 1
    && ADMIN_SURFACE_ROOT_SEGMENTS.includes(segments[1])
    && VALID_DOMAIN_MODES.includes(segments[0])
}

/**
 * Read the `?domain=` override carried by a query string.
 *
 * Only honored on admin surfaces (see `isAdminSurfacePathname`); anything else
 * — a public page, a typo, a non-domain value — resolves to null so the request
 * keeps following the normal hostname precedence.
 *
 * @param {string} search - Query string, with or without the leading '?'.
 * @param {string} pathname - Pathname the query string belongs to.
 * @returns {string|null}
 */
export function getDomainModeOverrideFromSearch(search, pathname = '') {
  if (!isAdminSurfacePathname(pathname) || !search) return null

  const raw = String(search)
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
  const requested = normalizeAdminDomainOverride(params.get(DOMAIN_MODE_QUERY_PARAM))
  return requested && VALID_DOMAIN_MODES.includes(requested) ? requested : null
}

function getBrowserLocationPathname() {
  if (typeof window === 'undefined') return ''
  return window.location?.pathname || ''
}

function getBrowserLocationSearch() {
  if (typeof window === 'undefined') return ''
  return window.location?.search || ''
}

/**
 * Returns the active path prefix (e.g. /acme) when the current URL uses a
 * prefixed domain route for the provided mode.
 *
 * @param {string} pathname
 * @param {string} mode
 * @returns {string}
 */
export function getModePathPrefix(pathname, mode) {
  const fromPath = detectDomainFromPathname(pathname)
  const normalizedMode = normalizeDomainMode(mode)
  if (!fromPath || !normalizedMode || fromPath !== normalizedMode) return ''

  // When the current hostname already maps to this mode (for example
  // www.acme.com.au -> acme), links should remain root-relative
  // so users see /contact rather than /acme/contact.
  const inferredHostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const hostMode = detectDomainFromHostname(inferredHostname)
  if (hostMode && hostMode === normalizedMode) return ''

  return `/${fromPath}`
}

/**
 * Prefix internal app paths with the active domain mode path prefix.
 *
 * @param {string} href
 * @param {string} modePathPrefix
 * @param {{ excludeRootPrefixes?: string[] }} options
 * @returns {string}
 */
export function prefixPathWithDomainMode(href, modePathPrefix, options = {}) {
  const normalizedHref = String(href || '').trim()
  const normalizedPrefix = String(modePathPrefix || '').trim()
  if (!normalizedHref || !normalizedPrefix) return normalizedHref
  if (!normalizedHref.startsWith('/') || normalizedHref.startsWith('//')) return normalizedHref

  const excludeRootPrefixes = Array.isArray(options.excludeRootPrefixes)
    ? options.excludeRootPrefixes
    : ['/api', '/_next', '/admin', '/login']

  if (excludeRootPrefixes.some((prefix) => normalizedHref === prefix || normalizedHref.startsWith(`${prefix}/`))) {
    return normalizedHref
  }

  if (normalizedHref === normalizedPrefix || normalizedHref.startsWith(`${normalizedPrefix}/`) || normalizedHref.startsWith(`${normalizedPrefix}#`) || normalizedHref.startsWith(`${normalizedPrefix}?`)) {
    return normalizedHref
  }

  if (normalizedHref === '/') return normalizedPrefix
  return `${normalizedPrefix}${normalizedHref}`
}

/**
 * Detect the domain mode implied by a given hostname.
 *
 * Matching rules (applied in order):
 *   1. Bare localhost resolves to the default domain; 127.0.0.1 is not auto-detected.
 *   2. A single subdomain of localhost is treated as a local domain when the label names a valid
 *      domain, or when the host itself is mapped to one (so a local alias may differ from its key,
 *      e.g. `brand.localhost` for the `brand-key` domain).
 *   3. Exact match against a key in the map.
 *   4. Suffix match — the hostname ends with '.<mapKey>' (i.e. the map key
 *      is an ancestor domain, e.g. 'dev.example.com' matches 'example.com').
 *   5. Hostname-label hints, for hosts that sit under an unrelated root
 *      (e.g. 'dev.brand.example' resolves through the 'brand' label).
 *
 * Exact and suffix matches are checked before label hints so an explicit hostname
 * mapping always wins over a hostname-label hint.
 *
 * @param {string} hostname - The browser hostname (e.g. 'dev.example.com').
 * @returns {string|null} The detected domain mode, or null if no match.
 */
export function detectDomainFromHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return null
  const normalized = hostname.toLowerCase()
  const withoutPort = normalized.split(':')[0]

  // Bare localhost is the default workspace; use a named subdomain such as
  // <domain>.localhost to select a private domain during local development.
  if (withoutPort === 'localhost') return DEFAULT_DOMAIN_KEY
  if (withoutPort === '127.0.0.1' || withoutPort === '::1') return null

  const labels = withoutPort.split('.').filter(Boolean)
  const map = getHostnameDomainMap()

  // A local alias may differ from its domain key, so honour an explicit hostname
  // mapping as well as the label itself.
  if (labels.length === 2 && labels[1] === 'localhost' && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(labels[0])) {
    if (VALID_DOMAIN_MODES.includes(labels[0])) return labels[0]
    return map[withoutPort] || null
  }

  // Only a single subdomain of localhost names a domain; deeper hosts are not aliases.
  if (labels[labels.length - 1] === 'localhost') return null

  // 1. Exact match
  if (map[withoutPort]) return map[withoutPort]

  // 2. Suffix match (subdomain of a known root domain)
  for (const [domain, mode] of Object.entries(map)) {
    if (withoutPort.endsWith(`.${domain}`)) return mode
  }

  // 3. Label hint match
  const labelHints = getPrivateHostLabelHints()
  for (const label of labels) {
    if (labelHints[label]) return labelHints[label]
  }

  return null
}

/**
 * Return the human-readable display label for a domain mode identifier.
 *
 * @param {string} mode - A domain mode identifier.
 * @returns {string} The display name.
 */
export function getDomainLabel(mode) {
  const normalizedMode = String(mode || '').trim().toLowerCase() || DEFAULT_DOMAIN_MODE
  const privateLabels = getPrivateDomainLabels()
  if (privateLabels[normalizedMode]) return privateLabels[normalizedMode]

  switch (normalizedMode) {
    case 'default': return 'Default'
    default:
      return normalizedMode
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ') || getDomainLabel(DEFAULT_DOMAIN_MODE)
  }
}

/**
 * Resolve the effective domain mode using all available signals.
 *
 * A non-default hostname is authoritative after explicit path/header
 * overrides. Saved localStorage selection can override only the default
 * domain hostname or an unrecognized hostname. Deprecated modes are ignored
 * as signals, so none of them can become the active mode.
 *
 * Both URL signals are read from the browser location when the caller does not
 * pass one, so pages that only know their hostname still honor a path prefix or
 * an admin `?domain=` request. Signals from the URL always win over a hostname,
 * which is why an admin override is the only way to view another domain from a
 * branded host.
 *
 * @param {string|null} hostname - Current browser hostname (window.location.hostname).
 * @param {string|null} storedValue - Value from localStorage (may be null/empty).
 * @param {string} [pathname] - Current browser pathname (window.location.pathname).
 * @param {string|null} [overrideMode] - Explicit mode override value.
 * @param {{ allowAdminDomainOverride?: boolean }} [options] - Set
 *   `allowAdminDomainOverride: false` to ignore `?domain=` and any remembered
 *   admin override (non-superadmin admin sessions).
 * @returns {{ mode: string, source: 'pathname'|'hostname'|'stored'|'default'|'domain-override' }}
 */
export function getEffectiveDomainMode(hostname, storedValue, pathname = '', overrideMode = null, options = {}) {
  const resolvedPathname = pathname || getBrowserLocationPathname()
  const allowAdminDomainOverride = options.allowAdminDomainOverride !== false

  const explicitMode = normalizeDomainMode(overrideMode)
  if (explicitMode) {
    return { mode: explicitMode, source: 'pathname' }
  }

  const requestedMode = allowAdminDomainOverride
    ? getDomainModeOverrideFromSearch(getBrowserLocationSearch(), resolvedPathname)
    : null
  if (requestedMode) {
    return { mode: requestedMode, source: ADMIN_DOMAIN_OVERRIDE_SOURCE }
  }

  const pathMode = detectDomainFromPathname(resolvedPathname)
  if (pathMode) {
    return { mode: pathMode, source: 'pathname' }
  }

  const rememberedMode = allowAdminDomainOverride && isAdminSurfacePathname(resolvedPathname)
    ? normalizeDomainMode(readAdminDomainOverride())
    : null
  if (rememberedMode) {
    return { mode: rememberedMode, source: ADMIN_DOMAIN_OVERRIDE_SOURCE }
  }

  const fromHostname = detectDomainFromHostname(hostname)
  if (fromHostname && fromHostname !== DEFAULT_DOMAIN_MODE) {
    return { mode: fromHostname, source: 'hostname' }
  }

  const normalizedStored = normalizeDomainMode(storedValue)
  if (normalizedStored) {
    return { mode: normalizedStored, source: 'stored' }
  }

  if (fromHostname) {
    return { mode: fromHostname, source: 'hostname' }
  }

  return { mode: DEFAULT_DOMAIN_MODE, source: 'default' }
}

/**
 * Resolve domain mode from server request headers. Path/header overrides are
 * preferred so prefixed routes (/acme/...) are stable under shared hosts.
 *
 * @param {Headers|{ get: (name: string) => string | null }} headerStore
 * @returns {string}
 */
export function resolveDomainModeFromHeaders(headerStore) {
  const overridden = normalizeDomainMode(headerStore?.get?.(DOMAIN_MODE_OVERRIDE_HEADER) || '')
  if (overridden) return overridden

  for (const headerName of DOMAIN_MODE_PATHNAME_HEADERS) {
    const headerValue = String(headerStore?.get?.(headerName) || '').split(',')[0].trim()
    const fromPath = detectDomainFromPathname(headerValue)
    if (fromPath) return fromPath
  }

  const hostHeader = headerStore?.get?.('x-forwarded-host') || headerStore?.get?.('host') || ''
  const hostname = String(hostHeader).split(',')[0].trim()
  return detectDomainFromHostname(hostname) || DEFAULT_DOMAIN_MODE
}
