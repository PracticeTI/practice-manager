import { NextResponse } from 'next/server'
import {
  DEFAULT_DOMAIN_KEY,
  detectDomainFromHostname,
  detectDomainFromPathname,
  getDomainModeOverrideFromSearch,
  isAdminSurfacePathname,
  DOMAIN_MODE_OVERRIDE_HEADER,
  VALID_DOMAIN_MODES,
} from './src/lib/domainMode.js'
import { ADMIN_DOMAIN_COOKIE, normalizeAdminDomainKey } from './src/lib/adminDomainCookie.js'
import {
  ADMIN_DOMAIN_OVERRIDE_COOKIE,
  adminDomainOverrideCookieOptions,
  parseAdminDomainOverrideCookie,
} from './src/lib/adminDomainOverride.js'
import { PUBLIC_SURFACE_PATHNAME_HEADER } from './src/lib/publicSurface.js'
import {
  getPrivateRootRedirectDomains,
  getPrivateSharedRootDomains,
} from './src/lib/domainExtension.js'
import { decideApiAccess } from './src/lib/apiGate.js'
import { checkDatabaseEnvironment } from './src/lib/databaseEnvironmentGuard.js'
import { verifyAdminAuth, verifyServiceAuth } from './src/lib/auth.js'

const PUBLIC_FILE = /\.[^/]+$/
// The public content domains: their hosts serve the root homepage directly instead of
// rewriting `/` to a domain landing route.
const SHARED_ROOT_DOMAINS = new Set([DEFAULT_DOMAIN_KEY, ...getPrivateSharedRootDomains()])
const ROOT_REDIRECT_DOMAINS = getPrivateRootRedirectDomains()
const EXACT_ROUTE_PASSTHROUGH_DOMAINS = new Set(
  VALID_DOMAIN_MODES.filter((mode) => !SHARED_ROOT_DOMAINS.has(mode))
)
const EXCLUDED_PATH_PREFIXES = ['/api', '/_next']
const HOST_PREFIX_REWRITE_EXCLUDED_PATH_PREFIXES = ['/admin', '/login']

function shouldBypassPath(pathname) {
  if (!pathname) return false
  if (PUBLIC_FILE.test(pathname)) return true
  return EXCLUDED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function shouldBypassHostPrefixRewrite(pathname) {
  return HOST_PREFIX_REWRITE_EXCLUDED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function getHostnameFromRequest(request) {
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  return String(rawHost).split(',')[0].trim()
}

/**
 * Close the API surface to anonymous callers before any route runs.
 *
 * Returns a response to send when the request is refused, or null to let it
 * through to the normal domain handling.
 */
async function gateApi(request, pathname) {
  if (request.method === 'OPTIONS') return null

  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''

  const isService = verifyServiceAuth(request)
  const user = isService || !token ? null : await verifyAdminAuth(request)

  const decision = decideApiAccess({
    pathname,
    method: request.method,
    authenticated: Boolean(user),
    isService,
  })

  if (decision.action === 'deny') {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: decision.status || 401 })
  }

  if (decision.action === 'log') {
    console.warn(`[api-gate] would deny ${request.method} ${pathname} (${decision.reason})`)
  }

  return null
}

/**
 * Clone the request headers and record the *original* pathname so server
 * components can tell a public frontend request from an operational one
 * (see src/lib/publicSurface.js). Set before any host/path rewrite is applied.
 */
function buildSurfaceHeaders(request, pathname) {
  const headers = new Headers(request.headers)
  headers.set(PUBLIC_SURFACE_PATHNAME_HEADER, pathname)
  return headers
}

/**
 * Resolve the `?domain=` override for the admin portal, so server components
 * render the same domain the browser resolves.
 *
 * Returns the override to apply (from this request's query string, or from the
 * override cookie an earlier request left behind) and the domain to remember.
 *
 * Only superadmins may switch domains, but a token cannot be verified here — the
 * session lives in localStorage. That is safe because the API authorizes every
 * domain-scoped request itself (src/lib/adminDomainScopePolicy.js) and a
 * domain-scoped session is signalled by the admin domain cookie, which keeps its
 * own domain and is never overridden.
 */
