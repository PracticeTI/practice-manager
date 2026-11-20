import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFormIntakeAnswers } from '../src/lib/forms.js'
import {
    DEFAULT_NATIVE_INTAKE_FORM,
    buildIntakeReference,
    buildNativeIntakeContent,
    defaultIntakeSettingsForDomain,
    extractIntakeContact,
    intakeFormsForMode,
    mergeIntakeSettings,
    normalizeIntakeSettings,
    normalizeNativeIntakeForm,
    resolveIntakeChoice,
    validateIntakeSubmission,
    validateNativeIntakeForm,
} from '../src/lib/nativeIntake.js'

const VALID_ANSWERS = {
    'patient-full-name': 'Jane Citizen',
    email: 'Jane@Example.com',
    'client-phone': '0450 150 301',
    'funding-source': 'NDIS',
    'reason-for-referral': 'Home assessment',
    consent: 'Yes',
}

test('default form is well formed and every question has a unique id', () => {
    const form = normalizeNativeIntakeForm(DEFAULT_NATIVE_INTAKE_FORM)
    assert.ok(form.sections.length >= 4)
    assert.deepEqual(validateNativeIntakeForm(form).errors, [])

    const ids = form.sections.flatMap((section) => section.questions.map((question) => question.id))
    assert.equal(new Set(ids).size, ids.length)
})

test('editing normalises ids, types, options and drops blank questions', () => {
    const form = normalizeNativeIntakeForm({
        title: '  Test form  ',
        sections: [
            {
                title: 'Section one',
                questions: [
                    { label: 'Your name' },
                    { label: 'Age', type: 'not-a-type' },
                    { label: '   ' },
                    { label: 'Colour', type: 'select', options: ['Red', 'Blue', 'Red'] },
                ],
            },
        ],
    })

    assert.equal(form.title, 'Test form')
    assert.equal(form.sections.length, 1)
    assert.deepEqual(form.sections[0].questions.map((question) => question.label), ['Your name', 'Age', 'Colour'])
    assert.equal(form.sections[0].questions[1].type, 'text')
    assert.deepEqual(form.sections[0].questions[2].options, ['Red', 'Blue'])
})

test('duplicate ids are made unique instead of colliding', () => {
    const form = normalizeNativeIntakeForm({
        sections: [
            { title: 'Same', questions: [{ id: 'dup', label: 'One' }, { id: 'dup', label: 'Two' }] },
        ],
    })

    const ids = form.sections[0].questions.map((question) => question.id)
    assert.equal(new Set(ids).size, 2)
})

test('publishing requires at least one section, one question and options for choice fields', () => {
    assert.ok(validateNativeIntakeForm({ sections: [] }).errors.includes('Add at least one section'))

    const { errors } = validateNativeIntakeForm({
        sections: [{ title: 'Only', questions: [{ label: 'Pick one', type: 'select' }] }],
    })
    assert.match(errors.join(' '), /needs at least one option/)
})

test('submission requires the required answers', () => {
    const { errors } = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, { answers: { 'patient-full-name': 'Jane' } })
    assert.ok(errors.includes('Email Address is required'))
    assert.ok(errors.includes('Client Phone is required'))
    assert.ok(errors.includes('Funding Source or Referral Type is required'))
    assert.ok(errors.includes('Reason for Referral is required'))
    assert.ok(errors.includes('I agree to be contacted about this intake is required'))
})

test('submission normalises email, phone and dates, and rejects bad values', () => {
    const ok = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, { answers: VALID_ANSWERS })
    assert.deepEqual(ok.errors, [])
    assert.equal(ok.answers.email, 'jane@example.com')
    assert.equal(ok.answers['client-phone'], '+61450150301')
    assert.equal(ok.answers.consent, 'Yes')

    const bad = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, {
        answers: { ...VALID_ANSWERS, email: 'nope', 'date-of-birth': '31/12/1990' },
    })
    assert.ok(bad.errors.includes('Email Address must be a valid email address'))
    assert.ok(bad.errors.includes('Date of Birth must be a date (YYYY-MM-DD)'))
})

test('submission only accepts published options', () => {
    const { errors } = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, {
        answers: { ...VALID_ANSWERS, 'funding-source': 'Crypto profits' },
    })
    assert.match(errors.join(' '), /must be one of/)
})

