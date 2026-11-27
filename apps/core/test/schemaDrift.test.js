import test from 'node:test'
import assert from 'node:assert/strict'

import { describeDrift, diffSchemas, isExpectedBootstrapObject, parseRoles } from '../src/lib/schemaDrift.js'

const policy = (overrides = {}) => ({
    kind: 'policy',
    key: 'patient_report_jobs.patient_report_jobs_rls_policy',
    definition: {
        name: 'patient_report_jobs_rls_policy',
        table: 'patient_report_jobs',
        permissive: 'PERMISSIVE',
        roles: ['practice'],
        cmd: 'ALL',
        qual: 'true',
        with_check: 'true',
        ...overrides,
    },
})

test('a per-user permissive queue policy is the only bootstrap addition allowed', () => {
    assert.equal(isExpectedBootstrapObject(policy(), { currentUser: 'practice' }), true)
    assert.equal(isExpectedBootstrapObject(policy({ roles: '{practice}' }), { currentUser: 'practice' }), true)
    assert.equal(isExpectedBootstrapObject(policy({ roles: ['public'] }), { currentUser: 'practice' }), false)
    assert.equal(isExpectedBootstrapObject(policy({ qual: 'domain = 1' }), { currentUser: 'practice' }), false)
    assert.equal(
        isExpectedBootstrapObject(policy({ name: 'patients_domain_policy', key: 'patients.patients_domain_policy' }), {
            currentUser: 'practice',
        }),
        false
    )
    assert.equal(isExpectedBootstrapObject(policy(), { currentUser: 'someone-else' }), false)
})

test('parses the roles column the driver returns as raw array text', () => {
    assert.deepEqual(parseRoles('{practice}'), ['practice'])
    assert.deepEqual(parseRoles('{practice_manager_app,"odd,role"}'), ['practice_manager_app', 'odd,role'])
    assert.deepEqual(parseRoles(['anon']), ['anon'])
    assert.deepEqual(parseRoles(''), [])
})

test('a table created only by an initialiser is drift', () => {
    const before = [{ kind: 'table', key: 'patients', definition: {} }]
    const after = [...before, { kind: 'table', key: 'lazy_feature', definition: {} }]

    const drift = diffSchemas(before, after, { currentUser: 'practice' })

    assert.equal(drift.unexpected.length, 1)
    assert.equal(drift.unexpected[0].key, 'lazy_feature')
    assert.deepEqual(describeDrift(drift), ['+ table lazy_feature'])
})

test('the allowed queue policies are counted but not reported as drift', () => {
    const before = [{ kind: 'table', key: 'patient_report_jobs', definition: {} }]
    const after = [...before, policy()]

    const drift = diffSchemas(before, after, { currentUser: 'practice' })

    assert.equal(drift.allowed.length, 1)
    assert.equal(drift.unexpected.length, 0)
    assert.deepEqual(describeDrift(drift), [])
})

test('a changed definition or a removed object is drift', () => {
    const before = [
        { kind: 'index', key: 'patients_domain_idx', definition: { definition: 'CREATE INDEX ... (domain)' } },
        { kind: 'column', key: 'patients.email', definition: { data_type: 'text' } },
    ]
    const after = [
        { kind: 'index', key: 'patients_domain_idx', definition: { definition: 'CREATE INDEX ... (domain, id)' } },
    ]

    const drift = diffSchemas(before, after, { currentUser: 'practice' })

    assert.equal(drift.changed.length, 1)
    assert.equal(drift.removed.length, 1)
    assert.equal(drift.unexpected.length, 3)
})
