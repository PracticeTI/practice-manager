// Official NDIS reference guidance for FCA report generation.
//
// The FCA writer is asked to frame its sections in the NDIA's own definitions, so every section
// prompt carries this block alongside the participant evidence. It is reference material, not
// evidence: it is deliberately kept out of the evidence corpus (see `buildCorpus` in
// fcaReportGeneration.js), which scores sentences from notes, transcripts and builder state. If it
// were folded into the corpus its sentences would be selected as "observed evidence".
//
// The builder shows the same source on Step 1 of the FCA builder
// (one/src/lib/fcaReferenceDocuments.js). `two` is a separate deployment and cannot import from
// `one`, so the display copy and this prompt copy both cite `FCA_REFERENCE_SOURCE_URL` below; if the
// NDIS page changes materially, update both.

export const FCA_REFERENCE_SOURCE_URL = 'https://www.ndis.gov.au/applying/types-assessments/what-functional-capacity-assessment'

export const FCA_REFERENCE_SOURCES = [
    {
        id: 'ndis-what-is-a-functional-capacity-assessment',
        title: 'What is a functional capacity assessment',
        publisher: 'National Disability Insurance Agency (NDIA)',
        url: FCA_REFERENCE_SOURCE_URL,
        pageCurrentAsOf: '29 May 2026',
    },
]

/** The six functional areas the NDIA splits a functional capacity assessment into. */
export const FCA_REFERENCE_FUNCTIONAL_AREAS = [
    'communication',
    'learning',
    'mobility',
    'self-care',
    'self-management',
    'social interactions',
]

/**
 * Prompt-ready NDIS guidance. Written as instructions to the writer rather than as report copy, so
 * the model frames the report with it instead of quoting it.
 */
export const FCA_REFERENCE_GUIDANCE_TEXT = [
    'OFFICIAL NDIS REFERENCE: WHAT IS A FUNCTIONAL CAPACITY ASSESSMENT',
    `Source: ${FCA_REFERENCE_SOURCE_URL} (National Disability Insurance Agency; page current as of 29 May 2026).`,
    '',
    'What it is:',
    '- An official assessment of a person\'s ability to perform daily tasks at home, at work and in the community.',
    '- It is completed by an occupational therapist, physiotherapist, psychologist or medical specialist who is qualified to make the assessment.',
    `- It is split into 6 areas: ${FCA_REFERENCE_FUNCTIONAL_AREAS.join(', ')}.`,
    '',
    'What it is for:',
    '- It can support eligibility: a functional capacity assessment is not required for NDIS eligibility, but it can be used as evidence of how a permanent impairment reduces functional capacity. The participant, their treating health professional or a carer can also provide supporting evidence of how the disability impacts everyday life.',
    '- It helps determine the supports needed: the NDIA uses the information to determine what kinds of NDIS supports are needed in the plan. This may include recommendations for assistive technology, specific therapies, or modifications to the participant\'s home or workplace.',
    '',
    'What it is like:',
    '- It takes time: 1 to 10 hours depending on the health professional and the disability.',
    '- The treating health professional assesses the person\'s ability to perform tasks, for example personal care (dressing, bathing, grooming, going to the toilet), mobility (moving around independently and using mobility aids), communication (through speech or writing), working (work-related activities such as lifting, carrying or typing), leisure and social activities (hobbies, sports and social activities), and cognitive function (tasks requiring thinking, memory and decision-making).',
    '',
    'How to use this reference:',
    `- Frame the report in the NDIA\'s own definitions and language, and map the available evidence explicitly onto the 6 areas (${FCA_REFERENCE_FUNCTIONAL_AREAS.join(', ')}) wherever that evidence exists.`,
    '- Link observed functional impact to the supports under consideration, including assistive technology, specific therapies, and home or workplace modifications.',
    '- Never present this reference as participant-specific detail: it is not an observation, a finding, an assessment result or a supporting document for the participant, and must never be quoted as evidence about them.',
].join('\n')

/** Character budget for a caller-supplied override, so one config value cannot flood every prompt. */
export const FCA_REFERENCE_GUIDANCE_MAX_CHARS = 12000

/**
 * Resolve the guidance block for a job. An explicit string override (report type
 * `fcaPromptConfig.referenceGuidance`) wins when it is non-empty; an explicit `false`/empty value
 * from that config disables the block, and anything else falls back to the built-in NDIS text.
 */
export function resolveFcaReferenceGuidance(override) {
    if (override === false || override === null) return ''

    if (typeof override === 'string') {
        const trimmed = override.trim()
        if (!trimmed) return ''
        return trimmed.slice(0, FCA_REFERENCE_GUIDANCE_MAX_CHARS)
    }

    return FCA_REFERENCE_GUIDANCE_TEXT
}