test('checkboxes are joined and yes/no is normalised', () => {
    const definition = {
        sections: [{
            title: 'Pick',
            questions: [
                { id: 'extras', label: 'Extras', type: 'checkboxes', options: ['A', 'B', 'C'] },
                { id: 'flag', label: 'Flag', type: 'yesno' },
            ],
        }],
    }
    const { answers, errors } = validateIntakeSubmission(definition, {
        answers: { extras: ['A', 'C', 'Z'], flag: 'yes' },
    })

    assert.deepEqual(errors, [])
    assert.equal(answers.extras, 'A, C')
    assert.equal(answers.flag, 'Yes')
})

test('a filled honeypot is treated as spam', () => {
    const result = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, {
        answers: VALID_ANSWERS,
        company_website: 'http://spam.example',
    })
    assert.deepEqual(result.errors, ['spam'])
    assert.equal(result.answers, null)
})

test('answers project onto the canonical patient intake fields', () => {
    const { answers: clean } = validateIntakeSubmission(DEFAULT_NATIVE_INTAKE_FORM, {
        answers: {
            ...VALID_ANSWERS,
            'claim-number': '43123456',
            'referrer-name': 'Dr Who',
            'referrer-relationship': 'GP',
            'referrer-phone': '0390000000',
            'ndis-goals': 'Live independently',
        },
    })
    const content = buildNativeIntakeContent(DEFAULT_NATIVE_INTAKE_FORM, clean)
    const { answers, matchedFields } = buildFormIntakeAnswers(content, { title: 'New client intake' })
    assert.equal(answers.patient_full_name, 'Jane Citizen')
    assert.equal(answers.client_phone, '+61450150301')
    assert.equal(answers.funding_source_or_referral_type, 'NDIS')
    assert.equal(answers.claim_or_reference_number, '43123456')
    assert.equal(answers.referrer_full_name, 'Dr Who')
    assert.equal(answers.referrer_relationship, 'GP')
    assert.equal(answers.reasons_for_referral_to_ot, 'Home assessment')
    assert.equal(answers.ndis_goals, 'Live independently')
    assert.ok(matchedFields.includes('patient_full_name'))
})

test('contact extraction takes the patient name, never the referrer', () => {
    const contact = extractIntakeContact(DEFAULT_NATIVE_INTAKE_FORM, {
        ...VALID_ANSWERS,
        'referrer-name': 'Dr Who',
        'referrer-phone': '0390000000',
    })

    assert.equal(contact.name, 'Jane Citizen')
    assert.equal(contact.email, 'jane@example.com')
    assert.equal(contact.phone, '+61450150301')
})

test('submission references are readable', () => {
    assert.equal(buildIntakeReference(22), 'IN-0022')
    assert.equal(buildIntakeReference(null), '')
})

test('mode decides which forms can be rendered', () => {
    assert.deepEqual(intakeFormsForMode('splose'), ['splose'])
    assert.deepEqual(intakeFormsForMode('native'), ['native'])
    assert.deepEqual(intakeFormsForMode('both').sort(), ['native', 'splose'])
    assert.deepEqual(intakeFormsForMode('nonsense'), ['splose'])
})

test('a request cannot switch on a form the practice turned off', () => {
    assert.equal(resolveIntakeChoice('splose', 'native').form, 'splose')
    assert.equal(resolveIntakeChoice('native', 'splose').form, 'native')
    assert.equal(resolveIntakeChoice('both', 'splose').form, 'splose')
    assert.equal(resolveIntakeChoice('both', 'native').form, 'native')
    assert.equal(resolveIntakeChoice('both', '').form, 'splose')
})

test('domains without an overlay default to the Splose embed', () => {
    assert.equal(defaultIntakeSettingsForDomain('default').mode, 'splose')
    assert.equal(defaultIntakeSettingsForDomain('example-domain').mode, 'splose')
})

test('a partial settings patch keeps the configured mode', () => {
    const merged = mergeIntakeSettings(
        defaultIntakeSettingsForDomain('default'),
        { notificationEmail: 'reception@example.com' }
    )
    assert.equal(merged.mode, 'splose')
    assert.equal(merged.notificationEmail, 'reception@example.com')
})

test('settings normalise invalid modes and emails', () => {
    const settings = normalizeIntakeSettings({ mode: 'weird', notificationEmail: 'not-an-email' })
    assert.equal(settings.mode, 'splose')
    assert.equal(settings.notificationEmail, '')
    assert.ok(settings.consentText.length > 0)
})
