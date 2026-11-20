/**
 * Fixed-string bypass tokens used by the localhost dev server and by preview
 * deployments.
 *
 * Because the token value is a constant in the bundle, it only means anything
 * while the deployment that minted it is the one checking it — so both tokens
 * are gated on the environment that mints them in src/lib/clientAdminAuth.js.
 * Kept free of Next.js imports so the gate can be unit tested.
 *
 * The preview token is deliberately **not** a superadmin. Preview deployments are
 * reachable by anyone who can pass Deployment Protection (team members, approved
 * access requests, shareable links, automation secrets), and a superadmin there
 * reads every tenant: route handlers take `domain` from the query string and the
 * row-level-security policies in lib/rlsPolicies.js short-circuit on
 * `app.current_role = 'superadmin'`.
 *
 * A scoped principal restores two layers at once. Routes take the domain-scoped
 * branch and reject a foreign `?domain=`, and `normalizeRole` maps the role to
 * `admin`, so RLS binds `app.current_domain` instead of bypassing the predicate.
 *
 * `ADMIN_PREVIEW_DOMAIN` must be set explicitly. Without it the preview token
 * resolves to null and no bypass exists, so a preview build cannot silently pick
 * a tenant.
 */

import { VALID_DOMAIN_MODES } from './domainMode.js'

export const LOCALHOST_DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'
export const PREVIEW_DEPLOYMENT_ADMIN_TOKEN = 'vercel-preview-admin-bypass-token'

/** Domain the preview bypass token is scoped to, or null when unset or invalid. */
export function resolvePreviewBypassDomain(env = process.env) {
  const requested = String(env.ADMIN_PREVIEW_DOMAIN || '').trim().toLowerCase()
  if (!requested) return null
  return VALID_DOMAIN_MODES.includes(requested) ? requested : null
}

function isLocalhostBypassAllowed(env) {
  return env.NODE_ENV === 'development'
}

function isPreviewBypassAllowed(env) {
  return env.ADMIN_PREVIEW_BYPASS === 'true' && env.VERCEL_ENV === 'preview'
}

/**
 * Resolve a bypass token to its admin principal, or null when the token is not a
 * bypass token or the current deployment is not allowed to honour it.
 *
 * @param {unknown} token
 * @param {Record<string, string|undefined>} [env]
 * @returns {{username: string, role: string, domain?: string, bypass: string}|null}
 */
export function resolveBypassAdmin(token, env = process.env) {
  const normalized = typeof token === 'string' ? token.trim() : ''
  if (!normalized) return null

  if (normalized === LOCALHOST_DEV_ADMIN_TOKEN) {
    return isLocalhostBypassAllowed(env)
      ? { username: 'localhost-dev', role: 'superadmin', bypass: 'localhost' }
      : null
  }

  if (normalized === PREVIEW_DEPLOYMENT_ADMIN_TOKEN) {
    if (!isPreviewBypassAllowed(env)) return null

    const domain = resolvePreviewBypassDomain(env)
    if (!domain) return null

    return {
      username: String(env.ADMIN_PREVIEW_USERNAME || '').trim() || 'vercel-preview',
      role: 'admin',
      domain,
      bypass: 'preview',
    }
  }

  return null
}

/** True only when the preview bypass token would actually be accepted. */
export function isPreviewBypassEnabled(env = process.env) {
  return resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, env) !== null
}
