import test from 'node:test'
import assert from 'node:assert/strict'

import {
    EGRESS_CHANNEL_CHAT,
    EGRESS_CHANNEL_TRANSCRIPTION,
    PrivacyEgressError,
    buildIdentityBlockFromPatient,
    buildIdentityHeader,
    deidentifyLlmText,
    getEgressAuditCounters,
    guardOutgoingChat,
    guardOutgoingText,
    hydrateIdentityVariables,
    recordNonRedactableEgress,
    resetEgressAuditCounters,
    resolveSubjectNoun,
    restoreIdentityDeep,
    restoreIdentityInText,
    verifyDeidentifiedText,
} from '../src/lib/privacy/index.js'

const NDIS_PATIENT = {
    patient_name: 'Avery Sample',
    date_of_birth: '1979-03-02',
    ndis_number: '900000002',
    address_line_1: '10 Example St',
    city: 'Exampleton',
    state: 'VIC',
    postal_code: '3000',
    mobile_phone: '0400 123 456',
    email: 'avery.sample@example.com',
    medicare_card_number: '2233 44556 1',
    nominee_first_name: 'Robin',
    nominee_last_name: 'Sample',
}

const TAC_PATIENT = {
    patient_name: 'Anna Lee',
    tac_number: 'T123456',
    mobile_phone: '0400 000 111',
}

function ndisIdentity() {
    return buildIdentityBlockFromPatient(NDIS_PATIENT, { fundingSource: 'NDIS' })
}

function tacIdentity() {
    return buildIdentityBlockFromPatient(TAC_PATIENT, { fundingSource: 'TAC' })
}

test('names a non-NDIS record a patient and an NDIS record a participant', () => {
    assert.equal(resolveSubjectNoun({ fundingSource: 'NDIS' }), 'participant')
    assert.equal(resolveSubjectNoun({ fundingSource: 'TAC' }), 'patient')
    assert.equal(resolveSubjectNoun({ fundingSource: 'WorkCover' }), 'patient')
    assert.equal(resolveSubjectNoun({ fundingSource: 'Self funded' }), 'patient')
    // Unknown funding keeps the NDIS wording so a half-written report does not change voice.
    assert.equal(resolveSubjectNoun({}), 'participant')
    // An explicit noun always wins.
    assert.equal(resolveSubjectNoun({ fundingSource: 'NDIS', subjectNoun: 'patient' }), 'patient')
})

test('collects every identifying field a record holds, not just the FCA subset', () => {
    const identity = ndisIdentity()

    assert.equal(identity.participantName, 'Avery Sample')
    assert.equal(identity.dateOfBirth, '1979-03-02')
    assert.equal(identity.ndisNumber, '900000002')
    assert.equal(identity.address, '10 Example St, Exampleton, VIC 3000')
    assert.equal(identity.phone, '0400 123 456')
    assert.deepEqual(identity.emails, [{ value: 'avery.sample@example.com', role: '' }])
    assert.deepEqual(identity.people, [{ name: 'Robin Sample', role: 'nominee' }])
    assert.ok(
        identity.identifiers.some((entry) => entry.value === '2233 44556 1'),
        'Medicare card number must be in the identity block'
    )
})

test('replaces identifiers with role phrases instead of redaction markers', () => {
    const identity = ndisIdentity()
    const text = [
        'Avery Sample (DOB 1979-03-02) lives at 10 Example St, Exampleton, VIC 3000.',
        'NDIS 900000002. Medicare 2233 44556 1.',
        'Phone 0400 123 456, email avery.sample@example.com.',
        'Support worker Mary Jones attended.',
    ].join(' ')

    const redacted = deidentifyLlmText(text, { identity })

    assert.doesNotMatch(redacted, /Avery Sample/)
    assert.doesNotMatch(redacted, /1979-03-02/)
    assert.doesNotMatch(redacted, /900000002/)
    assert.doesNotMatch(redacted, /2233 44556 1/)
    assert.doesNotMatch(redacted, /10 Example St/)
    assert.doesNotMatch(redacted, /0400 123 456/)
    assert.doesNotMatch(redacted, /ling\.hu@example\.com/)
    assert.doesNotMatch(redacted, /Mary Jones/)
    assert.match(redacted, /the participant/)
    assert.doesNotMatch(redacted, /\bthe patient\b/)
})

