import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ACTIVITY_ACTIONS,
    ACTIVITY_ENTITY_TYPES,
    activityActionLabel,
    activityEntityLabel,
    activitySummaryText,
    buildActivityDeepLink,
    describeImportSummary,
    normalizeActivityAction,
    normalizeActivityActorType,
    normalizeActivityEntityType,
    normalizeActivityRow,
} from '../src/lib/activityDisplay.js'
import { buildActivityWhere, parseActivityFilters } from '../src/lib/activitiesQuery.js'

test('vocabulary normalizers reject unknown values', () => {
    assert.equal(normalizeActivityAction('CREATE'), 'create')
    assert.equal(normalizeActivityAction('archive'), null)
    assert.equal(normalizeActivityEntityType('patient_file'), 'patient_file')
    assert.equal(normalizeActivityEntityType('invoice'), null)
    assert.equal(normalizeActivityActorType('Agent'), 'agent')
    assert.equal(normalizeActivityActorType('robot'), null)
})

test('every registered entity type resolves a label', () => {
    for (const entityType of ACTIVITY_ENTITY_TYPES) {
        assert.ok(activityEntityLabel(entityType), `missing label for ${entityType}`)
    }
    for (const action of ACTIVITY_ACTIONS) {
        assert.ok(activityActionLabel(action), `missing label for ${action}`)
    }
})

test('patient activities deep link straight to the patient record', () => {
    assert.equal(buildActivityDeepLink('patient', 42), '/admin/patients?patientId=42')
    assert.equal(buildActivityDeepLink('patient', '42'), '/admin/patients?patientId=42')
})

test('associated records deep link into the owning patient tab', () => {
    assert.equal(buildActivityDeepLink('case', 7, { patientId: 42 }), '/admin/patients?patientId=42&tab=cases')
    assert.equal(buildActivityDeepLink('note', 7, { patientId: 42 }), '/admin/patients?patientId=42&tab=notes')
    assert.equal(buildActivityDeepLink('form', 7, { patientId: 42 }), '/admin/patients?patientId=42&tab=forms')
    assert.equal(buildActivityDeepLink('patient_file', 7, { patientId: 42 }), '/admin/patients?patientId=42&tab=files')
    assert.equal(
        buildActivityDeepLink('transcription', 9, { patientId: 42 }),
        '/admin/patients?patientId=42&tab=transcripts&transcriptionId=9'
    )
})

test('deep links are null when they cannot focus a record', () => {
    assert.equal(buildActivityDeepLink('patient', null), null)
    assert.equal(buildActivityDeepLink('case', 7), null)
    assert.equal(buildActivityDeepLink('unknown_entity', 7, { patientId: 42 }), null)
})

test('activity rows normalize numeric ids and JSON metadata', () => {
    const row = normalizeActivityRow({
        id: '12',
        patient_id: '42',
        actor_type: 'AGENT',
        action: 'update',
        entity_type: 'note',
        metadata: '{"source":"api"}',
    })

    assert.equal(row.id, 12)
    assert.equal(row.patient_id, 42)
    assert.equal(row.actor_type, 'agent')
    assert.equal(row.entity_type, 'note')
    assert.deepEqual(row.metadata, { source: 'api' })
})

test('summary text combines the action and the record type', () => {
    assert.equal(activitySummaryText({ action: 'create', entityType: 'patient' }), 'Created Patient')
    assert.equal(activitySummaryText({ action: 'delete', entityType: 'note', entityLabel: 'Progress note' }), 'Deleted Note Progress note')
})

test('import summaries describe what the import changed', () => {
    assert.equal(describeImportSummary({ total: 12, inserted: 10, updated: 2, skipped: 0 }), '10 created, 2 updated')
    assert.equal(describeImportSummary({ total: 4, inserted: 0, updated: 0, skipped: 4 }), '4 skipped')
    assert.equal(describeImportSummary({ total: 3 }), '3 rows processed')
    assert.equal(describeImportSummary({ total: 1 }), '1 row processed')
    assert.equal(describeImportSummary({}), '0 rows processed')
})

function searchParams(values = {}) {
    const params = new URLSearchParams(values)
    return { get: (key) => params.get(key) }
}

test('activity filters normalize values and drop unknown ones', () => {
    const filters = parseActivityFilters(searchParams({
        entity_type: 'NOTE',
        action: 'archive',
        actor_type: 'robot',
        patient_id: '42',
        actor_id: '  sarah  ',
        entity_id: ' 7 ',
    }))

    assert.equal(filters.entityType, 'note')
    assert.equal(filters.action, null)
    assert.equal(filters.actorType, null)
    assert.equal(filters.patientId, 42)
    assert.equal(filters.actorId, 'sarah')
    assert.equal(filters.entityId, '7')
})

test('activity filters clamp paging and ignore an invalid since', () => {
    assert.equal(parseActivityFilters(searchParams({ limit: '9999' })).limit, 500)
    assert.equal(parseActivityFilters(searchParams({ limit: '0' })).limit, 100)
    assert.equal(parseActivityFilters(searchParams({ limit: 'abc' })).limit, 100)
    assert.equal(parseActivityFilters(searchParams({ offset: '-5' })).offset, 0)
    assert.equal(parseActivityFilters(searchParams({ offset: '200' })).offset, 200)
    assert.equal(parseActivityFilters(searchParams({ since: 'not-a-date' })).since, null)
    assert.equal(
        parseActivityFilters(searchParams({ since: '2026-10-06T00:00:00Z' })).since,
        '2026-10-06T00:00:00.000Z'
    )
})

test('activity where clauses parameterize and scope by domain', () => {
    assert.deepEqual(buildActivityWhere({}, {}), { clause: '', params: [] })

    const scoped = buildActivityWhere({ entityType: 'note', action: 'update' }, { domain: 'domain-a' })
    assert.equal(scoped.clause, 'WHERE domain = $1 AND entity_type = $2 AND action = $3')
    assert.deepEqual(scoped.params, ['domain-a', 'note', 'update'])
})

test('omitting the domain lists every domain', () => {
    const allDomains = buildActivityWhere({ entityType: 'patient' }, { domain: null })
    assert.equal(allDomains.clause, 'WHERE entity_type = $1')
    assert.deepEqual(allDomains.params, ['patient'])
})
