/**
 * Admin role registry.
 *
 * `admin_users.role` stores one of the values below. The registry is the single
 * source of truth for three things:
 *
 *   - what the role is called in the admin UI,
 *   - whether the role is scoped to an assigned `domain` (`requiresDomain`), and
 *   - whether a superadmin may assign it through `/admin/users` (`assignable`).
 *
 * Adding a role here is all the plumbing a new assignment needs; the API, the
 * picker, and the domain-scope rules read their behaviour from this table. Role
 * permissions beyond "which domain" are deliberately not defined yet, so every
 * assignable role today is domain-scoped.
 *
 * Keep this module dependency-free: it is imported by both client and server code
 * (the users page, the auth helpers, and the user API).
 */

export const ADMIN_ROLE_SUPERADMIN = 'superadmin'

/**
 * Legacy value stored before roles were assignable. It always meant the
 * domain-scoped admin, so it normalizes to `domain_admin`.
 */
export const ADMIN_ROLE_LEGACY_ADMIN = 'admin'

export const ADMIN_ROLE_DOMAIN_ADMIN = 'domain_admin'

/** Roles a superadmin may assign to a database-managed admin. */
export const ADMIN_ROLES = [
    {
        value: ADMIN_ROLE_DOMAIN_ADMIN,
        label: 'Domain admin',
        description: 'Admin access limited to the assigned domain.',
        requiresDomain: true,
        assignable: true,
    },
    {
        value: ADMIN_ROLE_SUPERADMIN,
        label: 'Superadmin',
        description: 'Configured with ADMIN_USERNAME / ADMIN_PASSWORD and not assignable here.',
        requiresDomain: false,
        assignable: false,
    },
]

/**
 * Role given to a database-managed admin when the caller does not name one.
 * Every database-managed admin is domain-scoped.
 */
export const DEFAULT_ADMIN_ROLE = ADMIN_ROLE_DOMAIN_ADMIN

const ROLE_BY_VALUE = new Map(ADMIN_ROLES.map((role) => [role.value, role]))

/**
 * Normalize a stored or submitted role.
 *
 * Accepts the separators a human might type (`Domain admin`, `domain-admin`) and
 * folds the legacy `admin` value into `domain_admin`, so callers never have to
 * special-case rows written before roles were assignable.
 *
 * @param {unknown} value
 * @returns {string} Canonical role value, or '' when it is not a known role.
 */
export function normalizeAdminRole(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === ADMIN_ROLE_LEGACY_ADMIN) return ADMIN_ROLE_DOMAIN_ADMIN
    return ROLE_BY_VALUE.has(normalized) ? normalized : ''
}

/**
 * Registry entry for a role, or null when the value is not a known role.
 *
 * @param {unknown} value
 * @returns {{ value: string, label: string, description: string, requiresDomain: boolean, assignable: boolean } | null}
 */
export function getAdminRoleDefinition(value) {
    return ROLE_BY_VALUE.get(normalizeAdminRole(value)) || null
}

/** Human-readable label for a stored role; falls back to the raw value. */
export function getAdminRoleLabel(value) {
    return getAdminRoleDefinition(value)?.label || String(value || '').trim()
}

/** Roles a superadmin may assign through the users page. */
export function getAssignableAdminRoles() {
    return ADMIN_ROLES.filter((role) => role.assignable)
}

/** True when a superadmin may assign the role. */
export function isAssignableAdminRole(value) {
    return getAdminRoleDefinition(value)?.assignable === true
}

/** True when the role is scoped to an assigned domain. */
export function adminRoleRequiresDomain(value) {
    return getAdminRoleDefinition(value)?.requiresDomain === true
}

/** Any signed-in admin, whatever the role (superadmins included). */
export function isAnyAdminUser(user) {
    return Boolean(user) && Boolean(normalizeAdminRole(user.role))
}

/** Shortest domain key accepted for a domain-scoped admin. */
export const ADMIN_DOMAIN_MIN_LENGTH = 2

/**
 * Normalize a domain key submitted with a role assignment.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAdminRoleDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key)
}

/**
 * Resolve the role/domain pair for a create or update.
 *
 * `input` is the caller's payload: a key that is absent leaves the stored value
 * alone on an update, while a key that is present (even empty) is applied. Omit
 * both keys on an update to leave the role and domain untouched.
 *
 * The pair is always written together: changing to a role that does not use a
 * domain clears it, and a role that requires one rejects an empty domain.
 *
 * @param {{ role?: unknown, domain?: unknown }} input
 * @param {{ role?: unknown, domain?: unknown }} [current] - stored values on an update.
 * @returns {{ role: string, domain: string | null } | { error: string }}
 */
export function resolveAdminRoleAssignment(input = {}, current = {}) {
    const submittedRole = hasOwn(input, 'role')
    const submittedDomain = hasOwn(input, 'domain')

    let role
    if (submittedRole) {
        role = normalizeAdminRole(input.role)
        if (!role) return { error: 'Unknown admin role' }
        if (!isAssignableAdminRole(role)) {
            return { error: 'The superadmin role is managed through ADMIN_USERNAME / ADMIN_PASSWORD' }
        }
    } else {
        role = normalizeAdminRole(current.role) || DEFAULT_ADMIN_ROLE
    }

    if (adminRoleRequiresDomain(role)) {
        const domain = submittedDomain
            ? normalizeAdminRoleDomain(input.domain)
            : normalizeAdminRoleDomain(current.domain)

        if (!domain) {
            return { error: `Domain is required for the ${getAdminRoleLabel(role).toLowerCase()} role` }
        }
        if (domain.length < ADMIN_DOMAIN_MIN_LENGTH) {
            return { error: `Domain must be at least ${ADMIN_DOMAIN_MIN_LENGTH} characters` }
        }
        return { role, domain }
    }

    if (submittedDomain && normalizeAdminRoleDomain(input.domain)) {
        return { error: `The ${getAdminRoleLabel(role).toLowerCase()} role covers every domain and does not take a domain` }
    }

    return { role, domain: null }
}
