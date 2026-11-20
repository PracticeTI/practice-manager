import test from 'node:test'
import assert from 'node:assert/strict'
import {
    applyFormAnswersToPatientMetadata,
    buildFormIntakeAnswers,
    diffFormFields,
    mapCsvRowToForm,
    normalizeFormContent,
    normalizeFormRecord,
    parseFormCsv,
} from '../src/lib/forms.js'

// A trimmed copy of the reference Splose form export: the same sections,
// question types and the "Submittted At" header typo.
const FORM_CONTENT = [
    {
        title: 'Acme OT Intake Form',
        questions: [
            { type: 'Statement', title: 'Thank you for choosing Acme OT', answerText: 'We are proud...' },
            { type: 'Patient name', title: 'Patient full name', firstName: 'Justin', lastName: 'McAdam' },
            {
                type: 'Dropdown',
                title: 'Funding Source or Referral Type',
                choices: [{ body: 'NDIS' }, { body: 'TAC' }],
                checkboxes: [{ value: 'NDIS', label: 'NDIS', checked: true }],
                answerText: 'NDIS',
            },
            { type: 'Phone', title: 'Client Phone', phone: [{ type: 'Mobile', code: '+61', phoneNumber: '0438 585 223' }] },
            {
                type: 'Address',
                title: 'Address',
                addressL1: '29 Alderford Dr',
                suburb: 'Wantirna',
                postalCode: '3152',
                state: 'VIC',
                country: 'Australia',
            },
            { type: 'Date of birth', title: 'Date of birth', birthDay: 28, birthMonth: 9, birthYear: 1961 },
            { type: 'Date', title: 'Accident date (if TAC)', required: false },
            {
                type: 'NDIS number',
                title: 'NDIS number/ TAC Claim Number/Work Cover Reference Number',
                ndisNumber: '431874971',
            },
        ],
    },
    {
        title: 'Referral Purpose',
        questions: [
            { type: 'Paragraph', title: 'Reasons for Referral to OT', answerText: 'Functional capacity Assessment' },
        ],
    },
    {
        title: 'Referrer Details',
        questions: [
            { type: 'Short answer', title: 'Full name', answerText: 'Claire Kuhnell' },
            { type: 'Short answer', title: 'Relationship', answerText: 'Support Coordinator' },
            { type: 'Custom numerical', title: 'Phone Number', customFieldId: 19790, answerText: 400926180 },
        ],
    },
    {
        title: 'NDIS Support Information (Optional)',
        questions: [
            { type: 'Yes/No', title: 'Has an NDIS Support Coordinator been assigned?', answerText: 'Yes' },
            {
                type: 'Short answer',
                title: 'What are their NDIS Goals?',
                answerText: 'Live independently',
                conditions: { rules: [] },
            },
        ],
    },
]

function toCsvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`
}

const SAMPLE_CSV = [
    'ID,Title,Content,Submitted Message,Submittted At,Patient Name,Patient ID,Archived',
    [
        4429228,
        'SEOT INTAKE FORM 2026',
        JSON.stringify(FORM_CONTENT),
        'Thank you, your responses have been received',
        '2026-07-13T01:02:49.000Z',
        'Justin McAdam',
        7419190,
        'No',
    ].map(toCsvCell).join(','),
].join('\n')

test('parses the form export and reports unrecognised columns', () => {
    const parsed = parseFormCsv(SAMPLE_CSV)

    assert.equal(parsed.rowCount, 1)
    assert.deepEqual(parsed.unknownHeaders, [])
    assert.equal(parsed.records[0].rowNumber, 2)
    assert.equal(parsed.records[0].raw.external_id, '4429228')
    assert.equal(parsed.records[0].raw.external_patient_id, '7419190')
})

test('reads the mis-spelled "Submittted At" header', () => {
    const parsed = parseFormCsv('ID,Title,Submittted At\n1,Mine,2026-07-13T01:02:49.000Z')

    assert.deepEqual(parsed.unknownHeaders, [])
    assert.equal(parsed.records[0].raw.submitted_at, '2026-07-13T01:02:49.000Z')
})

test('projects the submission answers onto the intake schema', () => {
    const { records } = parseFormCsv(SAMPLE_CSV)
    const form = mapCsvRowToForm(records[0].raw)
    const { answers } = form
    const labelledAnswers = form.labelled_answers

    assert.equal(form.submitted_at, '2026-07-13T01:02:49.000Z')
    assert.equal(form.archived, false)
    assert.equal(form.external_source, 'splose')
    assert.equal(answers.patient_full_name, 'Justin McAdam')
    assert.equal(answers.funding_source_or_referral_type, 'NDIS')
    assert.equal(answers.client_phone, '+61 0438 585 223')
    assert.equal(answers.date_of_birth, '1961-09-28')
    assert.equal(answers.claim_or_reference_number, '431874971')
    assert.equal(answers.reasons_for_referral_to_ot, 'Functional capacity Assessment')
    // A numeric answer is normalised to text so the intake field stays a string.
    assert.equal(answers.referrer_phone, '400926180')
    assert.deepEqual(answers.address, {
        addressLine1: '29 Alderford Dr',
        city: 'Wantirna',
        state: 'VIC',
        postalCode: '3152',
        country: 'Australia',
    })
    assert.equal(labelledAnswers['Funding Source or Referral Type'], 'NDIS')
    assert.equal(labelledAnswers['Date of birth'], '1961-09-28')
})

test('resolves "Full name" inside the referrer section, not the patient section', () => {
    assert.equal(buildFormIntakeAnswers(FORM_CONTENT).answers.referrer_full_name, 'Claire Kuhnell')
    assert.equal(buildFormIntakeAnswers(FORM_CONTENT).answers.referrer_relationship, 'Support Coordinator')
})

test('skips statements and unanswered questions', () => {
    const sections = normalizeFormContent(FORM_CONTENT)
    const first = sections[0]

    assert.equal(first.questions[0].answer, '')
    assert.equal(first.questions[6].answer, '')
    assert.equal(first.questions.length, 8)
})

test('re-normalising already parsed content keeps every answer', () => {
    const once = normalizeFormRecord({ external_id: '1', title: 'Mine', content: JSON.stringify(FORM_CONTENT) })
    const twice = normalizeFormRecord({ external_id: '1', title: 'Mine', content: once.content })

    assert.deepEqual(twice.answers, once.answers)
    assert.deepEqual(twice.content, once.content)
})

test('records the upstream submission as provenance', () => {
    const { records } = parseFormCsv(SAMPLE_CSV)
    const form = mapCsvRowToForm(records[0].raw)

    assert.equal(form.metadata.sploseForm.externalId, '4429228')
    assert.equal(form.metadata.sploseForm.submittedMessage, 'Thank you, your responses have been received')
    assert.equal(form.metadata.sploseForm.answeredCount, 12)
    assert.ok(form.metadata.sploseForm.matchedFields.includes('claim_or_reference_number'))
})

test('a repeat import of identical content reports no changes', () => {
    const { records } = parseFormCsv(SAMPLE_CSV)
    const incoming = mapCsvRowToForm(records[0].raw)

    assert.deepEqual(diffFormFields(incoming, incoming), [])

    const changed = diffFormFields(incoming, { ...incoming, title: 'Renamed form' })
    assert.deepEqual(changed, [{ key: 'title', value: 'Renamed form' }])
})

test('fills only blank patient intake answers', () => {
    const { records } = parseFormCsv(SAMPLE_CSV)
    const form = mapCsvRowToForm(records[0].raw)

    const blank = applyFormAnswersToPatientMetadata({}, {
        answers: form.answers,
        labelledAnswers: form.labelled_answers,
        form: { externalId: form.external_id, title: form.title, submittedAt: form.submitted_at },
        source: 'splose',
    })

    assert.equal(blank.changed, true)
    assert.equal(blank.metadata.sploseAnswers.referrer_full_name, 'Claire Kuhnell')
    assert.equal(blank.metadata.sploseFormIntake.externalId, '4429228')

    // A reviewed answer must survive a later import of the same submission.
    const reviewed = applyFormAnswersToPatientMetadata({
        sploseAnswers: { ...blank.metadata.sploseAnswers, reasons_for_referral_to_ot: 'Reviewed by clinician' },
        sploseLabelledAnswers: blank.metadata.sploseLabelledAnswers,
    }, {
        answers: form.answers,
        labelledAnswers: form.labelled_answers,
        form: { externalId: form.external_id },
        source: 'splose',
    })

    assert.equal(reviewed.changed, false)
    assert.equal(reviewed.metadata.sploseAnswers.reasons_for_referral_to_ot, 'Reviewed by clinician')
})

test('ignores the BOM and blank trailing rows', () => {
    const parsed = parseFormCsv(`\uFEFFID,Title\n1,Mine\n,\n`)

    assert.equal(parsed.rowCount, 1)
    assert.equal(parsed.records[0].raw.external_id, '1')
})
