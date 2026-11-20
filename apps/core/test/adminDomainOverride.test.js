import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ADMIN_DOMAIN_OVERRIDE_COOKIE,
    ADMIN_DOMAIN_OVERRIDE_MAX_AGE_SECONDS,
    ADMIN_DOMAIN_OVERRIDE_SOURCE,
    adminDomainOverrideCookieOptions,
    canUseAdminDomainOverride,
    normalizeAdminDomainOverride,
    parseAdminDomainOverrideCookie,
} from '../src/lib/adminDomainOverride.js'
import {
    DEFAULT_DOMAIN_KEY,
    DEFAULT_DOMAIN_MODE,
    getDomainModeOverrideFromSearch,
    getEffectiveDomainMode,
    isAdminSurfacePathname,
} from '../src/lib/domainMode.js'

test('normalizes only domain-key shaped values', () => {
    assert.equal(normalizeAdminDomainOverride(' Default '), 'default')
    assert.equal(normalizeAdminDomainOverride('example-domain_2'), 'example-domain_2')
    assert.equal(normalizeAdminDomainOverride('invalid;value'), '')
    assert.equal(normalizeAdminDomainOverride(null), '')
})

test('only superadmins can use the admin domain override', () => {
    assert.equal(canUseAdminDomainOverride({ role: 'superadmin' }), true)
    assert.equal(canUseAdminDomainOverride({ role: 'admin' }), false)
    assert.equal(canUseAdminDomainOverride(null), false)
})

test('parses the remembered domain cookie and ignores malformed values', () => {
    assert.equal(
        parseAdminDomainOverrideCookie(`other=value; ${ADMIN_DOMAIN_OVERRIDE_COOKIE}=Example-Domain`),
        'example-domain',
    )
    assert.equal(parseAdminDomainOverrideCookie(`${ADMIN_DOMAIN_OVERRIDE_COOKIE}=bad%ZZ`), '')
    assert.equal(parseAdminDomainOverrideCookie('other=value'), '')
})

test('uses secure, root-scoped cookie options when requested', () => {
    assert.deepEqual(adminDomainOverrideCookieOptions({ secure: true }), {
        path: '/',
        maxAge: ADMIN_DOMAIN_OVERRIDE_MAX_AGE_SECONDS,
        sameSite: 'lax',
        secure: true,
    })
})

test('accepts domain query overrides only on admin surfaces', () => {
    assert.equal(isAdminSurfacePathname('/admin/settings'), true)
    assert.equal(isAdminSurfacePathname('/default/admin/settings'), true)
    assert.equal(isAdminSurfacePathname('/contact'), false)
    assert.equal(getDomainModeOverrideFromSearch('?domain=default', '/admin'), DEFAULT_DOMAIN_KEY)
    assert.equal(getDomainModeOverrideFromSearch('?domain=unknown', '/admin'), null)
    assert.equal(getDomainModeOverrideFromSearch('?domain=default', '/contact'), null)
})

test('admin override takes precedence, but cannot rebrand public pages', () => {
    const previousWindow = globalThis.window
    globalThis.window = { location: { pathname: '/admin', search: '?domain=default' } }
    try {
        assert.deepEqual(getEffectiveDomainMode('example.com', null, '/admin'), {
            mode: DEFAULT_DOMAIN_KEY,
            source: ADMIN_DOMAIN_OVERRIDE_SOURCE,
        })
    } finally {
        if (previousWindow === undefined) delete globalThis.window
        else globalThis.window = previousWindow
    }

    assert.deepEqual(getEffectiveDomainMode(
        'example.com',
        null,
        '/contact',
        null,
        { allowAdminDomainOverride: true },
    ), { mode: DEFAULT_DOMAIN_MODE, source: 'default' })
})
