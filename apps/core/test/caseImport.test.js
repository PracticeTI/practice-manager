import test from 'node:test'
import assert from 'node:assert/strict'
import {
    diffCaseFields,
    mapCsvRowToCase,
    mergeCaseMetadata,
    normalizeCaseRecord,
    parseCaseCsv,
    parseExportDate,
} from '../src/lib/patientCases.js'

// The reference export, verbatim: this header row is what the importer has to
// understand, so the mapping test doubles as the contract for it.
const REFERENCE_HEADERS = [
    'ID',
    'Status',
    'Case Number',
    'Track Type',
    'Used',
    'Total',
    'Provider Number',
    'Patient ID',
    'Patient Name',
    'Referral Contact ID',
    'Referral Contact Name',
    'Referral Period',
    'Files',
    'Appointment ID(s)',
    'Support Activity ID(s)',
    'Issue Date',
    'Expiry Date',
    'Notes',
    'Practitioner ID',
    'Practitioner Name',
    'Archived',
    'Invoice Recipient ID',
    'Invoice Recipient Name',
].join(',')

const REFERENCE_ROW = [
    '2217092',
    'Open',
    '0011',
    'Hours',
    '0',
    '40',
    '',
    '7592073',
    'Genevieve Holland',
    '1984441',
    'Suzana Talevska',
    'Standard',
    '',
    '',
    '',
    // Splose renders date-only columns as instants pinned to local midnight, so
    // these are 13 Aug 2026 00:00 and 13 Aug 2027 23:59 in Melbourne.
    '2026-08-12T14:00:00.000Z',
    '2027-08-13T13:59:59.000Z',
    '',
    '30119',
    'Kate O’Callaghan',
    'No',
    '',
    '',
].join(',')

const CASE_CSV = `${REFERENCE_HEADERS}\n${REFERENCE_ROW}`

test('parseCaseCsv understands every column of the reference export', () => {
    const { records, unknownHeaders, rowCount } = parseCaseCsv(CASE_CSV)

    assert.equal(rowCount, 1)
    assert.deepEqual(unknownHeaders, [])

    const { raw } = records[0]
    assert.equal(records[0].rowNumber, 2)
    assert.equal(raw.external_id, '2217092')
    assert.equal(raw.status, 'Open')
    assert.equal(raw.case_number, '0011')
    assert.equal(raw.case_type, 'Hours')
    assert.equal(raw.total_allocation, '40')
    assert.equal(raw.used_quantity, '0')
    assert.equal(raw.external_patient_id, '7592073')
    assert.equal(raw.patient_name, 'Genevieve Holland')
    assert.equal(raw.referral_contact, 'Suzana Talevska')
    assert.equal(raw.referral_period, 'Standard')
    assert.equal(raw.practitioner, 'Kate O’Callaghan')
})

test('parseCaseCsv reports genuinely unknown columns', () => {
    const csv = 'ID,Case Number,Mystery Column\n1,0001,hello'
    const { unknownHeaders } = parseCaseCsv(csv)

    assert.deepEqual(unknownHeaders, ['Mystery Column'])
})

test('mapCsvRowToCase projects the reference row onto the case shape', () => {
    const { records } = parseCaseCsv(CASE_CSV)
    const record = mapCsvRowToCase(records[0].raw)

    assert.equal(record.external_id, '2217092')
    assert.equal(record.external_source, 'splose')
    assert.equal(record.external_patient_id, '7592073')
    assert.equal(record.case_number, '0011')
    assert.equal(record.status, 'open')
    assert.equal(record.case_type, 'hours')
    assert.equal(record.total_allocation, 40)
    assert.equal(record.used_quantity, 0)
    assert.equal(record.practitioner, 'Kate O’Callaghan')
    assert.equal(record.referral_contact, 'Suzana Talevska')
    assert.equal(record.referral_period, 'Standard')
    assert.equal(record.patient_id, null)
})

