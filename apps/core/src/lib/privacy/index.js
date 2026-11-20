// Patient-data egress control.
//
// The rule this module exists to enforce: nothing that identifies a patient reaches a model.
// Text is replaced with role phrases on the way out, verified fail-closed at the boundary, and
// the real details are restored locally on the way back in.
//
// `identity.js`  - one shape for every identifier a record holds
// `subject.js`   - "the participant" (NDIS) vs "the patient" (everything else)
// `deidentify.js`- glossary and pattern redaction
// `verify.js`    - what survived redaction; blocks the send
// `egress.js`    - the guard every model call goes through, plus the audit record
// `rehydrate.js` - real values back into headers and template tokens
//
// Import the guard from here rather than reaching into a sub-module, so a future change to the
// boundary is one file.

export {
    SUBJECT_PARTICIPANT,
    SUBJECT_PATIENT,
    SUBJECT_NOUNS,
    buildSubjectLabels,
    isNdisFunding,
    normalizeSubjectNoun,
    resolveSubjectNoun,
} from './subject.js'

export {
    buildIdentityBlockFromPatient,
    hasIdentityValues,
    normalizeIdentityBlock,
} from './identity.js'

export {
    DEFAULT_DEIDENTIFY_MAX_CHARS,
    buildIdentityReplacements,
    collectIdentityValueEntries,
    collectIdentityValues,
    deidentifyLlmText,
    sanitizeLlmContextText,
} from './deidentify.js'

export {
    FINDING_ADDRESS,
    FINDING_EMAIL,
    FINDING_IDENTITY_TOKEN,
    FINDING_IDENTITY_VALUE,
    FINDING_PHONE,
    FINDING_POSTCODE,
    FINDING_TITLED_NAME,
    summarizeFindings,
    verifyDeidentifiedText,
} from './verify.js'

export {
    EGRESS_CHANNEL_ANALYSIS,
    EGRESS_CHANNEL_ASSISTANT,
    EGRESS_CHANNEL_BOOKING,
    EGRESS_CHANNEL_CHAT,
    EGRESS_CHANNEL_INTAKE,
    EGRESS_CHANNEL_QUOTE,
    EGRESS_CHANNEL_REPORT,
    EGRESS_CHANNEL_TRANSCRIPT_SUMMARY,
    EGRESS_CHANNEL_TRANSCRIPTION,
    EGRESS_CHANNEL_WEB_SEARCH,
    EGRESS_DECISION_BLOCKED,
    EGRESS_DECISION_DISCLOSED,
    EGRESS_DECISION_SENT,
    PrivacyEgressError,
    getEgressAuditCounters,
    guardOutgoingChat,
    guardOutgoingText,
    recordEgressEvent,
    recordNonRedactableEgress,
    resetEgressAuditCounters,
} from './egress.js'

export {
    buildIdentityHeader,
    hydrateIdentityVariables,
    restoreIdentityDeep,
    restoreIdentityInText,
} from './rehydrate.js'