test('a bare first name is replaced wherever it appears', () => {
    const redacted = deidentifyLlmText('Avery attended. Avery reports improved endurance.', {
        identity: ndisIdentity(),
    })
    assert.doesNotMatch(redacted, /\bAvery\b/)
    assert.match(redacted, /the participant attended/)
})

test('a non-NDIS record reads as the patient, including its claim number', () => {
    const redacted = deidentifyLlmText('Anna Lee attended. TAC claim number T123456.', {
        identity: tacIdentity(),
    })

    assert.doesNotMatch(redacted, /Anna Lee/)
    assert.doesNotMatch(redacted, /T123456/)
    assert.match(redacted, /the patient attended/)
    assert.match(redacted, /the patient's TAC claim number/)
    assert.doesNotMatch(redacted, /\bthe participant\b/)
})

test('keeps a full name ahead of its own first name', () => {
    // Ordering matters: replacing "Avery" first would leave "the participant Sample".
    const redacted = deidentifyLlmText('Avery Sample is a 45-year-old.', { identity: ndisIdentity() })
    assert.equal(redacted, 'the participant is a 45-year-old.')
})

test('verifies clean text and blocks a surviving identifier', () => {
    const identity = ndisIdentity()

    assert.equal(verifyDeidentifiedText('the participant reports improved endurance.', { identity }).ok, true)

    const leaked = verifyDeidentifiedText('Avery Sample reports improved endurance.', { identity })
    assert.equal(leaked.ok, false)
    assert.ok(leaked.blocking.length > 0)
    // Findings carry position and kind only: an audit record must not quote the leak.
    for (const finding of leaked.findings) {
        assert.equal(typeof finding.index, 'number')
        assert.equal(finding.value, undefined)
    }
})

test('does not mistake a written-out date for a phone number', () => {
    const identity = ndisIdentity()
    const result = verifyDeidentifiedText('Review recorded 12 07 2026 and next 15 09 2026.', { identity })
    assert.equal(result.ok, true)
    assert.equal(result.findings.length, 0)
})

test('blocks a call that would send an identifier and reports nothing identifying', () => {
    resetEgressAuditCounters()
    const identity = ndisIdentity()

    // A nine-digit number the glossary does not know: another patient's scheme number, a
    // mistyped one, or a sibling's. Nothing in the redactor targets that shape, so it reaches the
    // verifier - which is the whole point of having one.
    assert.throws(
        () => guardOutgoingText('Sibling claim 987654321 is linked.', {
            identity,
            channel: EGRESS_CHANNEL_CHAT,
        }),
        (error) => {
            assert.ok(error instanceof PrivacyEgressError)
            assert.equal(error.status, 422)
            assert.match(error.message, /identifier-number/)
            assert.doesNotMatch(error.message, /987654321/)
            return true
        }
    )

    assert.equal(getEgressAuditCounters()['chat:blocked'], 1)
})

test('guards a chat payload and leaves no identifier in any message', () => {
    resetEgressAuditCounters()
    const identity = ndisIdentity()

    const guarded = guardOutgoingChat({
        system: 'You are drafting a review for Avery Sample.',
        messages: [
            { role: 'user', content: 'Notes: Avery Sample uses a walker at 10 Example St.' },
            { role: 'assistant', content: 'Understood.' },
        ],
    }, { identity, channel: EGRESS_CHANNEL_CHAT })

    assert.doesNotMatch(guarded.system, /Avery Sample/)
    assert.doesNotMatch(guarded.messages[0].content, /Avery Sample/)
    assert.doesNotMatch(guarded.messages[0].content, /10 Example St/)
    assert.match(guarded.messages[0].content, /the participant/)
    assert.equal(getEgressAuditCounters()['chat:sent'], 1)
})

test('guards structured message parts as well as plain strings', () => {
    const guarded = guardOutgoingChat({
        messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Avery Sample reports pain.' }],
        }],
    }, { identity: ndisIdentity() })

    assert.equal(guarded.messages[0].content[0].text, 'the participant reports pain.')
})

