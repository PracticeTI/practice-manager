import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DOCS_BACKED_CARD_FLAG_KEYS,
    PATIENT_CARD_FLAG_KEYS,
    isDocsBackedPageEnabled,
    preserveOmittedPatientCardFlags,
} from '../src/lib/domainFeatureFlags.js'

function normalize(values = {}) {
    return {
        ...values,
        patientBillingEnabled: values.patientsEnabled === true && values.patientBillingEnabled === true,
        reportsCardEnabled: values.patientsEnabled === true && values.reportsCardEnabled !== false,
        casesCardEnabled: values.patientsEnabled === true && values.casesCardEnabled !== false,
        appointmentsCardEnabled: values.patientsEnabled === true && values.appointmentsCardEnabled !== false,
        formsCardEnabled: values.patientsEnabled === true && values.formsCardEnabled !== false,
        notesCardEnabled: values.patientsEnabled === true && values.notesCardEnabled !== false,
        docsCardEnabled: values.patientsEnabled === true && values.docsCardEnabled !== false,
        analysisCardEnabled: values.patientsEnabled === true && values.analysisCardEnabled !== false,
    }
}

test('patient card flags cover every Patients-dependent dashboard card', () => {
    assert.deepEqual([...PATIENT_CARD_FLAG_KEYS].sort(), [
        'analysisCardEnabled',
        'appointmentsCardEnabled',
        'casesCardEnabled',
        'docsCardEnabled',
        'formsCardEnabled',
        'notesCardEnabled',
        'patientBillingEnabled',
        'reportsCardEnabled',
    ])
})

test('a flag the caller omitted keeps its stored value', () => {
    const stored = { patientsEnabled: true, casesCardEnabled: false }
    const provided = { patientsEnabled: true }
    const result = preserveOmittedPatientCardFlags(normalize(provided), provided, stored)

    // The form's default would have said `true`; the stored `false` must win.
    assert.equal(normalize(provided).casesCardEnabled, true)
    assert.equal(result.casesCardEnabled, false)
})

test('a flag the caller omitted stays omitted when nothing is stored', () => {
    const stored = { patientsEnabled: true }
    const provided = { patientsEnabled: true }
    const result = preserveOmittedPatientCardFlags(normalize(provided), provided, stored)

    for (const flagKey of PATIENT_CARD_FLAG_KEYS) {
        assert.equal(Object.prototype.hasOwnProperty.call(result, flagKey), false, `${flagKey} should stay absent`)
    }
})

test('a stored flag survives even when the form state went stale', () => {
    // Reproduces the reported bug: the form believed Cases/Appointments/Forms were off
    // while the stored record had them on. The save must not write the stale state.
    const stored = {
        patientsEnabled: true,
        reportsCardEnabled: true,
        casesCardEnabled: true,
        appointmentsCardEnabled: true,
        formsCardEnabled: true,
        notesCardEnabled: true,
    }
    const staleFormState = {
        patientsEnabled: true,
        reportsCardEnabled: true,
        casesCardEnabled: false,
        appointmentsCardEnabled: false,
        formsCardEnabled: false,
        notesCardEnabled: true,
    }
    const provided = { patientsEnabled: true }
    const result = preserveOmittedPatientCardFlags(normalize(staleFormState), provided, stored)

    assert.equal(result.casesCardEnabled, true)
    assert.equal(result.appointmentsCardEnabled, true)
    assert.equal(result.formsCardEnabled, true)
    assert.equal(result.reportsCardEnabled, true)
    assert.equal(result.notesCardEnabled, true)
})

test('a flag the caller sent is normalized, not preserved', () => {
    const stored = { patientsEnabled: true, docsCardEnabled: true }
    const provided = { patientsEnabled: true, docsCardEnabled: false }
    const result = preserveOmittedPatientCardFlags(normalize(provided), provided, stored)

    assert.equal(result.docsCardEnabled, false)
})

test('turning Patients off clears the omitted flags rather than preserving them', () => {
    const stored = { patientsEnabled: true, docsCardEnabled: true, patientBillingEnabled: true }
    const provided = {
        patientsEnabled: false,
        docsCardEnabled: false,
        patientBillingEnabled: false,
    }
    const result = preserveOmittedPatientCardFlags(normalize(provided), provided, stored)

    assert.equal(result.patientsEnabled, false)
    assert.equal(result.docsCardEnabled, false)
    assert.equal(result.patientBillingEnabled, false)
})

test('unrelated settings are untouched', () => {
    const stored = { patientsEnabled: true }
    const provided = { patientsEnabled: true, displayName: 'Acme OT' }
    const result = preserveOmittedPatientCardFlags(normalize(provided), provided, stored)

    assert.equal(result.displayName, 'Acme OT')
})

test('docs-backed card pages stay enabled while the Docs card is on', () => {
    assert.deepEqual(DOCS_BACKED_CARD_FLAG_KEYS, [
        'casesCardEnabled',
        'formsCardEnabled',
        'analysisCardEnabled',
    ])

    for (const cardFlagKey of DOCS_BACKED_CARD_FLAG_KEYS) {
        const settings = { patientsEnabled: true, docsCardEnabled: true, [cardFlagKey]: false }
        assert.equal(isDocsBackedPageEnabled(settings, cardFlagKey), true, `${cardFlagKey} should stay reachable via Docs`)
    }
})

test('a docs-backed card page stays enabled when its own card is unchecked', () => {
    const settings = { patientsEnabled: true, docsCardEnabled: false, casesCardEnabled: true }
    assert.equal(isDocsBackedPageEnabled(settings, 'casesCardEnabled'), true)
})

test('an absent Docs flag leaves the Docs access point on', () => {
    const settings = { patientsEnabled: true, casesCardEnabled: false }
    assert.equal(isDocsBackedPageEnabled(settings, 'casesCardEnabled'), true)
})

test('a docs-backed card page is disabled when both its card and Docs are off', () => {
    const settings = { patientsEnabled: true, docsCardEnabled: false, casesCardEnabled: false }
    assert.equal(isDocsBackedPageEnabled(settings, 'casesCardEnabled'), false)
})

test('the Patients entity gates docs-backed card pages regardless of card flags', () => {
    const settings = { patientsEnabled: false, docsCardEnabled: true, casesCardEnabled: true }
    assert.equal(isDocsBackedPageEnabled(settings, 'casesCardEnabled'), false)
})
