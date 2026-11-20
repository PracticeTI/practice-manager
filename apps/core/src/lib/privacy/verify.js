// The gate that makes "no patient data reaches a model" a rule instead of an intention.
//
// Redaction is best-effort by nature: a glossary cannot know about a neighbour mentioned once,
// and no pattern list is complete. So the claim is not "we redact everything"; it is "unredacted
// text cannot leave". This module is the second half of that sentence. It re-scans what the
// redactor produced and reports what survived, and the egress guard refuses to send when
// anything blocking survives.
//
// Findings never carry the leaked value. An audit record that quotes the leak is itself a
// disclosure, and these records go to platform logs.

import { collectIdentityValueEntries, escapeRegExp } from './deidentify.js'
import { hasIdentityValues, normalizeIdentityBlock } from './identity.js'

export const FINDING_IDENTITY_VALUE = 'identity-value'
export const FINDING_IDENTITY_TOKEN = 'identity-token'
export const FINDING_EMAIL = 'email'
export const FINDING_PHONE = 'phone'
export const FINDING_ADDRESS = 'address'
export const FINDING_POSTCODE = 'postcode'
export const FINDING_TITLED_NAME = 'titled-name'
export const FINDING_IDENTIFIER_NUMBER = 'identifier-number'

// Stricter than the redactor on purpose. Redacting a false positive costs a slightly odd
// sentence; blocking on one stops a clinician's report. So the verifier only recognises the
// identifier shapes it is confident about - an Australian number is ten digits starting with 0
// (or +61), which "12 07 2026" is not.
const STRICT_PATTERNS = [
    { kind: FINDING_EMAIL, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { kind: FINDING_PHONE, pattern: /\b(?:\+?61[\s.-]?|0)[2-48](?:[\s.-]?\d){8}\b/g },
    { kind: FINDING_ADDRESS, pattern: /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|crescent|cres|terrace|tce|boulevard|blvd)\b\.?/gi },
    { kind: FINDING_POSTCODE, pattern: /\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}\b/gi },
    { kind: FINDING_TITLED_NAME, pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g },
    // A scheme number we have no glossary entry for. Nothing in the redactor targets this shape, so
    // when it survives it means the text carries an identifier the record does not know about -
    // another patient's number, a sibling's, or a mistyped one. Stop rather than guess.
    { kind: FINDING_IDENTIFIER_NUMBER, pattern: /\b\d{9,16}\b/g, requiresIdentity: true },
]

// A name part of two characters still blocks ("Hu"); a single-character initial does not, because
// an initial matches far too much ordinary prose to act on automatically. It is reported as a
// warning so it shows up in the audit without stopping a clinician's report.
const MIN_BLOCKING_TOKEN_LENGTH = 2

function locate(text, pattern) {
    const findings = []
    const regex = new RegExp(pattern.source, pattern.flags)
    let match
    while ((match = regex.exec(text)) !== null) {
        findings.push({ kind: null, index: match.index, length: match[0].length })
        if (match[0].length === 0) regex.lastIndex += 1
    }
    return findings
}

/**
 * Scan text that is about to be sent.
 *
 * Returns `{ ok, findings, blocking }`. `ok` is false when `blocking` is non-empty. Each finding
 * is `{ kind, index, length, blocking }` - position, never content.
 */
export function verifyDeidentifiedText(value, { identity, participantIdentity, patientName } = {}) {
    const text = String(value || '')
    const findings = []
    if (!text) return { ok: true, findings, blocking: [] }

    const block = normalizeIdentityBlock(participantIdentity || identity)
    const identityKnown = hasIdentityValues({
        ...block,
        participantName: block.participantName || patientName,
    })

    for (const { kind, pattern, requiresIdentity } of STRICT_PATTERNS) {
        // The bare-number rule only applies when we know whose record this is. Content routes send
        // long numeric ids on purpose, and a false block there would break a non-clinical feature
        // without protecting anyone.
        if (requiresIdentity && !identityKnown) continue
        for (const hit of locate(text, pattern)) {
            findings.push({ ...hit, kind, blocking: true })
        }
    }

    const entries = collectIdentityValueEntries({
        ...block,
        participantName: block.participantName || patientName,
    })

    for (const entry of entries) {
        // A full identity value always blocks, however short. Only a name *part* can be too
        // short to act on.
        const blocking = entry.kind !== 'name-token'
            || entry.value.length >= MIN_BLOCKING_TOKEN_LENGTH

        const prefix = /^\w/.test(entry.value) ? '\\b' : ''
        const suffix = /\w$/.test(entry.value) ? '\\b' : ''
        const pattern = new RegExp(`${prefix}${escapeRegExp(entry.value)}${suffix}`, 'gi')

        for (const hit of locate(text, pattern)) {
            findings.push({
                ...hit,
                kind: blocking ? FINDING_IDENTITY_VALUE : FINDING_IDENTITY_TOKEN,
                blocking,
            })
        }
    }

    const blocking = findings.filter((finding) => finding.blocking)
    return { ok: blocking.length === 0, findings, blocking }
}

/** Just the distinct kinds, for an audit record that a dashboard can group on. */
export function summarizeFindings(findings) {
    const kinds = new Map()
    for (const finding of findings || []) {
        kinds.set(finding.kind, (kinds.get(finding.kind) || 0) + 1)
    }
    return [...kinds.entries()].map(([kind, count]) => ({ kind, count }))
}
