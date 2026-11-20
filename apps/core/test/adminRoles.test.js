import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ADMIN_ROLE_DOMAIN_ADMIN,
    ADMIN_ROLE_LEGACY_ADMIN,
    DEFAULT_ADMIN_ROLE,
    adminRoleRequiresDomain,
    getAdminRoleLabel,
    getAssignableAdminRoles,
    isAssignableAdminRole,
    normalizeAdminRole,
    resolveAdminRoleAssignment,
} from '../src/lib/adminRoles.js'

test('normalizes the separators a human might type', () => {
    assert.equal(normalizeAdminRole('domain_admin'), ADMIN_ROLE_DOMAIN_ADMIN)
    assert.equal(normalizeAdminRole('Domain admin'), ADMIN_ROLE_DOMAIN_ADMIN)
    assert.equal(normalizeAdminRole(' Domain-Admin '), ADMIN_ROLE_DOMAIN_ADMIN)
    assert.equal(normalizeAdminRole('SUPERADMIN'), 'superadmin')
    assert.equal(normalizeAdminRole('owner'), '')
    assert.equal(normalizeAdminRole(''), '')
    assert.equal(normalizeAdminRole(null), '')
})

test('every assignable role requires a domain', () => {
    assert.equal(adminRoleRequiresDomain(ADMIN_ROLE_DOMAIN_ADMIN), true)
    assert.equal(adminRoleRequiresDomain('superadmin'), false)
    assert.equal(adminRoleRequiresDomain('nope'), false)

    for (const role of getAssignableAdminRoles()) {
        assert.equal(role.requiresDomain, true, `${role.value} should require a domain`)
    }
})

test('the picker offers the domain admin role only', () => {
    const values = getAssignableAdminRoles().map((role) => role.value)
    assert.deepEqual(values, [ADMIN_ROLE_DOMAIN_ADMIN])
    assert.equal(isAssignableAdminRole(ADMIN_ROLE_DOMAIN_ADMIN), true)
    assert.equal(isAssignableAdminRole('superadmin'), false)
})

test('labels every registry role and falls back to the raw value', () => {
    assert.equal(getAdminRoleLabel(ADMIN_ROLE_DOMAIN_ADMIN), 'Domain admin')
    assert.equal(getAdminRoleLabel('superadmin'), 'Superadmin')
    assert.equal(getAdminRoleLabel('custom'), 'custom')
    assert.equal(getAdminRoleLabel(null), '')
})

test('the legacy admin value is the domain admin role', () => {
    assert.equal(normalizeAdminRole(ADMIN_ROLE_LEGACY_ADMIN), ADMIN_ROLE_DOMAIN_ADMIN)
    assert.equal(getAdminRoleLabel(ADMIN_ROLE_LEGACY_ADMIN), 'Domain admin')
})

test('a new admin defaults to the domain admin role and needs a domain', () => {
    assert.deepEqual(resolveAdminRoleAssignment({ domain: 'Acme' }), {
        role: DEFAULT_ADMIN_ROLE,
        domain: 'acme',
    })
    assert.equal(resolveAdminRoleAssignment({}).error, 'Domain is required for the domain admin role')
    assert.equal(
        resolveAdminRoleAssignment({ role: ADMIN_ROLE_DOMAIN_ADMIN, domain: '   ' }).error,
        'Domain is required for the domain admin role'
    )
    assert.equal(
        resolveAdminRoleAssignment({ role: ADMIN_ROLE_DOMAIN_ADMIN, domain: 'a' }).error,
        'Domain must be at least 2 characters'
    )
})

test('the superadmin role cannot be assigned through the users API', () => {
    assert.match(
        resolveAdminRoleAssignment({ role: 'superadmin', domain: 'acme' }).error,
        /ADMIN_USERNAME/
    )
    assert.equal(resolveAdminRoleAssignment({ role: 'owner' }).error, 'Unknown admin role')
})

test('an update keeps an unchanged domain', () => {
    const current = { role: ADMIN_ROLE_DOMAIN_ADMIN, domain: 'acme' }

    assert.deepEqual(resolveAdminRoleAssignment({ role: ADMIN_ROLE_DOMAIN_ADMIN }, current), {
        role: ADMIN_ROLE_DOMAIN_ADMIN,
        domain: 'acme',
    })
    assert.deepEqual(resolveAdminRoleAssignment({ domain: 'other' }, current), {
        role: ADMIN_ROLE_DOMAIN_ADMIN,
        domain: 'other',
    })
})

test('a role-only update rejects an empty domain for a domain admin', () => {
    const current = { role: ADMIN_ROLE_DOMAIN_ADMIN, domain: 'acme' }
    assert.equal(
        resolveAdminRoleAssignment({ domain: '' }, current).error,
        'Domain is required for the domain admin role'
    )
})

test('a legacy admin row keeps its domain when only the domain is updated', () => {
    const legacy = { role: ADMIN_ROLE_LEGACY_ADMIN, domain: 'acme' }
    assert.deepEqual(resolveAdminRoleAssignment({ domain: 'other' }, legacy), {
        role: ADMIN_ROLE_DOMAIN_ADMIN,
        domain: 'other',
    })
})
