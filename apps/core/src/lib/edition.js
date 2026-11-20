/**
 * Which edition is running.
 *
 * The same application serves a hosted, multi-site deployment and a single-install
 * deployment of one practice. The differences that matter to routing are small but real:
 * a solo install has no public website, so its entry point is the admin portal rather than
 * the marketing home page.
 *
 * `cloud` is the default so an existing deployment behaves exactly as before; solo installs
 * set `PRACTICE_MANAGER_EDITION=solo` (the desktop shell and the compose file do).
 */

const SOLO_EDITIONS = new Set(['solo', 'solo-desktop', 'solo-docker'])

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {'solo'|'cloud'}
 */
export function resolveEdition(env = process.env) {
  const raw = String(env.PRACTICE_MANAGER_EDITION ?? '').trim().toLowerCase()
  return SOLO_EDITIONS.has(raw) ? 'solo' : 'cloud'
}

export function isSoloEdition(env = process.env) {
  return resolveEdition(env) === 'solo'
}
