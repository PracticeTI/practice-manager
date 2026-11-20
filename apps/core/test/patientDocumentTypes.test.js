import test from 'node:test'
import assert from 'node:assert/strict'
import {
    PATIENT_DOCUMENT_TYPE_BY_KEY,
    buildPatientDocumentsHref,
    selectRecentDocuments,
} from '../src/lib/patientDocumentTypes.js'

const rows = {
    quotes: [
        { id: 1, updated_at: '2026-01-01T00:00:00.000Z' },
        { id: 2, updated_at: '2026-03-01T00:00:00.000Z' },
    ],
    cases: [
        { id: 10, updated_at: '2026-02-01T00:00:00.000Z' },
    ],
    analyses: [
        { id: 20, updatedAt: '2026-04-01T00:00:00.000Z' },
        { id: 21, updatedAt: '2026-01-15T00:00:00.000Z' },
    ],
}

test('picks the newest row of each type, newest first', () => {
    const picked = selectRecentDocuments(rows)

    assert.deepEqual(
        picked.map(({ type, row }) => `${type.key}:${row.id}`),
        ['analyses:20', 'quotes:2', 'cases:10']
    )
})

test('caps the list so one busy type cannot fill the card', () => {
    const picked = selectRecentDocuments(rows, 1)

    assert.equal(picked.length, 1)
    assert.equal(picked[0].type.key, 'analyses')
    assert.equal(picked[0].row.id, 20)
})

test('skips types with no rows and tolerates a missing map', () => {
    assert.deepEqual(selectRecentDocuments({}, 3), [])
    assert.deepEqual(selectRecentDocuments(null, 3), [])

    const onlyQuotes = selectRecentDocuments({ quotes: [{ id: 5, created_at: '2026-05-01T00:00:00.000Z' }] })

    assert.equal(onlyQuotes.length, 1)
    assert.equal(onlyQuotes[0].type.key, 'quotes')
    assert.equal(onlyQuotes[0].row.id, 5)
})

test('orders rows with no timestamp last', () => {
    const picked = selectRecentDocuments({
        quotes: [{ id: 1 }],
        cases: [{ id: 2, updated_at: '2026-02-01T00:00:00.000Z' }],
    }, 2)

    assert.deepEqual(picked.map(({ type, row }) => `${type.key}:${row.id}`), ['cases:2', 'quotes:1'])
})

test('builds a Docs deep link per type', () => {
    assert.equal(buildPatientDocumentsHref('cases'), '/admin/docs?type=cases')
    assert.equal(buildPatientDocumentsHref('forms'), '/admin/docs?type=forms')
    assert.equal(buildPatientDocumentsHref('nope'), '/admin/docs')
    assert.equal(buildPatientDocumentsHref(''), '/admin/docs')
})

test('dates forms by when the patient submitted them', () => {
    const picked = selectRecentDocuments({
        forms: [
            { id: 1, submitted_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z' },
            { id: 2, submitted_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-02T00:00:00.000Z' },
        ],
        cases: [{ id: 3, updated_at: '2026-03-01T00:00:00.000Z' }],
    }, 2)

    assert.deepEqual(picked.map(({ type, row }) => `${type.key}:${row.id}`), ['forms:2', 'cases:3'])
    assert.equal(PATIENT_DOCUMENT_TYPE_BY_KEY.forms.label, 'Forms')
})
