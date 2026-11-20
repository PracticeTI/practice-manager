// How model-facing prose refers to the person whose record is being drafted.
//
// The word is a role phrase, never a name: NDIS work says "the participant", a TAC,
// WorkCover, DVA or private record says "the patient". The noun is decided from the
// funding scheme recorded on the record, so one report never mixes the two.
//
// Unknown funding keeps the NDIS wording on purpose. A record with no funding source
// recorded is usually mid-intake, and silently switching the voice of a half-written
// report is worse than briefly using the participant noun. Callers that know better
// pass `subjectNoun` explicitly.

export const SUBJECT_PARTICIPANT = 'participant'
export const SUBJECT_PATIENT = 'patient'

export const SUBJECT_NOUNS = [SUBJECT_PARTICIPANT, SUBJECT_PATIENT]

/**
 * What a funding scheme calls its identifying number. Kept here rather than imported from
 * `patientQuotes.js` so this module stays dependency-free and can be mirrored into the worker
 * service unchanged.
 */
export function resolveReferenceLabel(fundingSource) {
    const key = normalize(fundingSource)
    if (key.startsWith('ndis')) return 'NDIS number'
    if (key.startsWith('tac')) return 'TAC claim number'
    if (key.startsWith('workcover') || key.startsWith('work cover')) return 'WorkCover reference number'
    if (key === 'dva') return 'DVA file number'
    if (key.includes('aged care') || key === 'hcp') return 'aged care reference number'
    return 'reference number'
}

function normalize(value) {
    return String(value || '').trim().toLowerCase()
}

export function isNdisFunding(fundingSource) {
    return normalize(fundingSource).startsWith('ndis')
}

/** A stored or requested noun, or '' when the value is not one we support. */
export function normalizeSubjectNoun(value) {
    const normalized = normalize(value)
    return SUBJECT_NOUNS.includes(normalized) ? normalized : ''
}

/**
 * The noun to use for this record: an explicit override, then the NDIS number, then
 * the funding scheme. Anything that is not NDIS becomes "patient".
 */
export function resolveSubjectNoun({ fundingSource, ndisNumber, subjectNoun } = {}) {
    const explicit = normalizeSubjectNoun(subjectNoun)
    if (explicit) return explicit
    const funding = normalize(fundingSource)
    // A recorded scheme decides on its own. Only when no scheme is recorded does a reference
    // number standing in for one imply NDIS - a TAC claim number is not an NDIS number.
    if (funding) return isNdisFunding(funding) ? SUBJECT_PARTICIPANT : SUBJECT_PATIENT
    if (String(ndisNumber || '').trim()) return SUBJECT_PARTICIPANT
    return SUBJECT_PARTICIPANT
}

/**
 * The role phrases an identity value is replaced with. `name` is the bare noun the
 * model is told to write ("the participant"); every other label names the detail so a
 * report reads "the participant's date of birth" rather than "[redacted]".
 *
 * The reference number wears the scheme's own name: an NDIS record says "NDIS number",
 * a TAC record says "TAC claim number", so a replacement never mislabels the scheme.
 */
export function buildSubjectLabels(subjectNoun, { fundingSource } = {}) {
    const noun = resolveSubjectNoun({ subjectNoun })
    const reference = resolveReferenceLabel(fundingSource)
    return {
        noun,
        name: `the ${noun}`,
        dateOfBirth: `the ${noun}'s date of birth`,
        referenceNumber: `the ${noun}'s ${reference}`,
        ndisNumber: `the ${noun}'s NDIS number`,
        address: `the ${noun}'s address`,
        phone: `the ${noun}'s phone number`,
        email: `the ${noun}'s email address`,
    }
}
