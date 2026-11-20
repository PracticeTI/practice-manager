import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildPatientImportAnswers,
    deriveFundingSource,
    diffPatientFields,
    mapCsvRowToPatient,
    mergePatientImportMetadata,
    normalizePatientRecord,
    parsePatientCsv,
} from '../src/lib/patients.js'

const SAMPLE_CSV = [
    'ID,Title,First Name,Last Name,Preferred Name,Date of Birth,Sex,Email,Mobile Phone,Address Line 1,City,State,Postal Code,Country,NDIS Number,Tags,Referral Name,Relationship',
    '1000001,,Jordan,Doe,,1960-01-01,Female,,+61 0400000001,1 Example St,Exampleton,VIC,3000,Australia,900000001,"Plan-managed, Current",,',
    '1000002,Ms,Avery,Sample,,1955-06-15,Female,avery.sample@example.com,+61 0400000002,2/16 Sample St,Exampleton,VIC,3000,Australia,,"TAC, Current",Dr Example Referrer,Sibling',
].join('\n')

test('parses patient rows and reports unrecognised columns', () => {
    const parsed = parsePatientCsv(SAMPLE_CSV)

    assert.equal(parsed.rowCount, 2)
    assert.deepEqual(parsed.unknownHeaders, ['Relationship'])
    assert.equal(parsed.records[0].rowNumber, 2)
    assert.equal(parsed.records[0].raw.external_id, '1000001')
    assert.equal(parsed.records[0].raw.first_name, 'Jordan')
})

test('builds the patient name from the name parts', () => {
    const { records } = parsePatientCsv(SAMPLE_CSV)
    const record = normalizePatientRecord(records[1].raw)

    assert.equal(record.patient_name, 'Avery Sample')
    assert.equal(record.first_name, 'Avery')
    assert.equal(record.title, 'Ms')
})

test('ignores the BOM and blank trailing rows', () => {
    const parsed = parsePatientCsv(`\uFEFFID,First Name,Last Name\n1,Ada,Lovelace\n,\n`)

    assert.equal(parsed.rowCount, 1)
    assert.equal(parsed.records[0].raw.external_id, '1')
})

test('derives funding from scheme numbers and tag text', () => {
    assert.equal(deriveFundingSource({ ndis_number: '431874971' }), 'NDIS')
    assert.equal(deriveFundingSource({ tags: 'TAC, Current' }), 'TAC')
    assert.equal(deriveFundingSource({ tags: 'Plan-managed, Current' }), 'NDIS')
    assert.equal(deriveFundingSource({ fund_management: 'NDIA-managed, Current' }), 'NDIS')
    assert.equal(deriveFundingSource({ other_details: 'Lets Get Care - HCP provider.' }), 'HCP/ My Aged Care')
    assert.equal(deriveFundingSource({}), null)
})

test('maps the export onto the app intake answers', () => {
    const { records } = parsePatientCsv(SAMPLE_CSV)
    const importedRow = mapCsvRowToPatient(records[1].raw)
    const answers = importedRow.metadata.sploseAnswers
    const labelled = importedRow.metadata.sploseLabelledAnswers

    assert.equal(importedRow.external_id, '1000002')
    assert.equal(importedRow.external_source, 'splose')
    assert.equal(importedRow.patient_name, 'Avery Sample')
    assert.equal(answers.patient_full_name, 'Avery Sample')
    assert.equal(answers.date_of_birth, '1955-06-15')
    assert.equal(answers.client_phone, '+61 0400000002')
    assert.equal(answers.funding_source_or_referral_type, 'TAC')
    assert.equal(answers.referrer_full_name, 'Dr Example Referrer')
    assert.deepEqual(answers.address, {
        addressLine1: '2/16 Sample St',
        city: 'Exampleton',
        state: 'VIC',
        postalCode: '3000',
        country: 'Australia',
    })
    assert.equal(labelled['Funding Source or Referral Type'], 'TAC')
    assert.equal(labelled['Full name'], 'Dr Example Referrer')
    assert.deepEqual(labelled.Address, answers.address)
})

test('keeps a partial address as an answer without labelling it', () => {
    const record = normalizePatientRecord({ external_id: '1', first_name: 'Ada', last_name: 'Lovelace', city: 'Exampleton' })
    const { answers, labelledAnswers } = buildPatientImportAnswers(record)

    assert.deepEqual(answers.address, { addressLine1: '', city: 'Exampleton', state: '', postalCode: '', country: '' })
    assert.equal(labelledAnswers.Address, undefined)
})

test('stores the remaining export columns under splosePatient', () => {
    const { records } = parsePatientCsv(SAMPLE_CSV)
    const importedRow = mapCsvRowToPatient(records[1].raw)

    assert.equal(importedRow.metadata.splosePatient.externalId, '1000002')
    assert.equal(importedRow.metadata.splosePatient.title, 'Ms')
    assert.equal(importedRow.metadata.splosePatient.email, 'avery.sample@example.com')
    assert.equal(importedRow.metadata.splosePatient.external_id, undefined)
})

test('merges import metadata without dropping keys owned elsewhere', () => {
    const merged = mergePatientImportMetadata(
        {
            patientSourcing: { equipment: { supplierId: 'supplier-1' } },
            patientAgents: { reporting: true },
            sploseAnswers: { client_phone: 'old' },
        },
        {
            splosePatient: { externalId: '1' },
            sploseAnswers: { client_phone: 'new' },
            sploseLabelledAnswers: { 'Client Phone': 'new' },
        }
    )

    assert.deepEqual(merged.patientSourcing, { equipment: { supplierId: 'supplier-1' } })
    assert.deepEqual(merged.patientAgents, { reporting: true })
    assert.equal(merged.sploseAnswers.client_phone, 'new')
    assert.equal(merged.sploseLabelledAnswers['Client Phone'], 'new')
    assert.equal(merged.splosePatient.externalId, '1')
})

test('only diffs fields that actually changed', () => {
    const existing = {
        patient_name: 'Avery Sample',
        metadata: { sploseAnswers: { client_phone: '123' } },
    }
    const same = {
        patient_name: 'avery  sample',
        metadata: { sploseAnswers: { client_phone: '123' } },
    }
    const changed = {
        patient_name: 'Avery Sample',
        metadata: { sploseAnswers: { client_phone: '999' } },
    }

    assert.deepEqual(diffPatientFields(existing, same), [])
    assert.equal(diffPatientFields(existing, changed).length, 1)
    assert.equal(diffPatientFields(existing, changed)[0].key, 'metadata')
})