function resolveAdminDomainOverride(request, pathname) {
  if (!isAdminSurfacePathname(pathname)) return { override: null, persist: null }

  const scopedDomain = normalizeAdminDomainKey(request.cookies?.get?.(ADMIN_DOMAIN_COOKIE)?.value)
  if (scopedDomain) return { override: null, persist: null }

  const requestedDomain = getDomainModeOverrideFromSearch(request.nextUrl.search, pathname)
  if (requestedDomain) return { override: requestedDomain, persist: requestedDomain }

  const rememberedDomain = parseAdminDomainOverrideCookie(request.headers.get('cookie'))
  const usableRememberedDomain = VALID_DOMAIN_MODES.includes(rememberedDomain) ? rememberedDomain : null

  return { override: usableRememberedDomain, persist: null }
}

/** Remember a `?domain=` request for later navigations that drop the query string. */
function rememberAdminDomainOverride(response, domain, request) {
  if (!domain) return response

  const isSecure = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol || '').startsWith('https')
  response.cookies.set(ADMIN_DOMAIN_OVERRIDE_COOKIE, domain, adminDomainOverrideCookieOptions({ secure: isSecure }))

  return response
}

export async function middleware(request) {
  const pathname = request.nextUrl.pathname || '/'
  const hostname = getHostnameFromRequest(request)

  // A deployment serving from the wrong database must not answer at all. /api/health
  // stays reachable so an uptime check can still tell the deployment is alive.
  if (pathname !== '/api/health') {
    const databaseEnv = checkDatabaseEnvironment()
    if (!databaseEnv.allowed) {
      return new NextResponse(databaseEnv.message, { status: 503 })
    }
  }

  const gateResponse = await gateApi(request, pathname)
  if (gateResponse) return gateResponse

  if (shouldBypassPath(pathname)) {
    return NextResponse.next()
  }

  const pathMode = detectDomainFromPathname(pathname)
  const adminDomainOverride = resolveAdminDomainOverride(request, pathname)
  if (!pathMode) {
    if (adminDomainOverride.override) {
      const requestHeaders = buildSurfaceHeaders(request, pathname)
      requestHeaders.set(DOMAIN_MODE_OVERRIDE_HEADER, adminDomainOverride.override)

      return rememberAdminDomainOverride(
        NextResponse.next({ request: { headers: requestHeaders } }),
        adminDomainOverride.persist,
        request
      )
    }

    const hostMode = detectDomainFromHostname(hostname)
    if (!hostMode || !EXACT_ROUTE_PASSTHROUGH_DOMAINS.has(hostMode) || shouldBypassHostPrefixRewrite(pathname)) {
      return NextResponse.next({ request: { headers: buildSurfaceHeaders(request, pathname) } })
    }

    const rewrittenUrl = request.nextUrl.clone()
    // For host-mapped scoped modes, keep non-root paths unprefixed (e.g.
    // scoped host + /contact stays /contact) and pass mode via header.
    // Root still rewrites to the scoped landing page route.
    rewrittenUrl.pathname = pathname === '/' ? `/${hostMode}` : pathname

    const requestHeaders = buildSurfaceHeaders(request, pathname)
    requestHeaders.set(DOMAIN_MODE_OVERRIDE_HEADER, hostMode)

    return NextResponse.rewrite(rewrittenUrl, {
      request: {
        headers: requestHeaders,
      },
    })
  }

  const pathSegments = pathname.split('/').filter(Boolean)
  const [, ...restSegments] = pathSegments
  const isRootModePath = restSegments.length === 0
  const hostMode = detectDomainFromHostname(hostname)

  if (isRootModePath && ROOT_REDIRECT_DOMAINS.has(pathMode) && hostMode === pathMode) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  }

  if (isRootModePath && EXACT_ROUTE_PASSTHROUGH_DOMAINS.has(pathMode)) {
    return NextResponse.next({ request: { headers: buildSurfaceHeaders(request, pathname) } })
  }

  const rewrittenPathname = isRootModePath ? '/' : `/${restSegments.join('/')}`
  const rewrittenUrl = request.nextUrl.clone()
  rewrittenUrl.pathname = rewrittenPathname

  const requestHeaders = buildSurfaceHeaders(request, pathname)
  requestHeaders.set(DOMAIN_MODE_OVERRIDE_HEADER, adminDomainOverride.override || pathMode)

  return rememberAdminDomainOverride(
    NextResponse.rewrite(rewrittenUrl, {
      request: {
        headers: requestHeaders,
      },
    }),
    adminDomainOverride.persist,
    request
  )
}

export const config = {
  matcher: ['/', '/((?!favicon.ico|robots.txt|sitemap.xml).*)'],
}
