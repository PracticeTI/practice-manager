// The single place text leaves for a model.
//
// Every feature calls `guardOutgoingChat` or `guardOutgoingText` before it calls a vendor. The
// guard de-identifies, verifies, and refuses to send when anything identifying survived. A
// blocked call throws instead of degrading quietly, because a report that silently contains a
// name is worse than a report that failed to draft.
//
// Transcription is the one channel that cannot be redacted before it is sent: a name spoken
// aloud is not a string we can rewrite. It is recorded as a disclosed, non-redactable egress so
// the audit shows the exception rather than implying full coverage.

import { DEFAULT_DEIDENTIFY_MAX_CHARS, deidentifyLlmText } from './deidentify.js'
import { hasIdentityValues, normalizeIdentityBlock } from './identity.js'
import { summarizeFindings, verifyDeidentifiedText } from './verify.js'

export const EGRESS_CHANNEL_CHAT = 'chat'
export const EGRESS_CHANNEL_TRANSCRIPT_SUMMARY = 'transcript-summary'
export const EGRESS_CHANNEL_ANALYSIS = 'analysis'
export const EGRESS_CHANNEL_REPORT = 'report'
export const EGRESS_CHANNEL_QUOTE = 'quote'
export const EGRESS_CHANNEL_INTAKE = 'intake'
export const EGRESS_CHANNEL_ASSISTANT = 'assistant'
export const EGRESS_CHANNEL_BOOKING = 'booking'
export const EGRESS_CHANNEL_TRANSCRIPTION = 'transcription'
export const EGRESS_CHANNEL_WEB_SEARCH = 'web-search'

export const EGRESS_DECISION_SENT = 'sent'
export const EGRESS_DECISION_BLOCKED = 'blocked'
export const EGRESS_DECISION_DISCLOSED = 'disclosed-non-redactable'

export class PrivacyEgressError extends Error {
    constructor(message, { channel, findings } = {}) {
        super(message)
        this.name = 'PrivacyEgressError'
        this.channel = channel || ''
        this.findings = findings || []
        this.status = 422
    }
}

const counters = new Map()

function bump(key) {
    counters.set(key, (counters.get(key) || 0) + 1)
}

/**
 * Structured egress record. Counts and kinds only: an audit line that quoted the leak would be
 * a new disclosure, and these lines go to platform logs.
 */
export function recordEgressEvent(event) {
    bump(`${event.channel}:${event.decision}`)
    if (!event.findings?.length) bump(`${event.channel}:clean`)

    const line = {
        event: 'ai.egress',
        channel: event.channel,
        decision: event.decision,
        identityKnown: Boolean(event.identityKnown),
        subjectNoun: event.subjectNoun || '',
        charsIn: event.charsIn || 0,
        charsOut: event.charsOut || 0,
        findings: event.findings || [],
        reason: event.reason || '',
    }

    if (event.decision === EGRESS_DECISION_BLOCKED) {
        console.warn(JSON.stringify(line))
    } else {
        console.info(JSON.stringify(line))
    }

    return line
}

