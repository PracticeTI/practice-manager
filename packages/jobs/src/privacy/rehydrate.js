// Put the person back into a de-identified draft.
//
// The model never sees a name, so it cannot write one. The real details are restored here, on
// our side of the boundary, from the same identity block that was used to strip them. Two
// restore points are safe and one is not:
//
//   * Header fields (name, reference number, date of birth) - authored locally, never by a model.
//   * Template tokens ({{participant_name}}) - hydrated locally when the document renders.
//   * Prose - "the participant" can be swapped back, but only in a document about one person,
//     and only where the phrase is genuinely about the subject. That is why prose restore is
//     opt-in rather than part of the default path.

import { buildSubjectLabels, resolveReferenceLabel, resolveSubjectNoun } from './subject.js'
import { normalizeIdentityBlock } from './identity.js'

/**
 * The identifying header of a document: the only place the real values are written.
 *
 * Returns plain strings, not markup, so a DOCX writer and a markdown renderer can both use it.
 */
export function buildIdentityHeader(identity) {
    const block = normalizeIdentityBlock(identity)
    const labels = buildSubjectLabels(block.subjectNoun, { fundingSource: block.fundingSource })
    const referenceLabel = block.ndisNumber ? resolveReferenceLabel(block.fundingSource) : ''
    const label = block.participantName && block.ndisNumber
        ? `${block.participantName} (${labels.referenceNumber.replace(/^the \w+'s /, '')} ${block.ndisNumber})`
        : block.participantName || block.ndisNumber

    return {
        subjectNoun: block.subjectNoun,
        name: block.participantName,
        dateOfBirth: block.dateOfBirth,
        referenceNumber: block.ndisNumber,
        referenceLabel,
        address: block.address,
        phone: block.phone,
        email: block.emails[0]?.value || '',
        /** `Ling Hu (NDIS number 430012345)` when both are known, otherwise whichever exists. */
        label,
    }
}

/**
 * Values for a report template's tokens. Keys are the token names the report settings use, so
 * `{{participant_name}}` and `{{patient_name}}` both resolve whatever the funding scheme is.
 */
export function hydrateIdentityVariables(identity) {
    const block = normalizeIdentityBlock(identity)
    const labels = buildSubjectLabels(block.subjectNoun)
    const header = buildIdentityHeader(block)

    return {
        subject: labels.name,
        subject_noun: labels.noun,
        participant: labels.name,
        patient: labels.name,
        participant_name: header.name,
        patient_name: header.name,
        date_of_birth: header.dateOfBirth,
        dob: header.dateOfBirth,
        ndis_number: block.ndisNumber,
        participant_number: block.ndisNumber,
        claim_number: block.ndisNumber,
        reference_number: block.ndisNumber,
        address: block.address,
        phone: block.phone,
        email: header.email,
        identity_header: header.label,
    }
}

/**
 * Swap the subject's role phrase back for their name.
 *
 * Only `the participant` / `the patient` is restored. Third-party role phrases ("the support
 * coordinator") stay as they are: which coordinator is not recoverable from the text, and
 * guessing would put a real name against the wrong sentence.
 */
export function restoreIdentityInText(value, identity, { possessiveForm = true } = {}) {
    const block = normalizeIdentityBlock(identity)
    const name = block.participantName
    if (!name) return String(value || '')

    const noun = resolveSubjectNoun({ subjectNoun: block.subjectNoun, ndisNumber: block.ndisNumber })
    const pattern = new RegExp(`\\bthe ${noun}\\b`, 'gi')

    return String(value || '')
        .replace(possessiveForm ? new RegExp(`\\bthe ${noun}'s\\b`, 'gi') : /(?!)/g, `${name}'s`)
        .replace(pattern, name)
}

/**
 * Restore every string inside a generated object or array.
 *
 * Model output arrives as nested JSON (report fields, quote lines). Walking it here means a caller
 * restores the whole draft in one call instead of remembering each field.
 */
export function restoreIdentityDeep(value, identity) {
    if (typeof value === 'string') return restoreIdentityInText(value, identity)
    if (Array.isArray(value)) return value.map((entry) => restoreIdentityDeep(entry, identity))
    if (value && typeof value === 'object') {
        const result = {}
        for (const [key, entry] of Object.entries(value)) {
            result[key] = restoreIdentityDeep(entry, identity)
        }
        return result
    }
    return value
}

