import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_ADMIN_DASHBOARD_CARD_ORDER,
    normalizeAdminDashboardCardOrder,
} from '../src/lib/adminDashboardCardOrder.js'
import {
    FILES_PAGE_FEATURE_FLAG_KEY,
    getDefaultDomainFeatureFlags,
    isFilesPageFeatureEnabled,
    normalizeDomainFeatureFlags,
} from '../src/lib/domainFeatureFlags.js'
import { buildPatientFilesHref, describeFileOwner, formatFileSize } from '../src/lib/fileDisplay.js'

test('the Files page is off for every domain by default', () => {
    assert.equal(FILES_PAGE_FEATURE_FLAG_KEY, 'filesEnabled')
    for (const domainKey of ['default', 'acmeot', 'anything-else']) {
        assert.equal(getDefaultDomainFeatureFlags(domainKey).filesEnabled, false)
        assert.equal(isFilesPageFeatureEnabled({}, domainKey), false)
    }
})

test('a stored or submitted flag switches the Files page on', () => {
    assert.equal(normalizeDomainFeatureFlags({ filesEnabled: true }, 'acmeot').filesEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ filesEnabled: 'true' }, 'acmeot').filesEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ filesEnabled: 'false' }, 'acmeot').filesEnabled, false)
    assert.equal(isFilesPageFeatureEnabled({ filesEnabled: true }, 'acmeot'), true)
})

test('the Files card has a place in the dashboard order', () => {
    assert.ok(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.includes('files'))
    assert.ok(
        DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.indexOf('files') > DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.indexOf('docs'),
        'Files sits after Docs'
    )
    assert.ok(normalizeAdminDashboardCardOrder(['patients']).includes('files'))
})

test('file sizes read in the largest sensible unit', () => {
    assert.equal(formatFileSize(0), '0 B')
    assert.equal(formatFileSize(512), '512 B')
    assert.equal(formatFileSize(1536), '1.5 KB')
    assert.equal(formatFileSize(10 * 1024 * 1024), '10 MB')
    assert.equal(formatFileSize('nonsense'), '')
})

test('a practice-level file is labelled as the practice owns it', () => {
    assert.equal(describeFileOwner({ patientId: null }), 'Practice')
    assert.equal(describeFileOwner({ patientId: 42 }), 'Patient #42')
    assert.equal(describeFileOwner({ patientId: 42, patientName: 'Sam Rivers' }), 'Sam Rivers')
    // The file API returns snake_case rows, and the dashboard card reuses them.
    assert.equal(describeFileOwner({ patient_id: 7, patient_name: 'Ari Blake' }), 'Ari Blake')
    assert.equal(describeFileOwner({ patient_id: 7, patient_name: null }), 'Patient #7')
    assert.equal(describeFileOwner({ patient_id: null, patient_name: null }), 'Practice')
    assert.equal(describeFileOwner(), 'Practice')
})

test('a patient file links to the Files tab and keeps a return path', () => {
    assert.equal(buildPatientFilesHref(42), '/admin/patients?patientId=42&tab=files')
    assert.equal(
        buildPatientFilesHref(42, { returnTo: '/admin/files' }),
        '/admin/patients?patientId=42&tab=files&returnTo=%2Fadmin%2Ffiles'
    )
    assert.equal(buildPatientFilesHref(null), '')
})
