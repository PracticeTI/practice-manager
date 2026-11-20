/**
 * Deny-by-default rule for the whole `/api` surface.
 *
 * `/api/database/*` was closed first (see `databaseApiGate.js`) because that is
 * where credentials, patient records and destructive migrations lived. The rest
 * of the surface stayed open, and an audit found content writes, relationship
 * writes and vendor-spend endpoints all reachable without a token. Closing one
 * prefix only holds until the next route is added outside it, so the whole
 * prefix is closed here and opened deliberately, per method.
 *
 * A route is public only when a visitor without a session needs it *and* it does
 * not expose tenant data. Reads and writes are listed separately: `/api/content`
 * is readable by the public site but only an authenticated caller may POST to it,
 * and `/api/intake/save` accepts an anonymous POST (the patient's own form) while
 * its GET returns every submission and stays behind auth.
 *
 * Pure module: imported by middleware, so no Next.js or database imports.
 */

import { decideDatabaseApiAccess, isDatabaseApiPath } from './databaseApiGate.js'
import { getPrivatePublicApiRoutes } from './domainExtension.js'

export const API_PREFIX = '/api/'

/** `enforce` blocks unauthenticated requests; `report` logs and lets them through. */
export const GATE_MODES = ['enforce', 'report']

/**
 * Routes a caller without a session may use, and the methods they may use.
 *
 * `:name` matches one path segment; `*` matches the rest of the path. Adding an
 * entry is a security decision, not a convenience.
 */
export const PUBLIC_API_ROUTES = [
  // Operational, and kept reachable so an uptime check and the deployment guard work.
  { path: '/api/health', methods: ['GET'] },

  // Sign-in and first-run setup. Setup itself refuses to run outside development.
  { path: '/api/auth/login', methods: ['POST'] },
  { path: '/api/auth/verify', methods: ['POST'] },
  { path: '/api/auth/setup-status', methods: ['GET'] },
  { path: '/api/auth/setup', methods: ['POST'] },

  // Brand and social assets fetched by the browser or a scraper with no session.
  { path: '/api/branding/icon', methods: ['GET'] },
  { path: '/api/branding/manifest', methods: ['GET'] },
  { path: '/api/images/manifest', methods: ['GET'] },
  { path: '/api/og/image', methods: ['GET'] },

  // Public site content: listings and the hero article. Writes stay behind auth.
  { path: '/api/content', methods: ['GET'] },
  { path: '/api/content/:id', methods: ['GET'] },
  { path: '/api/practice/news', methods: ['GET'] },

  // Domain presentation reads. The matching PATCH handlers stay behind auth.
  { path: '/api/settings/display-policy', methods: ['GET'] },
  { path: '/api/settings/domain-admin-link', methods: ['GET'] },
  { path: '/api/settings/domain-homepage-palette', methods: ['GET'] },

  // Presentation reads used by the public pages and by plain `<img>` tags, which
  // cannot send an Authorization header. Both handlers are deliberately
  // unauthenticated; see their route comments.
  { path: '/api/settings/domains/cache-config', methods: ['GET'] },
  { path: '/api/settings/domain-artwork', methods: ['GET'] },

  // Catalogue reads. The directory pages are browsable without a session; every
  // write (`/review`, `/favorites`, `web-search`, DELETE) stays behind auth.
  { path: '/api/providers', methods: ['GET'] },
  { path: '/api/equipment', methods: ['GET'] },

  // Media resolution used by the public homepage.
  { path: '/api/images/resolve', methods: ['GET'] },

  // Contact form: GET issues a session token, POST verifies it before sending.
  { path: '/api/contact', methods: ['GET', 'POST'] },
  { path: '/api/contact/asana', methods: ['POST'] },

  // Patient-facing intake. `save` autosaves the visitor's own answers; its GET,
  // which returns every submission, is deliberately absent.
  { path: '/api/intake/schema', methods: ['GET'] },
  { path: '/api/intake/form', methods: ['GET'] },
  { path: '/api/intake/save', methods: ['POST'] },
  { path: '/api/intake/submit', methods: ['POST'] },
  { path: '/api/intake/chat', methods: ['POST'] },

  // Public booking, rate limited per IP inside the handlers.
  { path: '/api/scheduling/booking', methods: ['GET', 'POST'] },
  { path: '/api/scheduling/booking/availability', methods: ['GET'] },
  { path: '/api/scheduling/agent', methods: ['POST'] },
  { path: '/api/scheduling/confirm', methods: ['GET', 'POST'] },
  { path: '/api/scheduling/waitlist/offer', methods: ['GET', 'POST'] },

  // The provider redirect cannot carry a bearer token; the state token and its
  // cookie are what authorize the callback.
  { path: '/api/scheduling/calendar/oauth/:provider/start', methods: ['GET'] },
  { path: '/api/scheduling/calendar/oauth/:provider/callback', methods: ['GET'] },

  // Read-only ICS feed authorized by an HMAC over domain and practitioner.
  { path: '/api/calendar/feed', methods: ['GET'] },

  // Inbound mail webhook, authorized by its own shared secret.
  { path: '/api/email/inbound', methods: ['POST'] },
  { path: '/api/webhooks/resend/inbound', methods: ['POST'] },

  // Routes an operator's extension layer ships and declares public. The core names
  // none of them; each handler is still responsible for authorizing its caller.
  ...getPrivatePublicApiRoutes(),
]

