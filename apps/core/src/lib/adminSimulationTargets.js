/**
 * Target selection for superadmin "simulate a domain admin" sessions.
 *
 * Simulation used to always mint a synthetic `sim-admin-<domain>` identity, which
 * has no `admin_users` row and therefore no notification preferences and no email.
 * Letting the superadmin pick a real admin makes the simulated session behave like
 * that person's, so preference and email-delivery behaviour can actually be tested.
 */

export const SYNTHETIC_SIM_TARGET = '__none__'

export function normalizeSimulationDomain(value) {
    return String(value || '').trim().toLowerCase()
}

/**
 * The admins that may be simulated for a domain, sorted for a stable picker order.
 */
export function filterSimulationAdmins(users, domain) {
    const normalizedDomain = normalizeSimulationDomain(domain)
    if (!normalizedDomain) return []

    return (Array.isArray(users) ? users : [])
        .map((user) => ({
            username: String(user?.username || '').trim(),
            email: String(user?.email || '').trim(),
            domain: normalizeSimulationDomain(user?.domain),
        }))
        .filter((user) => user.username && user.domain === normalizedDomain)
        .sort((a, b) => a.username.localeCompare(b.username))
}

/**
 * Picker options: the synthetic domain-scoped identity, then the domain's admins.
 *
 * With more than one admin an unselectable placeholder goes first, so entering
 * simulation requires an explicit choice instead of silently defaulting to
 * whichever admin happens to sort first.
 */
export function buildSimulationOptions(admins, domain, { placeholderLabel = 'Choose an admin…' } = {}) {
    const normalizedDomain = normalizeSimulationDomain(domain)
    const adminOptions = (Array.isArray(admins) ? admins : []).map((admin) => ({
        value: admin.username,
        label: admin.email ? `${admin.username} · ${admin.email}` : `${admin.username} · no email`,
    }))

    const syntheticOption = {
        value: SYNTHETIC_SIM_TARGET,
        label: `No specific admin (sim-admin-${normalizedDomain})`,
    }

    if (adminOptions.length <= 1) {
        return [syntheticOption, ...adminOptions]
    }

    return [{ value: '', label: placeholderLabel, disabled: true }, syntheticOption, ...adminOptions]
}

/**
 * The initial picker value: a lone admin is unambiguous so it is preselected;
 * several admins require an explicit choice; none falls back to synthetic.
 */
export function defaultSimulationTarget(admins) {
    const adminCount = Array.isArray(admins) ? admins.length : 0
    if (adminCount === 1) return admins[0].username
    if (adminCount > 1) return ''
    return SYNTHETIC_SIM_TARGET
}

/** False while the picker is still on the placeholder, which blocks starting a simulation. */
export function isSimulationTargetChosen(target) {
    return String(target || '').trim() !== ''
}

/** The username to send to the API; empty means "use the server's synthetic identity". */
export function resolveSimulationUsername(target) {
    const value = String(target || '').trim()
    if (!value || value === SYNTHETIC_SIM_TARGET) return ''
    return value
}