/** Snapshot for a status endpoint or a test. Keys are `channel:decision`. */
export function getEgressAuditCounters() {
    return Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function resetEgressAuditCounters() {
    counters.clear()
}

function resolveOptions(options = {}) {
    const block = normalizeIdentityBlock(options.identity || options.participantIdentity)
    return {
        block,
        channel: options.channel || EGRESS_CHANNEL_CHAT,
        patientName: options.patientName || '',
        subjectNoun: options.subjectNoun || block.subjectNoun,
        maxChars: Number.isFinite(options.maxChars) ? options.maxChars : DEFAULT_DEIDENTIFY_MAX_CHARS,
    }
}

function guardOneText(text, options) {
    const source = String(text ?? '')
    if (!source) return { text: source, charCount: 0, findings: [] }

    const redacted = deidentifyLlmText(source, {
        identity: options.block,
        patientName: options.patientName,
        subjectNoun: options.subjectNoun,
        maxChars: options.maxChars,
    })
    const result = verifyDeidentifiedText(redacted, {
        identity: options.block,
        patientName: options.patientName,
    })
    return { text: redacted, charCount: source.length, findings: result.findings, blocking: result.blocking }
}

/**
 * De-identify one string and refuse it if anything identifying survived.
 *
 * Returns `{ text, identity, stats }`. Throws `PrivacyEgressError` when blocked.
 */
export function guardOutgoingText(text, options = {}) {
    const resolved = resolveOptions(options)
    const guarded = guardOneText(text, resolved)

    const findings = summarizeFindings(guarded.blocking)
    recordEgressEvent({
        channel: resolved.channel,
        decision: guarded.blocking.length ? EGRESS_DECISION_BLOCKED : EGRESS_DECISION_SENT,
        identityKnown: hasIdentityValues(resolved.block),
        subjectNoun: resolved.subjectNoun,
        charsIn: guarded.charCount,
        charsOut: guarded.text.length,
        findings,
    })

    if (guarded.blocking.length) {
        throw new PrivacyEgressError(
            `Refusing to send patient data to the AI provider (${findings.map((f) => f.kind).join(', ')}).`,
            { channel: resolved.channel, findings }
        )
    }

    return {
        text: guarded.text,
        identity: resolved.block,
        stats: { charsIn: guarded.charCount, charsOut: guarded.text.length, findings },
    }
}

function guardContent(content, options) {
    if (typeof content === 'string') return guardOneText(content, options).text
    if (!Array.isArray(content)) return content

    return content.map((part) => {
        if (!part || typeof part !== 'object') return part
        if (typeof part.text === 'string') {
            return { ...part, text: guardOneText(part.text, options).text }
        }
        return part
    })
}

/**
 * Guard a chat payload: every message plus the system prompt.
 *
 * Each part is de-identified and then verified as a whole, so a name split across a system
 * prompt and a user turn is still caught.
 */
export function guardOutgoingChat({ messages, system } = {}, options = {}) {
    const resolved = resolveOptions(options)
    const sourceMessages = Array.isArray(messages) ? messages : []

    const guardedMessages = sourceMessages.map((message) => {
        if (!message || typeof message !== 'object') return message
        return { ...message, content: guardContent(message.content, resolved) }
    })
    const guardedSystem = typeof system === 'string' ? guardOneText(system, resolved).text : system

    // Verify the concatenation too: separate parts can each look clean while the pair names
    // the same person twice in a way neither part shows on its own.
    const combined = [
        guardedSystem || '',
        ...guardedMessages.map((message) => (typeof message.content === 'string' ? message.content : '')),
    ].join('\n')
    const combinedResult = verifyDeidentifiedText(combined, {
        identity: resolved.block,
        patientName: resolved.patientName,
    })

    const charsIn = sourceMessages.reduce((total, message) => total
        + (typeof message?.content === 'string' ? message.content.length : 0), String(system || '').length)
    const charsOut = guardedMessages.reduce((total, message) => total
        + (typeof message?.content === 'string' ? message.content.length : 0), String(guardedSystem || '').length)

    const findings = summarizeFindings(combinedResult.blocking)
    recordEgressEvent({
        channel: resolved.channel,
        decision: combinedResult.blocking.length ? EGRESS_DECISION_BLOCKED : EGRESS_DECISION_SENT,
        identityKnown: hasIdentityValues(resolved.block),
        subjectNoun: resolved.subjectNoun,
        charsIn,
        charsOut,
        findings,
    })

    if (combinedResult.blocking.length) {
        throw new PrivacyEgressError(
            `Refusing to send patient data to the AI provider (${findings.map((f) => f.kind).join(', ')}).`,
            { channel: resolved.channel, findings }
        )
    }

    return {
        messages: guardedMessages,
        ...(guardedSystem !== undefined ? { system: guardedSystem } : {}),
        identity: resolved.block,
        stats: { charsIn, charsOut, findings },
    }
}

/**
 * Record a channel that carries identifying content it cannot rewrite, currently only session
 * audio sent for transcription. Called on every such request so the audit shows the disclosed
 * gap instead of a false clean.
 */
export function recordNonRedactableEgress({ channel = EGRESS_CHANNEL_TRANSCRIPTION, model = '', reason = '' } = {}) {
    return recordEgressEvent({
        channel,
        decision: EGRESS_DECISION_DISCLOSED,
        identityKnown: true,
        findings: [{ kind: 'audio', count: 1 }],
        reason: reason || `Raw audio sent to ${model || 'the transcription provider'}; audio cannot be de-identified before transcription.`,
    })
}
