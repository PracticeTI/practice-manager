// The identity block for a patient who is still filling in the intake form.
//
// The intake chat is a form in conversational clothing: the answers it has collected so far are the
// identity block, and they are stripped from the conversation history before every request. Which
// answers count as identifying is decided from the form's field labels, because the answers arrive
// keyed by Splose field id and the ids are not stable across form versions.

import { normalizeIdentityBlock, resolveSubjectNoun } from './privacy/index.js'

export const IDENTIFYING_INTAKE_FIELDS = [
    { key: 'participantName', pattern: /full name|patient name|your name|^name\b/i },
    { key: 'dateOfBirth', pattern: /date of birth|\bdob\b/i },
    { key: 'phone', pattern: /phone|mobile/i },
    { key: 'email', pattern: /e-?mail/i },
    // Suburb and postcode are collected as separate fields, so they are joined into one address.
    { key: 'address', pattern: /address|suburb|postcode/i },
]

export function buildIntakeIdentity(schema, answers) {
    const values = {}
    const addresses = []
    let fundingSource = ''

    for (const field of Array.isArray(schema?.fields) ? schema.fields : []) {
        const raw = answers?.[field.id]
        if (raw === undefined || raw === null || String(raw).trim() === '') continue
        const text = String(raw).trim()
        const label = String(field.label || '')

        if (/funding|referral type/i.test(label)) {
            fundingSource = fundingSource || text
            continue
        }

        const match = IDENTIFYING_INTAKE_FIELDS.find((entry) => entry.pattern.test(label))
        if (!match) continue
        if (match.key === 'address') addresses.push(text)
        else values[match.key] = values[match.key] || text
    }

    return normalizeIdentityBlock({
        participantName: values.participantName || '',
        dateOfBirth: values.dateOfBirth || '',
        phone: values.phone || '',
        address: addresses.join(', '),
        emails: values.email ? [{ value: values.email, role: '' }] : [],
        subjectNoun: resolveSubjectNoun({ fundingSource }),
    })
}
