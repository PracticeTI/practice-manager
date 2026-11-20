// Remove identifying values from text that is about to reach a model.
//
// Two passes, in this order:
//   1. Glossary - every value on the identity block, longest first, replaced with the role
//      phrase it belongs to. This is the pass that keeps a report readable: "Ling Hu" becomes
//      "the participant", not "[redacted]".
//   2. Patterns - emails, phones, street addresses, postcodes and titled names, for people
//      and places the identity block does not know about.
//
// A name is replaced wherever it appears, including a bare first name, because notes and
// transcripts use first names far more often than full names. That is why the replacements
// are sorted longest first: the full name must win over its own first name, or "Ling Hu"
// would come out as "the participant Hu".
//
// This module cannot prove the text is clean - only `verify.js` can refuse to send - so
// callers must run the verifier at the egress boundary, not trust this alone.

import { buildSubjectLabels, resolveSubjectNoun } from './subject.js'
import { normalizeIdentityBlock } from './identity.js'

export const DEFAULT_DEIDENTIFY_MAX_CHARS = 250000

// Shortest token that is replaced on its own. Two, not three: "Hu" and "Ng" are real surnames,
// and word-boundary matching means a two-letter token only matches when it stands alone. A
// single-character token is never replaced - an initial would match far too much prose - and the
// verifier reports it as a warning instead of blocking.
const MIN_TOKEN_LENGTH = 2

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
// Two shapes only: an Australian number starting 0 or +61, or three separated digit groups.
// Deliberately tighter than "any 6+ digit run" - an unlabelled nine-digit number is far more
// likely to be a scheme number than a phone, and calling it "[redacted phone]" is the wrong
// label. Those reach the verifier instead, which blocks on them.
const PHONE_PATTERN = /(?:\+?61[\s.-]?|0)[2-48](?:[\s.-]?\d){8}\b|\b\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g
const STREET_PATTERN = /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|way|place|pl|boulevard|blvd|crescent|cres|close|cl|terrace|tce)\b\.?/gi
const POSTCODE_PATTERN = /\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}\b/gi
const TITLED_NAME_PATTERN = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g
const RELATION_NAME_PATTERN = /\b(mother|father|sister|brother|partner|husband|wife|carer|support worker|therapist|clinician|doctor|gp|ot)\s*[:\-]?\s*([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})\b/gi

export function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function truncateForModel(value, maxLength = DEFAULT_DEIDENTIFY_MAX_CHARS) {
    return String(value || '').replace(/\r\n/g, '\n').slice(0, maxLength)
}

/**
 * Every literal string that identifies the person, tagged with whether it is a whole value or
 * one part of a name.
 *
 * The verifier needs the distinction: a full value always blocks, while a name *part* may be
 * too short to act on ("Hu"). Used by the verifier, which must be exhaustive even where the
 * replacement pass is deliberately conservative.
 */
