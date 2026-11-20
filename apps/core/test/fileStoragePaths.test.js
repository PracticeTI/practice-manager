import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildFileStorageDomainPrefix,
    buildFileStorageKey,
    sanitizeStorageDomain,
    sanitizeStorageFileName,
} from '../src/lib/fileStoragePaths.js'

test('patient files are keyed under their patient', () => {
    assert.equal(
        buildFileStorageKey({ domain: 'acmeot', patientId: 12, fileId: 7, fileName: 'OT report.pdf' }),
        'domains/acmeot/patients/12/7-OT report.pdf'
    )
})

test('practice-level files are keyed under the practice', () => {
    assert.equal(
        buildFileStorageKey({ domain: 'acmeot', patientId: null, fileId: 9, fileName: 'referral form.pdf' }),
        'domains/acmeot/practice/9-referral form.pdf'
    )
})

test('a deployment prefix namespaces every key', () => {
    assert.equal(
        buildFileStorageKey({ domain: 'acmeot', patientId: 3, fileId: 1, fileName: 'a.pdf', prefix: 'clinic-a' }),
        'clinic-a/domains/acmeot/patients/3/1-a.pdf'
    )
    assert.equal(
        buildFileStorageDomainPrefix({ domain: 'acmeot', prefix: 'clinic-a' }),
        'clinic-a/domains/acmeot/'
    )
})

test('a file name cannot escape its key or carry control characters', () => {
    assert.equal(sanitizeStorageFileName('../../etc/passwd'), 'etc-passwd')
    assert.equal(sanitizeStorageFileName('nested\\path.pdf'), 'nested-path.pdf')
    assert.equal(sanitizeStorageFileName('report\u0000.pdf'), 'report.pdf')
    assert.equal(sanitizeStorageFileName('   .hidden '), 'hidden')
    assert.equal(sanitizeStorageFileName(''), 'file')
})

test('a long file name is trimmed from the front so the extension survives', () => {
    const longName = `${'a'.repeat(200)}.pdf`
    const sanitized = sanitizeStorageFileName(longName)
    assert.ok(sanitized.length <= 120)
    assert.ok(sanitized.endsWith('.pdf'))
})

test('the domain segment cannot escape its prefix', () => {
    assert.equal(sanitizeStorageDomain('../../evil'), 'evil')
    assert.equal(sanitizeStorageDomain('AcmeOT'), 'acmeot')
    assert.equal(sanitizeStorageDomain(''), 'default')
})

test('a key needs a file id', () => {
    assert.throws(() => buildFileStorageKey({ domain: 'x', fileName: 'a.pdf' }), /file id/)
})