/**
 * Resolve the gate mode for the whole API surface.
 *
 * `API_GATE` is the only knob: it governs the `/api/database` gate as well, so the two
 * cannot disagree about whether the surface is being enforced.
 */
export function resolveApiGateMode(env = process.env) {
  const requested = String(env.API_GATE || '').trim().toLowerCase()
  return GATE_MODES.includes(requested) ? requested : 'enforce'
}

/** Strip query, hash and any trailing slash so `/x/` and `/x` compare equal. */
export function normalizeApiPath(pathname) {
  const raw = String(pathname || '').split('?')[0].split('#')[0]
  if (raw.length > 1 && raw.endsWith('/')) return raw.replace(/\/+$/, '')
  return raw
}

/** True for the API surface, excluding `/api` itself. */
export function isApiPath(pathname) {
  const normalized = normalizeApiPath(pathname)
  return normalized.startsWith(API_PREFIX)
}

function matchesPattern(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)

  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index]
    if (segment === '*') return true
    if (actual[index] === undefined) return false
    if (segment.startsWith(':')) continue
    if (segment !== actual[index]) return false
  }

  return expected.length === actual.length
}

/** True when an anonymous caller may use this method on this path. */
export function isPublicApiRequest(pathname, method = 'GET') {
  const normalized = normalizeApiPath(pathname)
  // A HEAD is a GET without a body, and Next.js serves it from the GET handler.
  const normalizedMethod = String(method || 'GET').toUpperCase().replace('HEAD', 'GET')

  return PUBLIC_API_ROUTES.some(
    (route) =>
      route.methods.includes(normalizedMethod) && matchesPattern(route.path, normalized)
  )
}

/**
 * Decide what to do with a request to the API surface.
 *
 * @param {{ pathname?: string, method?: string, authenticated?: boolean, isService?: boolean }} input
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ action: 'allow'|'deny'|'log', reason: string, status?: number }}
 */
export function decideApiAccess(input, env = process.env) {
  const pathname = normalizeApiPath(input?.pathname)
  const method = String(input?.method || 'GET').toUpperCase()

  if (!isApiPath(pathname)) return { action: 'allow', reason: 'not-api' }
  // CORS preflight carries no credentials by design.
  if (method === 'OPTIONS') return { action: 'allow', reason: 'preflight' }
  if (input?.isService) return { action: 'allow', reason: 'service' }
  if (input?.authenticated) return { action: 'allow', reason: 'admin' }

  const mode = resolveApiGateMode(env)
  const scopedInput = { ...input, pathname, method }
  const databasePath = pathname === '/api/database' ? `${pathname}/` : pathname

  if (isDatabaseApiPath(databasePath)) {
    return decideDatabaseApiAccess({ ...scopedInput, pathname: databasePath }, env)
  }

  if (isPublicApiRequest(pathname, method)) return { action: 'allow', reason: 'public-allowlist' }
  if (mode === 'report') return { action: 'log', reason: 'unauthenticated' }

  return { action: 'deny', reason: 'unauthenticated', status: 401 }
}