export function collectIdentityValueEntries(identity) {
    const block = normalizeIdentityBlock(identity)
    const entries = []

    const push = (value, kind) => {
        const text = String(value || '').trim()
        if (text) entries.push({ value: text, kind })
    }
    const pushName = (name) => {
        const text = String(name || '').trim()
        if (!text) return
        push(text, 'value')
        const tokens = text.split(/\s+/).filter(Boolean)
        // A one-word name has no separate token to report.
        if (tokens.length < 2) return
        for (const token of tokens) {
            if (token.length >= 2) push(token, 'name-token')
        }
    }

    pushName(block.participantName)
    push(block.dateOfBirth, 'value')
    push(block.ndisNumber, 'value')
    push(block.address, 'value')
    push(block.phone, 'value')
    for (const email of block.emails) push(email.value, 'value')
    for (const person of block.people) pushName(person.name)
    for (const identifier of block.identifiers) push(identifier.value, 'value')

    const seen = new Set()
    return entries.filter((entry) => {
        const key = `${entry.kind}|${entry.value.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/** Every literal string that identifies the person. */
export function collectIdentityValues(identity) {
    return collectIdentityValueEntries(identity).map((entry) => entry.value)
}

/**
 * The value -> role phrase pairs used to de-identify text.
 *
 * The person being written about becomes the subject noun ("the participant" / "the patient");
 * everyone else is described by their role, so the model can still say "the support
 * coordinator" and the reader still knows who that is.
 */
export function buildIdentityReplacements(identity, { patientName, subjectNoun } = {}) {
    const block = normalizeIdentityBlock(identity)
    const noun = resolveSubjectNoun({
        subjectNoun: subjectNoun || block.subjectNoun,
        ndisNumber: block.ndisNumber,
    })
    const labels = buildSubjectLabels(noun, { fundingSource: block.fundingSource })

    const replacements = []
    const seen = new Set()

    const push = (value, replacement) => {
        const text = String(value || '').trim()
        if (!text || !replacement) return
        const key = `${text.toLowerCase()}|${replacement}`
        if (seen.has(key)) return
        seen.add(key)
        replacements.push({ value: text, replacement })
    }

    const pushName = (name, replacement, { includeTokens = true } = {}) => {
        const text = String(name || '').trim()
        if (!text) return
        push(text, replacement)
        if (!includeTokens) return
        for (const token of text.split(/\s+/)) {
            if (token.length >= MIN_TOKEN_LENGTH) push(token, replacement)
        }
    }

    pushName(block.participantName || patientName, labels.name)
    push(block.dateOfBirth, labels.dateOfBirth)
    push(block.ndisNumber, labels.referenceNumber)
    push(block.address, labels.address)
    push(block.phone, labels.phone)

    for (const email of block.emails) {
        // Third-party addresses are named after their owner: a plan manager's invoice address is
        // not the participant's email, and saying so would misattribute it.
        push(email.value, email.role ? `the ${email.role}'s email address` : labels.email)
    }

    for (const person of block.people) {
        pushName(person.name, `the ${person.role}`)
    }

    for (const identifier of block.identifiers) {
        push(identifier.value, identifier.replacement)
    }

    // Longest first so a full name wins over its own first name.
    return replacements.sort((a, b) => b.value.length - a.value.length)
}

/**
 * Remove identifying values from text that is about to reach the model.
 *
 * `identity` is the canonical block; `participantIdentity` is the name the FCA builder already
 * uses for the same thing, kept so stored drafts and existing callers need no change.
 */
export function deidentifyLlmText(value, {
    identity,
    participantIdentity,
    patientName,
    subjectNoun,
    maxChars = DEFAULT_DEIDENTIFY_MAX_CHARS,
} = {}) {
    let text = truncateForModel(value, maxChars)
    if (!text) return ''

    const block = participantIdentity || identity
    const resolvedNoun = resolveSubjectNoun({
        subjectNoun: subjectNoun || block?.subjectNoun,
        ndisNumber: block?.ndisNumber,
    })

    for (const { value: rawValue, replacement } of buildIdentityReplacements(block, { patientName, subjectNoun: resolvedNoun })) {
        // A value that starts or ends with a non-word character ("+61 ...") has no word boundary there.
        const prefix = /^\w/.test(rawValue) ? '\\b' : ''
        const suffix = /\w$/.test(rawValue) ? '\\b' : ''
        const pattern = new RegExp(`${prefix}${escapeRegExp(rawValue)}${suffix}`, 'gi')
        text = text.replace(pattern, replacement)
    }

    text = text.replace(EMAIL_PATTERN, '[redacted email]')
    text = text.replace(PHONE_PATTERN, '[redacted phone]')
    text = text.replace(STREET_PATTERN, '[redacted address]')
    text = text.replace(POSTCODE_PATTERN, '[redacted postcode]')
    text = text.replace(TITLED_NAME_PATTERN, '[redacted name]')

    // A relation word next to a capitalised name is a role we can keep: "carer Sarah" ->
    // "carer [redacted name]". The capitalisation check is done on the captured text because the
    // pattern is case-insensitive for the role word, and "OT is Claire" must not match.
    text = text.replace(RELATION_NAME_PATTERN, (match, role, name) => {
        // Take only the leading run of capitalised words: "carer Sarah drives him" is a carer
        // called Sarah, not a carer called "Sarah drives him".
        const words = String(name || '').trim().split(/\s+/).filter(Boolean)
        const capitalised = []
        for (const word of words) {
            if (!/^[A-Z][a-z'-]*$/.test(word)) break
            capitalised.push(word)
        }
        if (capitalised.length === 0) return match
        const rest = words.slice(capitalised.length).join(' ')
        return `${String(role || '').toLowerCase()} [redacted name]${rest ? ` ${rest}` : ''}`
    })

    return tidyRolePhrases(text, resolvedNoun)
}

// Replacing "the plan manager invoice@..." yields "the plan manager the plan manager's email
// address". Collapse the doubled role so the model does not copy the stutter into the report.
function tidyRolePhrases(value, subjectNoun) {
    const roles = `plan manager|support coordinator|referrer|nominee|emergency contact|booking contact|${subjectNoun}`
    return String(value || '')
        .replace(new RegExp(`\\bthe (${roles})\\s+the \\1('s)?\\b`, 'gi'), (match, role, possessive) => `the ${role}${possessive || ''}`)
        // "NDIS 430012345" becomes "NDIS the participant's NDIS number": the scheme word the note
        // already wrote is the same word the label starts with, so keep one.
        .replace(/\b(NDIS|TAC|WorkCover|DVA|Medicare)\s+(the \w+'s \1\b)/gi, '$2')
        .replace(/\b(NDIS|TAC|WorkCover|DVA|Medicare)(?:\s+[A-Za-z]+){0,3}\s+(the \w+'s \1[^.]*?number\b)/gi, '$2')
        .replace(/\s{2,}/g, ' ')
        .trim()
}

/** Historical name; the FCA path calls this. */
export function sanitizeLlmContextText(value, options = {}) {
    return deidentifyLlmText(value, options)
}
