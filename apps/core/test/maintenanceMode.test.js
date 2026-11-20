import test from 'node:test'
import assert from 'node:assert/strict'
import {
    getDefaultDomainFeatureFlags,
    isMaintenanceModeActive,
    isMaintenanceModeFeatureEnabled,
    MAINTENANCE_MODE_FEATURE_FLAG_KEY,
    normalizeDomainFeatureFlags,
} from '../src/lib/domainFeatureFlags.js'
import { isPublicSurfacePath } from '../src/lib/publicSurface.js'

test('maintenance mode defaults off for every domain', () => {
    for (const domainKey of ['example-domain', '', undefined]) {
        assert.equal(getDefaultDomainFeatureFlags(domainKey)[MAINTENANCE_MODE_FEATURE_FLAG_KEY], false)
    }
})

test('maintenance mode defaults off when the stored record omits the flag', () => {
    const flags = normalizeDomainFeatureFlags({ patientsEnabled: true }, 'domain-a')
    assert.equal(flags.maintenanceModeEnabled, false)
})

test('maintenance mode normalises stored truthy values', () => {
    assert.equal(normalizeDomainFeatureFlags({ maintenanceModeEnabled: true }, 'domain-b').maintenanceModeEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ maintenanceModeEnabled: 'true' }, 'domain-b').maintenanceModeEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ maintenanceModeEnabled: 'false' }, 'domain-b').maintenanceModeEnabled, false)
})

test('isMaintenanceModeFeatureEnabled reads the flag off the stored record', () => {
    assert.equal(isMaintenanceModeFeatureEnabled({ maintenanceModeEnabled: true }, 'domain-b'), true)
    assert.equal(isMaintenanceModeFeatureEnabled({}, 'domain-b'), false)
})

test('isMaintenanceModeActive never activates outside production', () => {
    const settings = { maintenanceModeEnabled: true }

    assert.equal(isMaintenanceModeActive(settings, 'domain-b', false), false)
    assert.equal(isMaintenanceModeActive(settings, 'domain-b', undefined), false)
    assert.equal(isMaintenanceModeActive(settings, 'domain-b', true), true)
})

test('isMaintenanceModeActive stays off in production when the flag is off', () => {
    assert.equal(isMaintenanceModeActive({ maintenanceModeEnabled: false }, 'domain-b', true), false)
    assert.equal(isMaintenanceModeActive({}, 'domain-b', true), false)
})

test('the public frontend is classified as public', () => {
    for (const pathname of ['/', '/our-mission', '/domain-a', '/domain-a/patients', '/contact', '/allied-health/providers']) {
        assert.equal(isPublicSurfacePath(pathname), true, `${pathname} should be public`)
    }
})

test('operational surfaces are never gated', () => {
    for (const pathname of ['/admin', '/admin/settings/domains', '/login', '/settings', '/domains', '/domains?tab=features', '/presence', '/og', '/api/contact', '/_next/static/chunk.js']) {
        assert.equal(isPublicSurfacePath(pathname), false, `${pathname} should not be public`)
    }
})

test('unclassifiable pathnames are not treated as public', () => {
    for (const pathname of ['', 'not-a-path', 'https://example.com/', null, undefined]) {
        assert.equal(isPublicSurfacePath(pathname), false)
    }
})

test('query strings and hashes do not change the classification', () => {
    assert.equal(isPublicSurfacePath('/?utm=1'), true)
    assert.equal(isPublicSurfacePath('/admin?tab=features'), false)
    assert.equal(isPublicSurfacePath('/contact#form'), true)
})