test('export dates are read as calendar dates in the practice time zone', () => {
    // Pinned to local midnight: the UTC date part is a day early.
    assert.equal(parseExportDate('2026-08-12T14:00:00.000Z'), '2026-08-13')
    assert.equal(parseExportDate('2027-08-13T13:59:59.000Z'), '2027-08-13')
    // Already a plain date, and unsupported values.
    assert.equal(parseExportDate('2026-08-13'), '2026-08-13')
    assert.equal(parseExportDate(''), null)
    assert.equal(parseExportDate('not a date'), null)

    const { records } = parseCaseCsv(CASE_CSV)
    const record = normalizeCaseRecord(records[0].raw)
    assert.equal(record.issue_date, '2026-08-13')
    assert.equal(record.expiry_date, '2027-08-13')
})

test('case type and status are normalised from the export vocabulary', () => {
    assert.equal(normalizeCaseRecord({ case_type: 'Hours' }).case_type, 'hours')
    assert.equal(normalizeCaseRecord({ case_type: 'Sessions' }).case_type, 'sessions')
    assert.equal(normalizeCaseRecord({ case_type: 'Amount ($)' }).case_type, 'budget')
    assert.equal(normalizeCaseRecord({ case_type: '' }).case_type, 'budget')

    assert.equal(normalizeCaseRecord({ status: 'Open' }).status, 'open')
    assert.equal(normalizeCaseRecord({ status: 'Closed' }).status, 'closed')
    assert.equal(normalizeCaseRecord({ status: '' }).status, 'open')
    // An archived case is closed even when the status column still says open.
    assert.equal(normalizeCaseRecord({ status: 'Open', archived: 'Yes' }).status, 'closed')
    assert.equal(normalizeCaseRecord({ status: 'Open', archived: 'No' }).status, 'open')
})

test('allocation figures survive currency decoration', () => {
    const record = normalizeCaseRecord({ case_type: 'Amount', total_allocation: '$1,200.00', used_quantity: '350' })

    assert.equal(record.total_allocation, 1200)
    assert.equal(record.used_quantity, 350)
    assert.equal(normalizeCaseRecord({ total_allocation: '' }).total_allocation, 0)
})

test('provenance keeps the columns that have no case field', () => {
    const { records } = parseCaseCsv(`${REFERENCE_HEADERS}\n${REFERENCE_ROW}`)
    const record = mapCsvRowToCase(records[0].raw)
    const provenance = record.metadata.sploseCase

    assert.equal(provenance.externalId, '2217092')
    assert.equal(provenance.externalSource, 'splose')
    assert.equal(provenance.externalPatientId, '7592073')
    assert.equal(provenance.externalPractitionerId, '30119')
    assert.equal(provenance.externalReferralContactId, '1984441')
    assert.equal(provenance.trackType, 'Hours')
    assert.equal(provenance.usedQuantity, 0)
    assert.equal(provenance.archived, false)
    // Blank passthrough cells are dropped rather than stored as empty strings.
    assert.equal(Object.prototype.hasOwnProperty.call(provenance, 'externalProviderId'), false)
})

test('mergeCaseMetadata preserves keys the importer does not own', () => {
    const existing = { reviewer: 'kate', sploseCase: { externalId: '1', usedQuantity: 2 } }
    const merged = mergeCaseMetadata(existing, { sploseCase: { usedQuantity: 4, trackType: 'Hours' } })

    assert.equal(merged.reviewer, 'kate')
    assert.equal(merged.sploseCase.externalId, '1')
    assert.equal(merged.sploseCase.usedQuantity, 4)
    assert.equal(merged.sploseCase.trackType, 'Hours')
})

test('diffCaseFields reports only what changed', () => {
    const { records } = parseCaseCsv(CASE_CSV)
    const incoming = mapCsvRowToCase(records[0].raw)

    const stored = {
        external_id: '2217092',
        external_source: 'splose',
        external_patient_id: '7592073',
        case_number: '0011',
        status: 'open',
        case_type: 'hours',
        total_allocation: '40.00',
        practitioner: 'Kate O’Callaghan',
        issue_date: '2026-08-13',
        expiry_date: '2027-08-13',
        referral_contact: 'Suzana Talevska',
        referral_period: 'Standard',
        notes: null,
        metadata: incoming.metadata,
    }

    assert.deepEqual(diffCaseFields(stored, incoming), [])

    const changed = diffCaseFields(stored, { ...incoming, total_allocation: 44, status: 'closed' })
    assert.deepEqual(changed.map((change) => change.key).sort(), ['status', 'total_allocation'])
    assert.equal(changed.find((change) => change.key === 'total_allocation').value, 44)
})
