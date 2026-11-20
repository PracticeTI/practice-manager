// One shape for "everything about a person that must never reach a model".
//
// Every field a patient record holds that identifies the person is collected here, once,
// so no call site has to remember the full list. The block is what the de-identifier
// replaces, what the verifier fails closed on, and what the glossary restores at render.
//
// The shape started life in the NDIS FCA builder (`fcaParticipantSources.js`) and keeps
// that vocabulary - `participantName`, `dateOfBirth`, `ndisNumber`, `address`, `phone`,
// `emails`, `people` - so the existing FCA path is a consumer rather than a rewrite.
// Everything the FCA builder does not model (Medicare, DVA, TAC, nominee, emergency
// contact, PMS id) travels in `identifiers`, each with the phrase that replaces it.

import { buildSubjectLabels, resolveSubjectNoun } from './subject.js'

const EMPTY_IDENTITY = {
    subjectNoun: 'participant',
    fundingSource: '',
    participantName: '',
    dateOfBirth: '',
    ndisNumber: '',
    address: '',
    phone: '',
    emails: [],
    people: [],
    identifiers: [],
}

function clean(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Read a record field by snake_case, camelCase or the Splose export name. */
function readField(source, ...keys) {
    for (const key of keys) {
        const value = clean(source?.[key])
        if (value) return value
    }
    return ''
}

function readAnswer(metadata, keys, labels) {
    const answers = safeObject(metadata.sploseAnswers)
    const labelled = safeObject(metadata.sploseLabelledAnswers)
    const splosePatient = safeObject(metadata.splosePatient)

    for (const key of keys) {
        const value = clean(answers[key]) || clean(splosePatient[key])
        if (value) return value
    }
    for (const label of labels) {
        const value = clean(labelled[label]) || clean(answers[label])
        if (value) return value
    }
    return ''
}

function uniqueStrings(values) {
    const seen = new Set()
    const result = []
    for (const value of values) {
        const text = clean(value)
        if (!text) continue
        const key = text.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(text)
    }
    return result
}

/**
 * Coerce any identity-shaped object into the canonical block. Accepts the FCA builder's
 * `participantIdentity` payload unchanged, so stored drafts keep working.
 */
export function normalizeIdentityBlock(input) {
    const source = safeObject(input)
    const subjectNoun = resolveSubjectNoun({
        subjectNoun: source.subjectNoun,
        ndisNumber: source.ndisNumber,
    })

    const emails = (Array.isArray(source.emails) ? source.emails : [])
        .map((email) => ({
            value: clean(typeof email === 'string' ? email : email?.value),
            role: clean(typeof email === 'string' ? '' : email?.role),
        }))
        .filter((email) => email.value)

    const people = (Array.isArray(source.people) ? source.people : [])
        .map((person) => ({ name: clean(person?.name), role: clean(person?.role) }))
        .filter((person) => person.name && person.role)

    const identifiers = (Array.isArray(source.identifiers) ? source.identifiers : [])
        .map((entry) => ({ value: clean(entry?.value), replacement: clean(entry?.replacement) }))
        .filter((entry) => entry.value && entry.replacement)

    return {
        ...EMPTY_IDENTITY,
        subjectNoun,
        fundingSource: clean(source.fundingSource),
        participantName: clean(source.participantName || source.patientName),
        dateOfBirth: clean(source.dateOfBirth),
        ndisNumber: clean(source.ndisNumber),
        address: clean(source.address),
        phone: clean(source.phone),
        emails,
        people,
        identifiers,
    }
}

/**
 * Build the identity block for a patient row.
 *
 * `patient` may be a database row (snake_case), an API payload (camelCase) or the
 * `{ patient, metadata }` shape the workers pass around. `metadata` carries the intake
 * answers, which hold the funding scheme and the claim / reference number.
 */
export function buildIdentityBlockFromPatient(patient, { fundingSource, subjectNoun, metadata } = {}) {
    const source = safeObject(patient)
    const meta = safeObject(metadata ?? source.metadata)
    const row = safeObject(source.patient ?? source)

    const funding = clean(fundingSource) || readAnswer(meta, ['funding_source_or_referral_type'], [
        'Funding Source or Referral Type',
        'Funding source',
    ])
    const referenceNumber = readField(row, 'ndis_number', 'ndisNumber')
        || readField(row, 'tac_number', 'tacNumber')
        || readAnswer(meta, ['claim_or_reference_number'], [
            'NDIS number/ TAC Claim Number/ Work Cover Reference Number',
            'NDIS number',
        ])

    const noun = resolveSubjectNoun({ fundingSource: funding, ndisNumber: referenceNumber, subjectNoun })
    const nounLabels = buildSubjectLabels(noun, { fundingSource: funding })

    const fullName = readField(row, 'patient_name', 'patientName')
        || [readField(row, 'first_name', 'firstName'), readField(row, 'last_name', 'lastName')]
            .filter(Boolean)
            .join(' ')

    const streetAddress = [
        readField(row, 'address_line_1', 'addressLine1'),
        readField(row, 'address_line_2', 'addressLine2'),
        readField(row, 'address_line_3', 'addressLine3'),
    ].filter(Boolean).join(', ')
    const locality = [
        readField(row, 'city', 'suburb'),
        [readField(row, 'state'), readField(row, 'postal_code', 'postalCode')].filter(Boolean).join(' '),
        readField(row, 'country'),
    ].filter(Boolean).join(', ')

    const phones = uniqueStrings([
        readField(row, 'mobile_phone', 'mobilePhone'),
        readField(row, 'home_phone', 'homePhone'),
        readField(row, 'work_phone', 'workPhone'),
        readField(row, 'fax_phone', 'faxPhone'),
        ...(Array.isArray(row.other_phones) ? row.other_phones : []),
    ])

    const emails = []
    const pushEmail = (value, role) => {
        const text = clean(value)
        if (!text) return
        if (emails.some((entry) => entry.value.toLowerCase() === text.toLowerCase())) return
        emails.push({ value: text, role: clean(role) })
    }
    pushEmail(readField(row, 'email'), '')
    pushEmail(readField(row, 'nominee_email', 'nomineeEmail'), 'nominee')
    pushEmail(readAnswer(meta, ['plan_manager_email'], ['Plan manager email']), 'plan manager')

    const people = []
    const pushPerson = (name, role) => {
        const text = clean(name)
        if (!text) return
        if (people.some((person) => person.name.toLowerCase() === text.toLowerCase())) return
        people.push({ name: text, role })
    }
    const nomineeName = [
        readField(row, 'nominee_first_name', 'nomineeFirstName'),
        readField(row, 'nominee_last_name', 'nomineeLastName'),
    ].filter(Boolean).join(' ')
    pushPerson(nomineeName, 'nominee')
    pushPerson(readField(row, 'emergency_contact_name', 'emergencyContactName'), 'emergency contact')
    pushPerson(readField(row, 'referral_name', 'referralName'), 'referrer')

    // Every remaining scheme number and system id. These have no natural role phrase in
    // prose, so they are replaced with the detail they are, not with a bare redaction.
    const identifiers = []
    const pushIdentifier = (value, replacement) => {
        const text = clean(value)
        if (!text || !replacement) return
        if (identifiers.some((entry) => entry.value.toLowerCase() === text.toLowerCase())) return
        identifiers.push({ value: text, replacement })
    }
    pushIdentifier(readField(row, 'medicare_card_number', 'medicareCardNumber'), `${nounLabels.name}'s Medicare card number`)
    pushIdentifier(readField(row, 'medicare_reference_number', 'medicareReferenceNumber'), `${nounLabels.name}'s Medicare reference number`)
    pushIdentifier(readField(row, 'dva_file_number', 'dvaFileNumber'), `${nounLabels.name}'s DVA file number`)
    pushIdentifier(readField(row, 'tac_number', 'tacNumber'), `${nounLabels.name}'s TAC claim number`)
    pushIdentifier(readField(row, 'external_id', 'externalId'), `${nounLabels.name}'s practice record id`)
    // Phones beyond the first are still contact details for the same person.
    for (const phone of phones.slice(1)) pushIdentifier(phone, `${nounLabels.name}'s phone number`)
    pushIdentifier(readField(row, 'nominee_mobile_number', 'nomineeMobileNumber'), "the nominee's phone number")

    return normalizeIdentityBlock({
        subjectNoun: noun,
        fundingSource: funding,
        participantName: fullName,
        dateOfBirth: readField(row, 'date_of_birth', 'dateOfBirth')
            || readAnswer(meta, ['date_of_birth'], ['Date of birth']),
        ndisNumber: referenceNumber,
        address: [streetAddress, locality].filter(Boolean).join(', '),
        phone: phones[0] || '',
        emails,
        people,
        identifiers,
    })
}

export function hasIdentityValues(identity) {
    const block = normalizeIdentityBlock(identity)
    return Boolean(
        block.participantName
        || block.dateOfBirth
        || block.ndisNumber
        || block.address
        || block.phone
        || block.emails.length
        || block.people.length
        || block.identifiers.length
    )
}