test('restores the real values into the header and the template tokens', () => {
    const identity = ndisIdentity()
    const header = buildIdentityHeader(identity)

    assert.equal(header.name, 'Avery Sample')
    assert.equal(header.referenceNumber, '900000002')
    assert.equal(header.label, 'Avery Sample (NDIS number 900000002)')

    const variables = hydrateIdentityVariables(identity)
    assert.equal(variables.participant_name, 'Avery Sample')
    assert.equal(variables.patient_name, 'Avery Sample')
    assert.equal(variables.ndis_number, '900000002')
    assert.equal(variables.subject, 'the participant')
})

test('restores prose only when asked, and never third-party roles', () => {
    const identity = ndisIdentity()
    assert.equal(
        restoreIdentityInText('the participant reports that the support coordinator will review.', identity),
        'Avery Sample reports that the support coordinator will review.'
    )
})

test('round-trips a draft: the model sees a role, the document gets the name', () => {
    const identity = ndisIdentity()
    const draft = {
        summary: 'the participant requires support with showering.',
        lines: [
            { support_item_number: '15_617_0128_1_3', justification: 'the participant\'s carer reports two falls.' },
        ],
    }

    const outgoing = deidentifyLlmText(JSON.stringify(draft), { identity })
    assert.doesNotMatch(outgoing, /Avery Sample/)

    const restored = restoreIdentityDeep(draft, identity)
    assert.equal(restored.summary, 'Avery Sample requires support with showering.')
    assert.equal(restored.lines[0].justification, "Avery Sample's carer reports two falls.")
    // Structural values are untouched.
    assert.equal(restored.lines[0].support_item_number, '15_617_0128_1_3')
})

test('records transcription as a disclosed gap rather than a clean send', () => {
    resetEgressAuditCounters()
    const record = recordNonRedactableEgress({ channel: EGRESS_CHANNEL_TRANSCRIPTION, model: 'gpt-4o-mini-transcribe' })

    assert.equal(record.decision, 'disclosed-non-redactable')
    assert.match(record.reason, /audio cannot be de-identified/)
    assert.equal(getEgressAuditCounters()['transcription:disclosed-non-redactable'], 1)
})

test('an unknown identity still strips contact patterns', () => {
    const redacted = deidentifyLlmText('Email sarah@example.com or call 0400 555 666.', {})
    assert.doesNotMatch(redacted, /sarah@example\.com/)
    assert.doesNotMatch(redacted, /0400 555 666/)
})

test('builds the identity block for a patient still filling in the intake form', async () => {
    const { buildIntakeIdentity } = await import('../src/lib/intakeIdentity.js')

    const identity = buildIntakeIdentity({
        fields: [
            { id: 'f1', label: 'Full Name' },
            { id: 'f2', label: 'Date of Birth' },
            { id: 'f3', label: 'Mobile Number' },
            { id: 'f4', label: 'Email Address' },
            { id: 'f5', label: 'Street Address' },
            { id: 'f6', label: 'Suburb' },
            { id: 'f7', label: 'Funding Source or Referral Type' },
            { id: 'f8', label: 'Reason for referral' },
        ],
    }, {
        f1: 'Avery Sample',
        f2: '1979-03-02',
        f3: '0400 123 456',
        f4: 'avery.sample@example.com',
        f5: '10 Example St',
        f6: 'Exampleton',
        f7: 'NDIS',
        // Clinical, not identifying: it must not land in the block.
        f8: 'Home assessment after a fall',
    })

    assert.equal(identity.participantName, 'Avery Sample')
    assert.equal(identity.dateOfBirth, '1979-03-02')
    assert.equal(identity.phone, '0400 123 456')
    assert.equal(identity.address, '10 Example St, Exampleton')
    assert.deepEqual(identity.emails, [{ value: 'avery.sample@example.com', role: '' }])
    assert.equal(identity.subjectNoun, 'participant')

    // The collected answers no longer survive in the history the model is sent.
    const redacted = deidentifyLlmText(
        'My name is Avery Sample, born 1979-03-02, at 10 Example St, Exampleton. Call 0400 123 456.',
        { identity }
    )
    assert.doesNotMatch(redacted, /Avery Sample/)
    assert.doesNotMatch(redacted, /1979-03-02/)
    assert.doesNotMatch(redacted, /10 Example St/)
    assert.doesNotMatch(redacted, /0400 123 456/)
})
