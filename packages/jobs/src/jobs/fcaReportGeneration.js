import { FCA_LANGUAGE_MANIFEST } from './fcaLanguageManifest.js'
import { resolveFcaReferenceGuidance, FCA_REFERENCE_GUIDANCE_TEXT, FCA_REFERENCE_SOURCES } from './fcaReferenceGuidance.js'
import { resolveAnalystCapturedDocumentIds, suppressAnalystScopedAttachments } from './fcaAnalysisScope.js'
import { deidentifyLlmText, restoreIdentityInText } from '../privacy/index.js'
import { requestChatCompletion, isUnsupportedChatProvider, resolveChatApiKey, resolveChatProviderLabel } from './chatModelRequest.js'

export const FCA_REPORT_BLUEPRINT = [
    {
        id: 'referral-purpose',
        title: 'Referral Context and Report Purpose',
        minWords: 330,
        keywords: ['ndis', 'plan', 'review', 'goal', 'funding'],
    },
    {
        id: 'participant-context',
        title: 'Participant Context and Living Situation',
        minWords: 420,
        keywords: ['family', 'home', 'housing', 'support worker', 'community', 'carer'],
        subheadings: ['Living arrangements and informal supports', 'Current funded support and carer context'],
    },
    {
        id: 'medical-background',
        title: 'Clinical Background and Relevant History',
        minWords: 540,
        keywords: ['diagnosis', 'medical', 'neurology', 'pain', 'fatigue', 'history'],
    },
    {
        // The change of circumstances request is the legal trigger for the whole report, so it is a
        // section in its own right rather than a paragraph buried in the clinical background.
        id: 'change-of-circumstances',
        title: 'Change of Circumstances Since the Last Plan Review',
        minWords: 420,
        keywords: ['change', 'since', 'decline', 'deterioration', 'review', 'worse'],
        subheadings: ['What has changed', 'Functional consequences of the change'],
    },
    {
        id: 'falls-injury-history',
        title: 'Falls and Injury History',
        minWords: 420,
        keywords: ['fall', 'fell', 'fracture', 'injury', 'hospital', 'ambulance'],
        subheadings: ['Recorded falls and injuries', 'Pattern and contributing factors'],
    },
    {
        id: 'current-functioning',
        title: 'Current Functional Presentation',
        minWords: 660,
        keywords: ['mobility', 'communication', 'cognition', 'transfer', 'safety'],
        subheadings: ['Mobility and transfers', 'Communication and cognition', 'Learning, self-management and social interaction'],
    },
    {
        id: 'adl-personal-care',
        title: 'Personal Care and Activities of Daily Living',
        minWords: 660,
        keywords: ['toileting', 'showering', 'dressing', 'grooming', 'eating', 'feeding'],
        subheadings: ['Personal care', 'Continence and toileting', 'Eating, swallowing and medication'],
    },
    {
        id: 'domestic-community',
        title: 'Domestic Function and Community Participation',
        minWords: 570,
        keywords: ['domestic', 'cleaning', 'laundry', 'transport', 'community', 'access'],
        subheadings: ['Domestic activities', 'Community access and participation'],
    },
    {
        // Overnight need is where a CANS level of 6 is actually earned, and it is the part of the
        // request a daytime-only record cannot evidence.
        id: 'overnight-sleep',
        title: 'Sleep, Overnight Needs and Wellbeing',
        minWords: 390,
        keywords: ['sleep', 'overnight', 'night', 'waking', 'bed', 'fatigue'],
        subheadings: ['Overnight support needs', 'Sleep and its functional consequences'],
    },
    {
        id: 'assistive-technology',
        title: 'Assistive Technology and Environmental Supports',
        minWords: 420,
        keywords: ['assistive', 'equipment', 'wheelchair', 'hoist', 'modification'],
        subheadings: ['Current equipment and its effectiveness', 'Home modifications and environmental supports'],
    },
    {
        id: 'risk-safeguarding',
        title: 'Risk Profile and Safeguarding Considerations',
        minWords: 540,
        keywords: ['risk', 'fall', 'behaviour', 'escalation', 'supervision', 'unsafe'],
        subheadings: ['Specific risks and incidents', 'Supervision needs and limits of equipment', 'Informal support sustainability'],
    },
    {
        id: 'restrictive-practice',
        title: 'Restrictive Practice Considerations',
        minWords: 330,
        keywords: ['restrictive', 'restrict', 'locked', 'surveillance', 'consent'],
        subheadings: ['Current arrangements', 'Characterisation and recommendations'],
    },
    {
        id: 'support-worker-training',
        title: 'Capability and Training Requirements for Support Workers',
        minWords: 330,
        keywords: ['training', 'capability', 'competency', 'induction', 'worker'],
        subheadings: ['Reported incidents', 'Implications for support'],
    },
    {
        id: 'standardised-assessment-summary',
        title: 'Assessment Findings and Clinical Interpretation',
        minWords: 420,
        keywords: ['whodas', 'assessment', 'score', 'measure', 'interpretation'],
        subheadings: ['Standardised measures', 'Clinical interpretation and evidence limitations'],
    },
    {
        id: 'goals-outcomes',
        title: 'Goals and Expected Outcomes',
        minWords: 390,
        keywords: ['goal', 'outcome', 'participation', 'capacity building', 'routine'],
    },
    {
        id: 'alternatives-considered',
        title: 'Consideration of Alternatives',
        minWords: 420,
        keywords: ['alternative', 'residential', 'hospital', 'cost', 'option'],
        subheadings: ['The medical position', 'Residential care considered'],
    },
    {
        id: 'recommendations-funding',
        title: 'Recommendations and Funding Rationale',
        minWords: 780,
        keywords: ['recommend', 'support', 'funding', 'reasonable', 'necessary', 'hours'],
        subheadings: ['Requested support and hours', 'Assistive technology and home modifications', 'Therapeutic supports and review'],
    },
    {
        id: 'rationale-conclusion',
        title: 'Conclusion and Review Recommendations',
        minWords: 360,
        keywords: ['conclusion', 'review', 'ongoing', 'supports', 'evidence'],
    },
]

/**
 * The executive summary leads every report and is deliberately not scaled by the body multiplier:
 * its whole purpose is to be read in one sitting by the NDIA planner who may not read any other
 * section, so each style carries its own target instead.
 */
export const FCA_EXECUTIVE_SUMMARY_SECTION = {
    id: 'executive-summary',
    title: 'Executive Summary',
    role: 'executive-summary',
    minWords: 800,
    keywords: ['support', 'funding', 'recommend', 'risk', 'function', 'participation', 'ndis', 'hours'],
    // The summary the NDIA planner actually reads is a structured argument, not four plain
    // paragraphs: the recommendation, the measures behind it, the mechanism, the history that
    // proves it, and what happens if it is not funded.
    subheadings: [
        'Assessed level of need',
        'The central clinical finding',
        'Consequences to date',
        'Carer sustainability',
        'The alternative',
    ],
}

/** Every section the worker generates, in report order. */
export const FCA_REPORT_SECTIONS = [FCA_EXECUTIVE_SUMMARY_SECTION, ...FCA_REPORT_BLUEPRINT]

export const FCA_REPORT_STYLE_STANDARD = 'standard'
export const FCA_REPORT_STYLE_EXTENDED = 'extended'

/**
 * Report styles.
 *
 * `bodyWordMultiplier` scales each body section's resolved target, so a section a domain has
 * customised in report settings scales with the style rather than being overridden by it.
 * `summaryMinWords` is the executive summary target (never multiplied).
 */
export const FCA_REPORT_STYLES = {
    [FCA_REPORT_STYLE_STANDARD]: {
        id: FCA_REPORT_STYLE_STANDARD,
        label: 'Standard',
        bodyWordMultiplier: 1,
        // Calibrated against a clinician's own finalised FCA, whose executive summary runs to
        // roughly 830 words: the summary carries the recommendation, the standardised scores and
        // the clinical argument, and a 450-word target could not hold them.
        summaryMinWords: 800,
    },
    [FCA_REPORT_STYLE_EXTENDED]: {
        id: FCA_REPORT_STYLE_EXTENDED,
        label: 'Extended',
        // Body sections roughly 2.2x, taking the standard report (~19 A4 pages) to ~40.
        bodyWordMultiplier: 2.2,
        summaryMinWords: 1000,
    },
}

/** Words per A4 page used for the length estimate. Keep in step with the builder. */
export const FCA_WORDS_PER_PAGE = 350

function resolveStyleInput(styleInput) {
    if (styleInput && typeof styleInput === 'object' && !Array.isArray(styleInput)) {
        return Object.values(FCA_REPORT_STYLES).find((style) => style.id === styleInput.id)
            || FCA_REPORT_STYLES[FCA_REPORT_STYLE_STANDARD]
    }

    const normalized = String(styleInput || '').trim().toLowerCase()
    return FCA_REPORT_STYLES[normalized] || FCA_REPORT_STYLES[FCA_REPORT_STYLE_STANDARD]
}

/** Resolve a builder/queue style value (anything unrecognised is Standard). */
export function resolveFcaReportStyle(styleInput) {
    return resolveStyleInput(styleInput)
}

/**
 * The style a report runs at.
 *
 * The builder is the only chooser (its value rides on the form data). Report settings deliberately do
 * not carry a style, so an unrecognised or absent value means Standard.
 */
export function resolveFcaStyleForReport(builderFormData) {
    const style = builderFormData && typeof builderFormData === 'object' && !Array.isArray(builderFormData)
        ? builderFormData.reportStyle
        : ''
    return resolveStyleInput(style)
}

function scaleWordsForStyle(words, multiplier) {
    const base = Number.parseInt(String(words || '').trim(), 10)
    if (!Number.isFinite(base) || base <= 0) return 0
    const factor = Number(multiplier)
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return base
    // Rounded to the nearest 10 so the prompt states a tidy target.
    return Math.round((base * factor) / 10) * 10
}

/**
 * Clinician steering notes from the builder's final step.
 *
 * They are direction, not evidence: "new funding is available - emphasise assistive technology" is a
 * priority instruction, so it is sent as prompt guidance and never scored as corpus text. A steering
 * sentence must not be selectable as an observation about the participant.
 */
export function resolveFcaSteeringNotes(builderFormData) {
    if (!builderFormData || typeof builderFormData !== 'object' || Array.isArray(builderFormData)) return ''
    return normalizeText(builderFormData.additionalNotes, 2000).trim()
}

const SENTENCE_LIMIT_PER_SECTION = 9

/**
 * Evidence lines offered to one section's writer, by report style.
 *
 * Extended asks for 2.2x the prose, so it needs more source material rather than a longer stretch of
 * the same nine lines - stretching was showing up as 1:4 to 1:6 source-to-target ratios. Measured on
 * a real record the candidate pool runs 13-98 sentences a section, so this is a budget choice, not a
 * shortage of evidence.
 */
const SENTENCE_LIMITS_BY_STYLE = {
    [FCA_REPORT_STYLE_STANDARD]: 9,
    [FCA_REPORT_STYLE_EXTENDED]: 15,
}

function resolveEvidenceLineLimit(styleInput) {
    const style = resolveStyleInput(styleInput)
    return SENTENCE_LIMITS_BY_STYLE[style.id] || SENTENCE_LIMIT_PER_SECTION
}

/**
 * The share of a section's evidence budget the analyst may take.
 *
 * The analyst anchors a section, but it must not fill it: the participant record - including the
 * clinician's own goals, concerns and support lists - keeps a share of every section. Without this,
 * a section the analyst is heavy on (the funding section, where it contributes a support line each)
 * ends up with no record evidence at all.
 */
const FCA_ANALYST_FINDING_SHARE = 0.8

/**
 * Runaway guard for text about to reach the model, not a context budget.
 *
 * This was 12,000 characters and was applied *after* the corpus sources were joined, so it
 * truncated the corpus as one string: `notes` always consumed the whole allowance and every
 * source behind it (attachments, transcript evidence, builder fields) was silently dropped from
 * the report. The real contract is the per-source caps in `buildCorpus`, and the text that
 * actually reaches a prompt is bounded by `SENTENCE_LIMIT_PER_SECTION` sentences per section -
 * the corpus is a selection pool, not prompt payload.
 */
export const FCA_DEIDENTIFY_MAX_CHARS = 250000

/**
 * Per-source corpus caps. Each source is capped on its own, before the join, so no source can
 * evict another. They appear in the joined corpus in this order: analyst findings, notes,
 * attachments, transcript evidence, builder summary.
 */
export const FCA_CORPUS_ANALYSIS_CHARS = 120000
export const FCA_CORPUS_NOTES_CHARS = 120000
// Matches the builder's MAX_ATTACHMENT_CONTEXT_CHARS: the whole attached-document block the
// clinician built is what the worker scores, rather than a sliver of it.
export const FCA_CORPUS_ATTACHMENT_CHARS = 120000
export const FCA_CORPUS_TRANSCRIPT_CHARS = 120000
export const FCA_CORPUS_BUILDER_CHARS = 25000

/** Findings copied into the corpus text. The analyst itself caps a run at 80. */
/** Total analyst lines copied into the corpus text (findings, then supports). */
export const FCA_CORPUS_ANALYSIS_MAX_LINES = 80

/** The section the analyst's support findings are evidence for. */
const FCA_ANALYSIS_FUNDING_SECTION_ID = 'recommendations-funding'

const FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT = [
    'You are an expert occupational therapist writing FCA report sections for NDIS plan review.',
    'Use only the supplied participant evidence; approved language stems are loose style guidance, never facts.',
    'Do not invent diagnoses, scores, dates, medications, incidents, support hours, or assessment findings.',
    'Write in professional Australian clinical English: specific, measured, readable, and grounded in real-world function.',
    'Aim for about {{MIN_WORDS}} words, but evidence takes priority over length; never pad or repeat content to reach a target.',
    'The report shell supplies the cover page and starts every numbered section on a new A4 page. Do not add a cover page, a second title, page-break markup, or a horizontal rule yourself.',
].join(' ')

const FCA_OPENAI_SYSTEM_QUALITY_GUIDANCE = [
    'Follow a clear report hierarchy: keep the supplied section title as the section heading, use the supplied topic headings as level-three markdown headings, and use short lists or compact tables when they make evidence easier to scan.',
    'For the executive summary, format the opening recommendation as a short standalone paragraph, then group key findings under concise subheadings instead of writing one uninterrupted block of prose.',
    'Evidence takes priority over word targets. Never pad or repeat content to reach a minimum.',
    'Attribute direct observation, reported information, and clinical-record findings only when the supplied evidence identifies the source.',
    'Use first person only for the assessing OT\'s actions or observations when the evidence confirms them.',
    'The report template supplies the cover page. Every numbered section starts on a new A4 page; the report assembler inserts that break, so never add page-break markup, horizontal rules, or a repeated title yourself.',
].join(' ')

/**
 * When each callout box is earned, by report style.
 *
 * A box is emphasis, not decoration: the practice's reference FCA uses a handful of boxes across
 * dozens of pages, roughly one every three or four pages, and each is tied to a different kind of
 * statement. A standard report is shorter and needs fewer still. The style decides which of the four
 * treatments the model should reach for and how often; the marker spellings themselves are shared
 * with the renderer.
 */
const FCA_CALLOUT_GUIDANCE_BY_STYLE = {
    [FCA_REPORT_STYLE_STANDARD]: [
        'Boxed callouts: a standard report carries only a few, because a box marks a statement the reader must be able to quote rather than ordinary emphasis.',
        'Use [!recommendation] for the support request and [!opinion] for the closing clinical opinion.',
        'Add one [!evidence] box only where the weight of the evidence needs stating, or one [!summary] box for the executive summary\'s closing precis.',
        'Do not box other section summaries, clinical findings, ordinary paragraphs, tables or lists.',
    ].join(' '),
    [FCA_REPORT_STYLE_EXTENDED]: [
        'Boxed callouts: match the box to the statement.',
        'Use [!summary] for the short bold-labelled precis ("In short", "Summary") that closes a substantial section such as the executive summary, the risk assessment or a comparison of alternatives;',
        '[!evidence] once, for the weight-of-evidence note; [!finding] for a clinical determination the reader must not miss, such as a restrictive-practice position or the carer\'s stated position;',
        '[!recommendation] for the funding request and [!opinion] for the closing clinical opinion.',
        'Spread the boxes through the report rather than forcing one into every section, never place two boxes together, and keep tables and lists outside them.',
    ].join(' '),
}

/** The callout rules for the report style being written. */
export function buildFcaCalloutGuidance(styleInput) {
    const style = resolveStyleInput(styleInput)
    return FCA_CALLOUT_GUIDANCE_BY_STYLE[style.id] || FCA_CALLOUT_GUIDANCE_BY_STYLE[FCA_REPORT_STYLE_STANDARD]
}

function buildFcaQualityGuidance(styleInput) {
    return [FCA_OPENAI_SYSTEM_QUALITY_GUIDANCE, buildFcaCalloutGuidance(styleInput)].join(' ')
}

const FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT = [
    'Section: {{SECTION_TITLE}}',
    '',
    'Participant: {{PATIENT_NAME}}',
    '',
    'Practice: {{PRACTICE_NAME}}',
    '',
    'Evidence:',
    '- {{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}',
    '',
    'Approved language stems (use only as loose style guidance; do not copy them verbatim):',
    '- {{APPROVED_SNIPPETS_OR_NONE}}',
    '',
    'Output requirements: write a coherent, concrete clinical narrative that links each relevant functional impact to its practical support implication.',
    'Attribute information only as specifically as the evidence permits. Do not describe a finding as directly observed, assessed by the author, reported by a family member, or documented by another clinician unless the evidence identifies that source.',
    'For recommendations, clearly distinguish current supports from requested supports. State the exact hours, days, and schedule only when supplied; never calculate or infer a request from partial information.',
    'Include a standardised measure only when the evidence names the instrument and provides its result. Preserve the recorded score, scale, date, and comparison exactly; do not infer missing scores or claim a measure was administered.',
    'Use concise markdown subheadings when they help a reader locate distinct topics, and do not create a heading for a topic with no supporting evidence. Avoid repeating a fact in multiple sections, stock phrases, generic filler, template notices, and raw context or bullet dumps.',
    'Layout: the template supplies the cover page and the report assembler starts every numbered section on a new A4 page. Do not add a cover page, duplicate title, page-break markup, or "---" separators to the section body.',
].join('\n')

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Swap a bare domain key for the practice's display name in report text.
 *
 * Notes, transcripts and summaries name the practice by its domain key ("example attended
 * the review"), which the model then echoes into the report body. Email addresses, URLs and
 * hyphenated config keys that merely contain the key are left untouched.
 */
export function replaceDomainKeyWithPracticeName(text, domainKey, practiceName) {
    const source = String(text || '')
    const key = String(domainKey || '').trim()
    const practice = String(practiceName || '').trim()
    if (!source || !key || !practice || key.toLowerCase() === practice.toLowerCase()) return source

    const matcher = new RegExp(`(?<![\\w@./-])${escapeRegExp(key)}(?![\\w./-])`, 'gi')
    return source.replace(matcher, practice)
}

// Builder fields that may reach the model. Everything else on the builder form stays out of the
// corpus: the participant's name, NDIS number, date of birth, address, plan manager, phone and the
// other identifying intake answers are collected separately as `participantIdentity`, which is used
// to strip those values out of free text (and is kept as the report's identity glossary, for a restore
// pass that does not exist yet). An allow-list is deliberate - a new identity field cannot leak by
// being added.
//
// The clinician's steering notes (`additionalNotes`) are deliberately absent too: they are sent as
// prompt guidance (see `resolveFcaSteeringNotes`) and never scored as evidence.
const FCA_LLM_BUILDER_FIELDS = new Set([
    'backgroundSummary',
    'concerns',
    'diagnosisSummary',
    'interventions',
    'currentInterventions',
    'recommendedInterventions',
    'goals',
    // NDIS context facts surfaced on the earlier steps. These carry no identifiers.
    'fundingSource',
    'supportCoordinator',
    'interpreterRequired',
    'accidentDate',
    'referrerRelationship',
    'appointmentHistory',
])

// De-identification lives in `src/lib/privacy/` so the FCA builder, the report writer, the analyst
// and the transcript summariser all strip the same identifiers the same way. These re-exports keep
// the existing call sites and tests on the shared implementation.
export {
    buildIdentityReplacements,
    deidentifyLlmText,
    hasIdentityValues,
    sanitizeLlmContextText,
} from '../privacy/index.js'

function normalizeText(value, maxLength = 250000) {
    return String(value || '').replace(/\r\n/g, '\n').slice(0, maxLength)
}

function sentenceSplit(source) {
    return String(source || '')
        .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 20)
}

function tokenize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
}

function wordCount(value) {
    return tokenize(value).length
}

function uniqueLines(lines) {
    const seen = new Set()
    const out = []
    for (const line of lines) {
        const key = line.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(line)
    }
    return out
}

function summarizeBuilderFormValue(value, indentLevel = 0) {
    const indent = '  '.repeat(indentLevel)

    if (value == null || value === '') {
        return []
    }

    if (typeof value === 'string') {
        const text = normalizeText(value, 8000)
        if (!text) return []

        const lines = text.split('\n')
        if (lines.length === 1) {
            return [text]
        }

        return [lines[0], ...lines.slice(1).map((line) => `${indent}  ${line}`)]
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return [String(value)]
    }

    if (Array.isArray(value)) {
        const lines = []
        for (const item of value.slice(0, 50)) {
            const itemLines = summarizeBuilderFormValue(item, indentLevel + 1)
            if (itemLines.length === 0) continue

            if (itemLines.length === 1) {
                lines.push(`${indent}- ${itemLines[0]}`)
            } else {
                lines.push(`${indent}- ${itemLines[0]}`)
                lines.push(...itemLines.slice(1).map((line) => `${indent}  ${line.trimStart()}`))
            }
        }
        return lines
    }

    if (typeof value === 'object') {
        const lines = []
        for (const [key, item] of Object.entries(value)) {
            const itemLines = summarizeBuilderFormValue(item, indentLevel + 1)
            if (itemLines.length === 0) continue

            if (itemLines.length === 1) {
                lines.push(`${indent}${key}: ${itemLines[0]}`)
            } else {
                lines.push(`${indent}${key}: ${itemLines[0]}`)
                lines.push(...itemLines.slice(1).map((line) => `${indent}  ${line.trimStart()}`))
            }
        }
        return lines
    }

    return [String(value)]
}

function summarizeBuilderFormData(builderFormData) {
    if (!builderFormData || typeof builderFormData !== 'object' || Array.isArray(builderFormData)) {
        return ''
    }

    return Object.entries(builderFormData)
        // Identity and bookkeeping keys never reach the corpus; see FCA_LLM_BUILDER_FIELDS.
        .filter(([key]) => FCA_LLM_BUILDER_FIELDS.has(String(key || '').trim()))
        .flatMap(([key, value]) => summarizeBuilderFormValue(value).map((line, index) => index === 0 ? `${key}: ${line}` : `  ${line}`))
        .filter(Boolean)
        .join('\n')
}

function resolveLegacyBuilderTranscriptSummary(builderFormData) {
    if (!builderFormData || typeof builderFormData !== 'object' || Array.isArray(builderFormData)) {
        return ''
    }

    const candidates = [
        builderFormData.transcriptSummaryReview,
        builderFormData.transcriptSummary,
        builderFormData.editedTranscriptSummary,
    ]

    for (const candidate of candidates) {
        const text = normalizeText(candidate, 120000).trim()
        if (text) return text
    }

    return ''
}

// Step 9 stores the clinician's per-transcript decisions on the builder form:
//   formData.transcriptSelection = { excludedIds: number[], summaryOverrides: { [transcriptId]: string } }
// Ids are compared as strings because the builder keys overrides by whatever the API returned while
// the worker holds numeric ids.
export function resolveTranscriptSelection(builderFormData) {
    const source = builderFormData && typeof builderFormData === 'object' && !Array.isArray(builderFormData)
        ? builderFormData
        : {}
    const raw = source.transcriptSelection && typeof source.transcriptSelection === 'object' && !Array.isArray(source.transcriptSelection)
        ? source.transcriptSelection
        : {}

    const excludedIds = new Set(
        (Array.isArray(raw.excludedIds) ? raw.excludedIds : [])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean)
    )

    const summaryOverrides = new Map()
    const rawOverrides = raw.summaryOverrides && typeof raw.summaryOverrides === 'object' && !Array.isArray(raw.summaryOverrides)
        ? raw.summaryOverrides
        : {}
    for (const [key, value] of Object.entries(rawOverrides)) {
        const id = String(key || '').trim()
        const text = normalizeText(value, 120000).trim()
        if (id && text) summaryOverrides.set(id, text)
    }

    return { excludedIds, summaryOverrides }
}

function transcriptIdOf(item) {
    return String(item?.id ?? '').trim()
}

// Prefer the FCA-style summary. The generic style is a fallback so a patient whose FCA summaries
// have not been prepared yet still contributes evidence instead of producing an empty corpus.
function resolveTranscriptEvidencePayload(item) {
    const candidates = [item?.transcript_fca_summary_payload, item?.transcript_summary_payload]
    for (const candidate of candidates) {
        const payload = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null
        if (!payload) continue
        const facts = Array.isArray(payload.structuredEvidenceFacts)
            ? payload.structuredEvidenceFacts
            : Array.isArray(payload.evidenceFacts)
                ? payload.evidenceFacts
                : []
        if (facts.length > 0) return payload
    }
    return null
}

function resolveTranscriptEvidenceText(item) {
    return String(item?.transcript_fca_summary_text || item?.transcript_summary_text || '').trim()
}

function collectStoredTranscriptSummaries(transcripts) {
    return uniqueLines(
        (Array.isArray(transcripts) ? transcripts : [])
            .map((item) => resolveTranscriptEvidenceText(item))
            .filter(Boolean)
    ).join('\n\n')
}

function collectStructuredTranscriptEvidence(transcripts, maxFacts = 80) {
    const lines = []
    const items = Array.isArray(transcripts) ? transcripts : []

    for (const item of items) {
        const payload = resolveTranscriptEvidencePayload(item)
        const facts = Array.isArray(payload?.structuredEvidenceFacts)
            ? payload.structuredEvidenceFacts
            : Array.isArray(payload?.evidenceFacts)
                ? payload.evidenceFacts
                : []

        for (const fact of facts) {
            if (!fact || typeof fact !== 'object') continue
            const domain = String(fact.domain || 'general').trim()
            const observedIssue = normalizeText(fact.observedIssue, 320).trim()
            const functionalImpact = normalizeText(fact.functionalImpact, 260).trim()
            const supportImplication = normalizeText(fact.supportImplication, 260).trim()

            const detail = [observedIssue, functionalImpact, supportImplication].filter(Boolean).join(' ')
            if (!detail) continue

            lines.push(`[${domain}] ${detail}`)
            if (lines.length >= maxFacts) {
                return uniqueLines(lines).join('\n')
            }
        }
    }

    return uniqueLines(lines).join('\n')
}

/**
 * The analyst's findings and support decisions as corpus sentences.
 *
 * Written in the same `[domain] detail` shape as the transcript evidence block, which is what the
 * per-section keyword scoring already reads. They lead the corpus: the analyst is the curated view
 * of the record, so its findings are the first thing a section sees.
 *
 * The support arrays are included because they are the analyst's own evidence for the funding
 * section, and until now only the builder's Step 5 prefill read them - the report's largest section
 * was being written without the recommendations the analyst had just made.
 */
export function collectAnalystEvidenceText(analysisPayload) {
    const facts = Array.isArray(analysisPayload?.structuredEvidenceFacts)
        ? analysisPayload.structuredEvidenceFacts
        : []
    const lines = []

    for (const fact of facts) {
        if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue
        const domain = String(fact.domain || 'general').trim() || 'general'
        const detail = [fact.observedIssue, fact.functionalImpact, fact.supportImplication, fact.evidenceDetail]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' ')
        if (!detail) continue

        lines.push(`[${domain}] ${detail}`)
        if (lines.length >= FCA_CORPUS_ANALYSIS_MAX_LINES) break
    }

    // What is already in place comes after what is being asked for: the requested increase is what
    // the funding section exists to justify. Supports already funded are also represented in the
    // builder block (its `currentInterventions` field), so a truncated tail loses the least here.
    const supportGroups = [
        { items: analysisPayload?.recommendedInterventions, label: 'Support recommended' },
        { items: analysisPayload?.addressedInterventions, label: 'Support already in place' },
    ]

    for (const { items, label } of supportGroups) {
        for (const item of Array.isArray(items) ? items : []) {
            const line = describeAnalystSupport(item, label)
            if (!line) continue

            lines.push(line)
            if (lines.length >= FCA_CORPUS_ANALYSIS_MAX_LINES) break
        }
    }

    return uniqueLines(lines).join('\n')
}

function describeAnalystSupport(item, label) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return ''

    const intervention = String(item.intervention || '').trim()
    const justification = String(item.justification || '').trim()
    if (!intervention && !justification) return ''

    const provenance = describeSupportSources(item)
    return `[${FCA_ANALYSIS_FUNDING_SECTION_ID}] ${label}: ${[intervention, justification].filter(Boolean).join('. ')}${provenance}`
}

/**
 * Which source states a support, as a corpus suffix.
 *
 * Document file names are deliberately NOT written into the corpus: they carry the participant's
 * name, and a name quoted into a corpus line is a name the model can echo into report prose. The
 * report only needs to know the support is documented.
 */
function describeSupportSources(item) {
    const phrases = { notes: 'the notes', transcript: 'the consultation transcript', document: 'an in-scope document' }
    const sources = (Array.isArray(item?.sources) ? item.sources : [])
        .map((source) => String(source || '').trim().toLowerCase())
        .filter((source) => phrases[source])

    const unique = [...new Set(sources)]
    if (unique.length === 0) return ''

    const labels = unique.map((source) => phrases[source])
    const list = labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`

    return ` (stated in ${list})`
}

function buildCorpus({ notes, transcripts, additionalContext, builderFormData, participantIdentity, analysisEvidence, analystCapturedDocumentIds }) {
    const legacyBuilderSummary = resolveLegacyBuilderTranscriptSummary(builderFormData)
    const selection = resolveTranscriptSelection(builderFormData)

    // Exclusions are applied before any evidence is collected so an excluded transcript cannot
    // leak back in through its structured evidence facts.
    const selectedTranscripts = (Array.isArray(transcripts) ? transcripts : [])
        .filter((item) => !selection.excludedIds.has(transcriptIdOf(item)))

    const editedBlocks = []
    const storedTranscripts = []
    for (const item of selectedTranscripts) {
        const override = selection.summaryOverrides.get(transcriptIdOf(item))
        if (override) {
            editedBlocks.push(override)
        } else {
            storedTranscripts.push(item)
        }
    }

    const structuredTranscriptEvidence = collectStructuredTranscriptEvidence(storedTranscripts)
    const storedTranscriptSummaries = collectStoredTranscriptSummaries(storedTranscripts)

    const transcriptBlocks = []
    const transcriptSources = []
    if (legacyBuilderSummary) {
        transcriptBlocks.push(legacyBuilderSummary)
        transcriptSources.push('builder-edited-summary')
    }
    if (editedBlocks.length > 0) {
        transcriptBlocks.push(editedBlocks.join('\n\n'))
        if (!legacyBuilderSummary) transcriptSources.push('builder-edited-summary')
    }
    if (structuredTranscriptEvidence) {
        transcriptBlocks.push(structuredTranscriptEvidence)
    }
    if (storedTranscriptSummaries) {
        transcriptBlocks.push(storedTranscriptSummaries)
    }

    if (structuredTranscriptEvidence && storedTranscriptSummaries) {
        transcriptSources.push('stored-transcript-structured-evidence+summary')
    } else if (structuredTranscriptEvidence) {
        transcriptSources.push('stored-transcript-structured-evidence')
    } else if (storedTranscriptSummaries) {
        transcriptSources.push('stored-transcript-summary')
    }

    const transcriptEvidenceText = transcriptBlocks.join('\n\n')
    const transcriptEvidenceSource = transcriptSources.length > 0 ? transcriptSources.join('+') : 'none'

    const builderSummarySource = builderFormData && typeof builderFormData === 'object' && !Array.isArray(builderFormData)
        ? {
            ...builderFormData,
            transcriptSummaryReview: undefined,
            transcriptSummary: undefined,
            editedTranscriptSummary: undefined,
            // Selection is ids and overrides only - it is not report evidence.
            transcriptSelection: undefined,
        }
        : null

    const builderSummary = builderSummarySource
        ? summarizeBuilderFormData(builderSummarySource)
        : ''

    const attachmentContext = Array.isArray(analystCapturedDocumentIds) && analystCapturedDocumentIds.length > 0
        ? suppressAnalystScopedAttachments(additionalContext, analystCapturedDocumentIds).text
        : additionalContext

    // De-identify before the text is scored, not just before it is prompted: the heuristic section
    // writer embeds evidence lines straight into the report body, so an unsanitised corpus would
    // leak names through the fallback path too.
    //
    const analystEvidenceText = collectAnalystEvidenceText(analysisEvidence)
    const analystText = deidentifyLlmText(
        normalizeText(analystEvidenceText, FCA_CORPUS_ANALYSIS_CHARS),
        { participantIdentity, patientName: participantIdentity?.participantName }
    )
    const analystSentencesByDomain = indexAnalystSentencesByDomain(analystText)

    // Each source is sanitised on its own so that its own cap governs it. Sanitising the joined
    // string meant the ceiling on that call truncated the *concatenation*, which made the join
    // order decide what survived: notes came first, so a long notes table evicted the attached
    // documents and the builder fields entirely. Sources are now independent - a large notes table
    // cannot push the clinician's attachment out of the corpus.
    const deidentifiedSources = [
        { label: 'structured analysis findings', text: normalizeText(analystEvidenceText, FCA_CORPUS_ANALYSIS_CHARS) },
        { label: 'clinical notes', text: normalizeText(notes, FCA_CORPUS_NOTES_CHARS) },
        { label: 'attached documents', text: normalizeText(attachmentContext, FCA_CORPUS_ATTACHMENT_CHARS) },
        { label: 'consultation summaries', text: normalizeText(transcriptEvidenceText, FCA_CORPUS_TRANSCRIPT_CHARS) },
        { label: 'clinician-entered builder details', text: normalizeText(builderSummary, FCA_CORPUS_BUILDER_CHARS) },
    ]
        .map((source) => ({
            ...source,
            text: deidentifyLlmText(source.text, { participantIdentity, patientName: participantIdentity?.participantName }),
        }))
        .filter((source) => source.text)
    const deidentified = deidentifiedSources.map((source) => source.text).join('\n\n')
    const sentences = uniqueLines(deidentifiedSources.flatMap(({ label, text }) =>
        sentenceSplit(text).map((sentence) => `[Evidence source: ${label}] ${sentence}`)
    ))

    return {
        text: deidentified,
        sentences,
        analystSentencesByDomain,
        transcriptEvidenceSource,
    }
}

/**
 * Index the analyst's findings by the section each one is labelled with.
 *
 * Runs over the *de-identified* findings, so the indexed sentences are the exact strings the corpus
 * contains - an identity swap must not turn a placement instruction into a silent miss.
 */
function indexAnalystSentencesByDomain(deidentifiedAnalystText) {
    const byDomain = new Map()

    for (const line of String(deidentifiedAnalystText || '').split('\n')) {
        const sentence = line.trim()
        if (!sentence) continue

        const match = /^\[([^\]]+)\]/.exec(sentence)
        const domain = match ? match[1].trim() : ''
        if (!domain) continue

        if (!byDomain.has(domain)) byDomain.set(domain, [])
        byDomain.get(domain).push(`[Evidence source: structured analysis findings] ${sentence}`)
    }

    return byDomain
}

function scoreSentence(sentence, keywords) {
    const lower = sentence.toLowerCase()
    let score = 0
    for (const keyword of keywords) {
        if (lower.includes(keyword.toLowerCase())) {
            score += 2
        }
    }

    // Slightly favor richer observations.
    score += Math.min(4, Math.floor(sentence.length / 120))
    return score
}

function inferProfileTags(text) {
    const lower = String(text || '').toLowerCase()
    const tags = []
    const checks = [
        ['manual-handling', /hoist|transfer|sling|two support|manual handling/],
        ['behaviour', /behaviou?r|escalation|aggressive|unsafe|frustration/],
        ['mobility', /mobility|gait|wheelchair|walk|transfer/],
        ['communication', /aphasia|communication|expressive|receptive|dysphasia/],
        ['pain', /pain|neuropathic|discomfort/],
        ['fatigue', /fatigue|tired|endurance/],
        ['community', /community|transport|participation|social/],
        ['assistive', /assistive|equipment|at\b|modification|technology/],
        ['ndis', /ndis|plan review|reasonable and necessary/],
    ]

    for (const [tag, pattern] of checks) {
        if (pattern.test(lower)) {
            tags.push(tag)
        }
    }

    return tags
}

function collectEvidenceForSection(section, corpus, sentenceLimit = SENTENCE_LIMIT_PER_SECTION, excludedSentences = new Set()) {
    const limit = Number.isFinite(sentenceLimit) && sentenceLimit > 0 ? sentenceLimit : SENTENCE_LIMIT_PER_SECTION

    // The analyst labels every finding with the section it belongs to, so a finding is placed by
    // that label rather than by keyword luck: scored by keywords alone it can score zero and be
    // dropped from the very section it was extracted for.
    const sectionFindings = corpus.analystSentencesByDomain?.get(section.id) || []
    const findingLimit = Math.max(1, Math.floor(limit * FCA_ANALYST_FINDING_SHARE))
    const findings = sectionFindings
        .filter((sentence) => !excludedSentences.has(sentence))
        .slice(0, findingLimit)
    const placedFindings = new Set(findings)

    // Every sentence of this section's findings is held out of the scored pool, not just the placed
    // ones: a finding that did not fit the budget is keyword-dense on its own section's vocabulary,
    // so leaving it in the pool simply spent the reserved slots on the same findings again and the
    // record got none of them. Placed findings are excluded by containment, since one finding may be
    // several sentences (a finding plus the specifics recorded for it).
    const sectionFindingsText = sectionFindings
        .map(stripEvidenceSourceLabel)
        .join(' ')

    const remainingEvidence = corpus.sentences
        .filter((sentence) => !excludedSentences.has(sentence)
            && !placedFindings.has(sentence)
            && !sectionFindingsText.includes(stripEvidenceSourceLabel(sentence)))
        .map((sentence) => ({ sentence, score: scoreSentence(sentence, section.keywords) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, limit - findings.length))
        .map((item) => item.sentence)

    return uniqueLines([...findings, ...remainingEvidence])
}

function stripEvidenceSourceLabel(sentence) {
    return String(sentence || '').replace(/^\[Evidence source: [^\]]+\]\s*/, '')
}

function assignEvidenceSentencesToSections(sentences, sections) {
    const sectionIds = new Set(sections.map((section) => section.id))
    const owners = new Map()

    for (const sentence of sentences) {
        const labelledDomain = /^\[([^\]]+)\]/.exec(stripEvidenceSourceLabel(sentence))?.[1]?.trim()
        if (labelledDomain && sectionIds.has(labelledDomain)) {
            owners.set(sentence, labelledDomain)
            continue
        }

        const bestMatch = sections
            .map((section, index) => ({
                id: section.id,
                index,
                score: scoreSentence(sentence, section.keywords || []),
            }))
            .filter((match) => match.score > 0)
            .sort((a, b) => b.score - a.score || a.index - b.index)[0]

        if (bestMatch) owners.set(sentence, bestMatch.id)
    }

    return owners
}

function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return false
    if (typeof manifest.version !== 'number') return false
    if (!manifest.sections || typeof manifest.sections !== 'object') return false
    return true
}

function selectManifestSnippets({ sectionId, profileTags, maxSnippets = 2 }) {
    if (!validateManifest(FCA_LANGUAGE_MANIFEST)) return []

    const candidates = Array.isArray(FCA_LANGUAGE_MANIFEST.sections?.[sectionId])
        ? FCA_LANGUAGE_MANIFEST.sections[sectionId]
        : []

    if (candidates.length === 0) return []

    const tagsSet = new Set(Array.isArray(profileTags) ? profileTags : [])

    return [...candidates]
        .map((item) => {
            const tags = Array.isArray(item?.tags) ? item.tags : []
            const overlap = tags.reduce((acc, tag) => (tagsSet.has(tag) ? acc + 1 : acc), 0)
            return { ...item, overlap }
        })
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, maxSnippets)
        .map((item) => String(item.text || '').trim())
        .filter(Boolean)
}

function resolveConfiguredMinWords(section, promptConfig = {}) {
    const source = promptConfig && typeof promptConfig === 'object' && !Array.isArray(promptConfig) ? promptConfig : {}
    const sectionOverrides = source.sectionMinWords && typeof source.sectionMinWords === 'object' && !Array.isArray(source.sectionMinWords)
        ? source.sectionMinWords
        : {}
    const sectionOverride = Number.parseInt(String(sectionOverrides[String(section?.id || '').trim()] || '').trim(), 10)

    if (Number.isFinite(sectionOverride) && sectionOverride > 0) {
        return { words: sectionOverride, isOverride: true }
    }

    const override = Number.parseInt(String(source.minWords || source.minimumWords || '').trim(), 10)
    if (Number.isFinite(override) && override > 0) {
        return { words: override, isOverride: true }
    }

    const fallback = Number.parseInt(String(section?.minWords || '').trim(), 10)
    return { words: Number.isFinite(fallback) && fallback > 0 ? fallback : 0, isOverride: false }
}

/**
 * The word target for one section: the configured target (report settings win) scaled by the report
 * style, so an Extended report grows every section rather than only the ones a domain left alone.
 *
 * The executive summary is the exception. It takes the style's own summary target unless a domain
 * configured one, because a summary that scales with the body stops being a summary.
 */
export function resolveFcaSectionMinWords(section, promptConfig = {}, styleInput) {
    const style = resolveStyleInput(styleInput)
    const configured = resolveConfiguredMinWords(section, promptConfig)

    if (section?.role === 'executive-summary') {
        return configured.isOverride && configured.words > 0 ? configured.words : style.summaryMinWords
    }

    if (!(configured.words > 0)) return 0
    return scaleWordsForStyle(configured.words, style.bodyWordMultiplier)
}

/** The opening sentences of a section, used for the executive summary digest. */
function firstSentences(value, maxChars = 420) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    if (text.length <= maxChars) return text

    let output = ''
    for (const sentence of sentenceSplit(text)) {
        if (output && (output.length + sentence.length + 1) > maxChars) break
        output = output ? `${output} ${sentence}` : sentence
    }

    if (!output) output = text.slice(0, maxChars).trim()
    return /[.!?]$/.test(output) ? output : `${output}.`
}

/**
 * The shapes a decisive fact takes: a score out of a maximum, a percentage, a CANS level, an
 * endorsed-item count, or a support load expressed in hours.
 */
const FCA_KEY_FACT_PATTERNS = [
    /\b\d+\s*(?:\/|out of)\s*\d+\b/i,
    /\b\d+(?:\.\d+)?\s*%/,
    /\bLevel\s+\d+\b/i,
    /\b\d+\s+(?:of|\/)\s+\d+\b/i,
    /\b\d+\s*(?:-|–|to)\s*\d+\s*(?:hours?|hrs?)\b/i,
    /\b(?:hours?|hrs?)\s+(?:per|a|each|every)\s+(?:day|week|night|shift)\b/i,
    /\bper\s+(?:day|week)\b/i,
]

/**
 * Which sections' numbers the summary writer sees first. The measures and the request come before
 * the sections that merely restate them, so a tight fact budget cannot be spent on duplicates.
 */
const FCA_KEY_FACT_SECTION_PRIORITY = [
    'standardised-assessment-summary',
    'recommendations-funding',
    'falls-injury-history',
    'risk-safeguarding',
    'alternatives-considered',
]

/**
 * Decisive measured or recorded details lifted out of the body sections for the executive summary.
 *
 * The summary is otherwise built from the opening ~420 characters of each body section, which is
 * usually a lead-in sentence rather than the number that carries the case: standardised scores sit
 * below their own introduction, and the requested hours sit at the end of the funding section. A
 * planner who reads only the summary then never sees either. These lines are selected by shape
 * rather than by section order, so a score or an hours figure reaches the summary wherever the body
 * recorded it.
 */
function extractExecutiveSummaryKeyFacts(sectionDraftsById, { maxFacts = 18, maxChars = 260 } = {}) {
    const orderedIds = [
        ...FCA_KEY_FACT_SECTION_PRIORITY,
        ...FCA_REPORT_BLUEPRINT.map((section) => section.id),
    ]
    const seenSections = new Set()
    const seenFacts = new Set()
    const facts = []

    for (const sectionId of orderedIds) {
        if (seenSections.has(sectionId)) continue
        seenSections.add(sectionId)

        const draft = sectionDraftsById.get(sectionId)
        const content = String(draft?.content || '')
        if (!content || content.startsWith('No section-specific evidence')) continue

        const candidates = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !/^#{1,6}\s/.test(line))
            .flatMap((line) => (line.startsWith('|') ? [line] : sentenceSplit(line)))

        for (const candidate of candidates) {
            const text = candidate
                .replace(/\s+/g, ' ')
                .replace(/^[|*\-\s]+/, '')
                .replace(/\s*\|$/, '')
                .trim()
            if (text.length < 8) continue
            if (!FCA_KEY_FACT_PATTERNS.some((pattern) => pattern.test(text))) continue

            const key = text.toLowerCase()
            if (seenFacts.has(key)) continue
            seenFacts.add(key)

            const clipped = text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text
            facts.push(`[Evidence source: ${draft.title || sectionId}] ${clipped}`)
            if (facts.length >= maxFacts) return facts
        }
    }

    return facts
}

/**
 * Heuristic executive summary.
 *
 * Built from the sections that were just written rather than from the raw corpus, so the fallback
 * path also leads with a digest of the report the NDIA planner is holding.
 */
function buildHeuristicExecutiveSummary({ evidenceLines, sectionDigests }) {
    const digests = uniqueLines((Array.isArray(sectionDigests) ? sectionDigests : []).filter(Boolean))

    if (digests.length === 0) {
        return evidenceLines.length > 0
            ? evidenceLines.map(formatHeuristicEvidenceLine).join('\n\n')
            : 'The selected source material does not contain enough section-specific findings to support an executive summary. Clinician review is needed before this draft is used.'
    }

    return [
        '### Key supported findings',
        ...digests.map((digest) => `- ${digest}`),
    ].join('\n\n')
}

function formatHeuristicEvidenceLine(line) {
    const source = /^\[Evidence source: ([^\]]+)\]\s*/.exec(line)
    const text = line.replace(/^\[Evidence source: [^\]]+\]\s*/, '')
    return source ? `- **${source[1]}:** ${text}` : `- ${text}`
}

function buildHeuristicSection({ section, evidenceLines, sectionDigests }) {
    if (section?.role === 'executive-summary') {
        return buildHeuristicExecutiveSummary({ evidenceLines, sectionDigests })
    }

    if (evidenceLines.length === 0) {
        return `No section-specific evidence was selected for ${String(section?.title || 'this area').toLowerCase()}. Clinician review is needed before submission.`
    }

    return evidenceLines.map(formatHeuristicEvidenceLine).join('\n')
}

function shouldUseModelAdapter({ provider, apiKey }) {
    if (!String(apiKey || '').trim()) return false
    return !isUnsupportedChatProvider(provider)
}

function applyPromptTemplate(template, replacements) {
    let output = String(template || '')
    for (const [token, value] of Object.entries(replacements || {})) {
        const safeToken = String(token || '').trim()
        if (!safeToken) continue
        const matcher = new RegExp(`{{\\s*${safeToken}\\s*}}`, 'g')
        output = output.replace(matcher, String(value || ''))
    }
    return output
}

/**
 * Neutralise a saved prompt's hard length ceiling while keeping its target.
 *
 * Report types configured before the evidence-first format commonly carry "and never more than 10%
 * above it" plus "stop rather than extending it". Those two clauses are why an executive summary
 * arrives at two thirds of its target: the model is told to stop as soon as the supplied evidence
 * has been covered, and the supplied evidence is deliberately a selection rather than the whole
 * record. The target itself is kept - it is the ceiling and the early stop that go.
 */
function stripLegacyLengthCeilings(template) {
    return String(template || '')
        .replace(/,?\s*and never more than \d+\s*%\s*(?:above|over)\s+(?:it|that)\b/gi, '')
        .replace(/\bThat is the target for the section, not a minimum\b[^.]*\./gi, 'Cover the evidence for this section fully, and let its length follow the evidence.')
        .replace(/\bTreat it as the target, not a floor\b[^.]*\./gi, 'Cover the evidence for this section fully, and let its length follow the evidence.')
        .replace(/\band stop once the evidence relevant to this section has been covered\.?/gi, '.')
        .replace(/\bstop rather than extending it\.?/gi, '.')
        .replace(/\bnever more than \d+\s*%\s*(?:above|over)\b[^.]*\./gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([.;,])/g, '$1')
        .replace(/\.\s*\./g, '.')
}

/**
 * The callout instruction saved prompt templates should carry.
 *
 * Earlier defaults offered only the evidence and opinion boxes and capped them at one per section.
 * That is the wrong rule for a report that distinguishes section summaries from findings and uses
 * boxes sparsely, so the saved sentence is rewritten rather than left to contradict the style
 * guidance appended to the system prompt.
 */
const FCA_CALLOUT_TEMPLATE_LINE = 'Boxed callouts: open a blockquote with [!summary], [!evidence], [!finding], [!recommendation] or [!opinion]; the system guidance says when each applies. Put the lead-in label in bold at the start of the box, and keep tables and lists outside it.'

function stripLegacyCalloutGuidance(template) {
    return String(template || '').replace(
        /\bBoxed callouts: open a (?:markdown quote|blockquote) with \[!evidence\][^\n]*?keep tables and lists outside it\./gi,
        FCA_CALLOUT_TEMPLATE_LINE
    )
}

function resolveFcaPromptTemplates(promptConfig) {
    const source = promptConfig && typeof promptConfig === 'object' && !Array.isArray(promptConfig)
        ? promptConfig
        : {}

    const systemPromptTemplate = stripLegacyLengthCeilings(
        stripLegacyCalloutGuidance(
            (String(source.systemPromptTemplate || '').trim() || FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE_DEFAULT)
                // Saved FCA settings may still carry the previous paragraph-only and hard minimum rules.
                // Replace these legacy directives so they cannot override the evidence-first format.
                .replace(/Return plain markdown paragraphs only\s*\(no heading\)\.?/gi, 'Use concise markdown subheadings where useful.')
                .replace(/\bMinimum\s+(?:\{\{\s*MIN_WORDS\s*\}\}|\d+)\s+words\.?/gi, 'Aim for about {{MIN_WORDS}} words, but do not pad or repeat content.')
        )
    )
    const userPromptTemplate = stripLegacyLengthCeilings(
        stripLegacyCalloutGuidance(
            String(source.userPromptTemplate || '').trim() || FCA_OPENAI_USER_PROMPT_TEMPLATE_DEFAULT
        )
    )

    return {
        systemPromptTemplate,
        userPromptTemplate,
    }
}

export function buildPromptGuardrails() {
    return [
        'Use names and roles only through locally restored identity references; never attempt to infer an identifying detail.',
        'Treat the official NDIS reference block as framing only - never quote it, and never present it as participant-specific evidence.',
        'Do not copy approved stems verbatim or use stock phrases such as "The purpose of this assessment", "The evidence identifies", or repeated "is required" constructions.',
        'The person being assessed is de-identified as "the participant" in the model input; refer to other people by the role stated in the evidence. The final report restores known names locally.',
        'Never write personal names, addresses, phone numbers, emails, dates of birth, NDIS or claim numbers, or any other identifying detail.',
        'Write as the assessing occupational therapist in a measured clinical voice, not as a file summariser. Where the source explicitly identifies your own assessment or observation, write naturally in first person (for example, "I observed..." or "During the home visit, I...").',
        'Evidence lines carry an [Evidence source: ...] label. Use it to distinguish clinical notes, attached documents, consultation summaries, structured analysis, and clinician-entered builder details; do not copy the bracketed label into the report.',
        'Distinguish direct observation from reported information. A source label identifies only the container, not who said or observed something. Attribute to the participant, their carer, a support worker, the assessing OT, or a clinical record only when the evidence text itself identifies that source. A clinical note does not automatically establish direct observation by the OT. Never invent assessment settings, dates, speakers, or observation.',
        'Avoid vague repeated lead-ins such as "the available information indicates" when the source is stated. Prefer precise phrasing such as "The clinical notes record...", "The participant reports...", or "The carer describes..." only when supported by the evidence.',
        'Use concrete examples and explain what assistance looks like in the task. State each finding once in its most relevant section; make the executive summary synthesize rather than repeat the body.',
        'For requested supports, separate the current package from the recommendation and use only exact hours, days, and schedules found in the evidence. For standardised assessments, include only explicitly supplied tools and results, with no inferred scores or comparisons.',
        'Do not add template notices, a second title, an unlabelled context dump, or recommendations unsupported by functional evidence.',
    ].join(' ')
}

/**
 * Framing for the executive summary. The reader is the NDIA planner, who may read only this section,
 * so it has to stand alone rather than pointing at the sections that follow.
 */
const FCA_EXECUTIVE_SUMMARY_GUIDANCE = [
    'This is the executive summary and must stand alone.',
    'The reader is an NDIA planner who may have 10-15 minutes and may read no other section, so this section carries the whole case: the recommendation, the evidence for it, and why it is the least costly safe option.',
    'Open with a clearly labelled recommendation as its own paragraph, naming the change requested and the current and requested support hours and schedule when those details are explicitly supported.',
    'Then write a substantive paragraph or short group of paragraphs under each of the supplied topic headings, covering in this order: the participant\'s functional profile and living situation; the assessed level of need, reporting every standardised measure supplied in the evidence with its exact score, band, date and comparison; the central clinical finding and the mechanism that explains it; the consequences already recorded, with their dates; carer sustainability where evidenced; and the alternative if the request is not funded.',
    'A leading group of key recorded facts is supplied. Treat each one as a finding to be placed in the summary, not as optional background: a standardised score, a recorded hour, or a dated consequence that the evidence supplies belongs in this section.',
    'Be concrete and attributable. Prefer the specific score, the specific date, the specific number of times a thing happened, and the specific consequence over a general statement of need. Do not restate the body\'s detailed examples at length, but do not withhold the decisive facts from the reader who reads only this section.',
    'Do not introduce any finding that is not present in the supplied evidence, and do not fill gaps with assumptions or estimates.',
].join(' ')

function buildSectionStructureGuidance(section) {
    const subheadings = Array.isArray(section?.subheadings) ? section.subheadings : []
    if (subheadings.length === 0) return ''

    return [
        'Use the following as level-three markdown headings for every topic supported by this section’s evidence. Keep the headings concise and omit a topic only when this section has no supporting evidence:',
        ...subheadings.map((heading) => `- ${heading}`),
    ].join('\n')
}

/**
 * The token values a section prompt is built from.
 *
 * Exported so the prompt contract can be checked without a network call - in particular that the
 * practice name reaches the model and the domain key never does. `DOMAIN` is kept as a legacy
 * alias for saved prompts and resolves to the same practice name.
 */
export function buildFcaPromptTokens({ section, minWords, domain, practiceName, evidenceLines = [], snippets = [] }) {
    const safeDomain = String(domain || '').trim() || 'unknown'
    const safePracticeName = String(practiceName || '').trim() || safeDomain
    const lines = Array.isArray(evidenceLines) ? evidenceLines : []
    const stems = Array.isArray(snippets) ? snippets : []

    return {
        MIN_WORDS: String(minWords),
        SECTION_TITLE: section.title,
        PATIENT_NAME: 'the participant',
        DOMAIN: safePracticeName,
        PRACTICE_NAME: safePracticeName,
        EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE: lines.length > 0 ? lines.join('\n- ') : 'No direct evidence available.',
        APPROVED_SNIPPETS_OR_NONE: stems.length > 0 ? stems.join('\n- ') : 'None supplied',
    }
}

async function generateSectionWithModel({
    section,
    patientName,
    participantIdentity,
    domain,
    practiceName,
    evidenceLines,
    snippets,
    referenceGuidanceText,
    model,
    baseUrl,
    apiKey,
    provider,
    promptConfig,
    style,
    steeringNotes,
}) {
    const templates = resolveFcaPromptTemplates(promptConfig)
    const sanitizedEvidenceLines = (Array.isArray(evidenceLines) ? evidenceLines : [])
        // The corpus is already de-identified; this keeps the prompt boundary safe on its own terms.
        .map((line) => deidentifyLlmText(line, { participantIdentity, patientName }))
        .filter(Boolean)

    const minWords = resolveFcaSectionMinWords(section, promptConfig, style)
    const tokens = buildFcaPromptTokens({
        section,
        minWords,
        domain,
        practiceName,
        evidenceLines: sanitizedEvidenceLines,
        snippets,
    })

    const systemPrompt = [
        applyPromptTemplate(templates.systemPromptTemplate, tokens).trim(),
        buildFcaQualityGuidance(style),
    ].filter(Boolean).join('\n\n')
    const userPrompt = applyPromptTemplate(templates.userPromptTemplate, tokens).trim()

    // The NDIS reference is appended rather than exposed as a template token: a report type that
    // overrides the prompt templates would otherwise silently drop it.
    const referenceBlock = String(referenceGuidanceText || '').trim()
        ? `Official NDIS reference (framing only, not participant evidence):\n${String(referenceGuidanceText).trim()}`
        : ''

    const sanitizedSteeringNotes = deidentifyLlmText(
        replaceDomainKeyWithPracticeName(steeringNotes, domain, practiceName),
        { participantIdentity, patientName }
    ).trim()
    const steeringBlock = sanitizedSteeringNotes
        ? `Clinician steering notes (direction for emphasis only - never treat as evidence, and never invent facts to support them):\n${sanitizedSteeringNotes}`
        : ''

    const guardedUserPrompt = [
        userPrompt,
        section?.role === 'executive-summary' ? FCA_EXECUTIVE_SUMMARY_GUIDANCE : '',
        buildSectionStructureGuidance(section),
        referenceBlock,
        steeringBlock,
        `Guardrails: ${buildPromptGuardrails()}`,
    ]
        .filter(Boolean)
        .join('\n\n')
        .trim()

    const result = await requestChatCompletion({
        provider,
        model: model || process.env.REPORT_WORKER_AI_MODEL || 'gpt-5-mini',
        baseUrl,
        apiKey,
        system: systemPrompt,
        messages: [{ role: 'user', content: guardedUserPrompt }],
        errorLabel: 'Report section generation failed',
    })

    if (!result.ok) {
        throw new Error(result.error)
    }

    const content = String(result.text || '').trim()
    if (!content) {
        throw new Error('Report section generation returned empty content')
    }

    return { content, usage: result.usage || null }
}

/**
 * Provider-reported usage for one section, summed across a report. `costUsd` stays 0 until a host
 * reports a charge, which is how the caller knows whether to price the tokens itself.
 */
function accumulateUsage(totals, usage) {
    if (!usage) return
    totals.calls += 1
    totals.inputTokens += Number(usage.inputTokens) || 0
    totals.outputTokens += Number(usage.outputTokens) || 0
    totals.totalTokens += Number(usage.totalTokens) || 0
    totals.costUsd += Number(usage.costUsd) || 0
    totals.reasoningTokens += Number(usage.reasoningTokens) || 0
}

const REPORT_DETAIL_MAX_VALUE_CHARS = 220

/**
 * The identifying and assessment detail block that leads an FCA, ahead of section 1.
 *
 * Composed here rather than written by a model: every value is already known to the practice, and a
 * model restating an NDIS number or date of birth is how a report ends up disagreeing with the plan
 * it cites. A row is dropped when no value was supplied, so the table never carries a placeholder.
 */
function buildReportDetailsRows({ participantIdentity, builderFormData, patientName, practiceName }) {
    const identity = participantIdentity && typeof participantIdentity === 'object' && !Array.isArray(participantIdentity)
        ? participantIdentity
        : {}
    const form = builderFormData && typeof builderFormData === 'object' && !Array.isArray(builderFormData)
        ? builderFormData
        : {}
    const clip = (value) => {
        const text = String(value || '').replace(/\s+/g, ' ').trim()
        return text.length > REPORT_DETAIL_MAX_VALUE_CHARS
            ? `${text.slice(0, REPORT_DETAIL_MAX_VALUE_CHARS).trimEnd()}…`
            : text
    }

    return [
        { label: 'Participant', value: identity.participantName || patientName },
        { label: 'NDIS participant number', value: identity.ndisNumber },
        { label: 'Date of birth', value: identity.dateOfBirth },
        { label: 'Address', value: identity.address },
        { label: 'Primary disability', value: form.diagnosisSummary },
        { label: 'Support coordinator', value: form.supportCoordinator },
        { label: 'Assessment dates', value: form.appointmentHistory },
        { label: 'Assessing occupational therapy service', value: practiceName },
    ]
        .map((row) => ({ label: row.label, value: clip(row.value) }))
        .filter((row) => row.value)
}

/** Render the detail rows as a two-column table; an empty table is omitted entirely. */
function buildReportDetailsTable(detailsRows) {
    const body = (Array.isArray(detailsRows) ? detailsRows : [])
        // A pipe inside a value would split the cell in the markdown table and in the DOCX reader.
        .map((row) => ({
            label: String(row?.label || '').replace(/\|/g, '/').trim(),
            value: String(row?.value || '').replace(/\|/g, '/').trim(),
        }))
        .filter((row) => row.label && row.value)
        .map((row) => `| ${row.label} | ${row.value} |`)

    if (body.length === 0) return ''
    return ['| Item | Detail |', '| --- | --- |', ...body].join('\n')
}

export function composeReport({ patientName, domain, practiceName, jobId, detailsRows, sectionDrafts }) {
    // Reports name the practice, never the domain key it is stored under.
    const practice = String(practiceName || '').trim() || String(domain || '').trim() || 'unknown'
    const header = [
        '# Functional Capacity Assessment (Draft)',
        '',
        `Participant: ${String(patientName || '').trim() || 'Unknown'}`,
        `Practice: ${practice}`,
        '',
    ]

    const detailsTable = buildReportDetailsTable(detailsRows)

    const sectionBlocks = sectionDrafts.map((item, index) => {
        const content = String(item.content || '').trim()
        const formattedContent = item.id === FCA_EXECUTIVE_SUMMARY_SECTION.id
            ? formatExecutiveSummaryRecommendation(content)
            : content
        return [`## ${index + 1}. ${item.title}`, '', formattedContent, ''].join('\n')
    })

    return [
        ...header,
        ...(detailsTable ? [detailsTable, ''] : []),
        ...sectionBlocks,
    ].join('\n')
}

/** A paragraph that is only the recommendation label, as a heading or a bold run. */
const RECOMMENDATION_LABEL_ONLY = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*Recommendation\s*(?:\*\*|__)?\s*:?\s*$/i

/** A paragraph that opens with the recommendation label and carries the recommendation itself. */
const RECOMMENDATION_LABEL_LEADING = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*Recommendation\b/i

/**
 * Render the executive summary's recommendation as a callout.
 *
 * Models label the recommendation in three shapes - `**Recommendation**` on its own paragraph,
 * `### Recommendation` as a heading, or `**Recommendation:** ...` inline - and only the first used to
 * be recognised, so a summary could quietly lose the one block the NDIA planner is meant to read
 * first. A heading-only label is merged with the paragraph beneath it rather than boxed on its own.
 *
 * The box is the solid navy `[!recommendation]` treatment, the same one the reference report gives
 * the funding request, so the planner sees the request and the opinion that follows it in the same
 * visual weight.
 */
function formatExecutiveSummaryRecommendation(content) {
    const source = String(content || '')
    const paragraphs = source.split(/\n\s*\n/)
    const firstIndex = paragraphs.findIndex((paragraph) => paragraph.trim())
    if (firstIndex === -1) return source

    const firstParagraph = paragraphs[firstIndex].trim()
    if (!RECOMMENDATION_LABEL_LEADING.test(firstParagraph)) return source

    const stripHeadingMarks = (value) => String(value || '')
        .split('\n')
        .map((line) => line.replace(/^#{1,6}\s*/, '').trim())
        .filter(Boolean)
        .join('\n\n')

    let blockParagraphs
    if (RECOMMENDATION_LABEL_ONLY.test(firstParagraph)) {
        const nextIndex = paragraphs.findIndex((paragraph, index) => index > firstIndex && paragraph.trim())
        const body = nextIndex === -1 ? '' : stripHeadingMarks(paragraphs[nextIndex])
        if (nextIndex !== -1) paragraphs.splice(nextIndex, 1)
        blockParagraphs = body ? ['**Recommendation**', body] : ['**Recommendation**']
    } else {
        blockParagraphs = [stripHeadingMarks(firstParagraph)]
    }

    paragraphs[firstIndex] = blockParagraphs
        .map((paragraph, paragraphIndex) => paragraph
            .split('\n')
            .map((line, lineIndex) => {
                if (!line.trim()) return '>'
                const marker = paragraphIndex === 0 && lineIndex === 0 ? '[!recommendation] ' : ''
                return `> ${marker}${line}`
            })
            .join('\n'))
        .join('\n>\n')

    return paragraphs.join('\n\n')
}

function restoreFcaIdentityReferences(markdown, identity) {
    const fullName = String(identity?.participantName || '').trim()
    if (!fullName) return markdown

    const participantName = fullName.split(/\s+/)[0]
    let restored = String(markdown || '')
    const people = Array.isArray(identity.people) ? identity.people : []

    for (const person of people) {
        const roleMatch = /^participant['’]s\s+(.+)$/i.exec(String(person?.role || '').trim())
        const personName = String(person?.name || '').trim()
        if (!roleMatch || !personName) continue

        const relationship = roleMatch[1].toLowerCase()
        const aliases = ['wife', 'husband', 'spouse', 'partner'].includes(relationship)
            ? ['wife', 'husband', 'spouse', 'partner']
            : [relationship]
        const relationshipPattern = aliases.map(escapeRegExp).join('|')
        const rolePhrase = `(?:the\\s+)?participant['’]s\\s+(?:${relationshipPattern})`
        const subjectReference = `(?:the\\s+participant|${escapeRegExp(participantName)}|his|her|their)(?:['’]s)?\\s+(?:the\\s+)?(?:${relationshipPattern})`
        const duplicatedReference = new RegExp(
            `\\b${subjectReference}\\s+${rolePhrase}\\b`,
            'gi'
        )
        const participantReference = new RegExp(
            `\\b(?:the\\s+participant|${escapeRegExp(participantName)})(?:['’]s)?\\s+(?:the\\s+)?(?:${relationshipPattern})\\b`,
            'gi'
        )
        const genericReference = new RegExp(
            `\\b(?:(?:the|his|her|their)\\s+)?(?:${relationshipPattern})\\b`,
            'gi'
        )

        restored = restored
            .replace(duplicatedReference, personName)
            .replace(participantReference, personName)
            .replace(genericReference, personName)
    }

    return restoreIdentityInText(restored, { ...identity, participantName })
}

function extractSectionWordCount(markdown, title) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sectionPattern = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escapedTitle}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'im')
    const match = markdown.match(sectionPattern)
    if (!match) return 0
    return wordCount(match[1] || '')
}

function runFcaQa({ markdown, blueprint, promptConfig, style }) {
    const findings = []

    for (const section of blueprint) {
        const escapedTitle = section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const hasHeading = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${escapedTitle}\\s*$`, 'im').test(markdown)
        if (!hasHeading) {
            findings.push({ severity: 'high', code: 'missing-section', sectionId: section.id, message: `Missing section: ${section.title}` })
            continue
        }

        const minWords = resolveFcaSectionMinWords(section, promptConfig, style)
        const count = extractSectionWordCount(markdown, section.title)
        if (count < minWords) {
            findings.push({
                severity: 'medium',
                code: 'short-section',
                sectionId: section.id,
                message: `Section below target length (${count}/${minWords} words): ${section.title}`,
            })
        }
    }

    if (/\{\{[^}]+\}\}/.test(markdown)) {
        findings.push({ severity: 'high', code: 'unresolved-placeholder', message: 'Unresolved placeholder tokens detected in report output.' })
    }

    const normalizedLines = markdown
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 40)
    const lineCount = new Map()
    for (const line of normalizedLines) {
        const key = line.toLowerCase()
        lineCount.set(key, (lineCount.get(key) || 0) + 1)
    }
    const repeated = [...lineCount.entries()].filter(([, count]) => count >= 3)
    if (repeated.length > 0) {
        findings.push({ severity: 'low', code: 'repetition', message: 'Potential repetitive wording detected across sections.' })
    }

    const pass = findings.filter((item) => item.severity === 'high').length === 0
    return { pass, findings }
}

function normalizeBuilderFormData(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw
}

export function isFcaReportType(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized.includes('functional-capacity')
        || normalized.includes('fca')
        || normalized.includes('ndis-functional-capacity-assessment')
}

export function extractBuilderFormData(metadata) {
    const source = metadata && typeof metadata === 'object' ? metadata : {}
    const candidates = [
        source?.builderState?.ndisFca?.formData,
        source?.metadata?.builderState?.ndisFca?.formData,
        source?.reportBuilder?.ndisFca?.formData,
    ]

    for (const candidate of candidates) {
        const normalized = normalizeBuilderFormData(candidate)
        if (normalized) return normalized
    }

    return null
}

// The builder sends the participant's identifying values (name, date of birth, NDIS number, address,
// phone, emails, and the people around them with their roles) alongside the form data. They are not
// report evidence: they exist so free text can be de-identified before it reaches a model, and so the
// real details can be restored when the report is rendered.
export function resolveParticipantIdentity(builderFormData) {
    const identity = builderFormData?.participantIdentity
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null
    // An FCA is an NDIS artefact: the section writers are instructed to say "the participant", so
    // the noun is pinned here rather than inferred from whatever funding field the record carries.
    return { ...identity, subjectNoun: 'participant' }
}

function hasIdentityValues(identity) {
    if (!identity) return false
    return Boolean(
        String(identity.participantName || '').trim()
        || String(identity.dateOfBirth || '').trim()
        || String(identity.ndisNumber || '').trim()
        || String(identity.address || '').trim()
        || String(identity.phone || '').trim()
        || (Array.isArray(identity.emails) && identity.emails.length > 0)
        || (Array.isArray(identity.people) && identity.people.length > 0)
    )
}

/** The sections to map evidence for: an explicit list, or the full report including its summary. */
function resolveEvidenceSections(sections) {
    return Array.isArray(sections) && sections.length > 0 ? sections : FCA_REPORT_SECTIONS
}

export function buildFcaEvidenceMap({ notes, transcripts, additionalContext, builderFormData, sections, analysisEvidence, analystCapturedDocumentIds, style }) {
    const participantIdentity = resolveParticipantIdentity(builderFormData)
    const corpus = buildCorpus({
        notes,
        transcripts,
        additionalContext,
        builderFormData,
        participantIdentity,
        analysisEvidence,
        analystCapturedDocumentIds,
    })
    const profileTags = inferProfileTags(corpus.text)
    const sentenceLimit = resolveEvidenceLineLimit(style)
    const bySection = {}
    const reportSections = resolveEvidenceSections(sections)
    const sentenceOwners = assignEvidenceSentencesToSections(
        corpus.sentences,
        reportSections.filter((section) => section.role !== 'executive-summary')
    )

    for (const section of reportSections) {
        const excludedSentences = section.role === 'executive-summary'
            ? new Set()
            : new Set([...sentenceOwners.entries()]
                .filter(([, owner]) => owner !== section.id)
                .map(([sentence]) => sentence))
        const evidence = collectEvidenceForSection(section, corpus, sentenceLimit, excludedSentences)
        bySection[section.id] = evidence
    }

    return {
        profileTags,
        bySection,
        sourceTextLength: corpus.text.length,
        sourceSentenceCount: corpus.sentences.length,
        transcriptEvidenceSource: corpus.transcriptEvidenceSource,
        // True when the report was built from de-identified (rather than raw) text. The heuristic
        // writer and the OpenAI writer both consume the sanitised corpus.
        deidentified: hasIdentityValues(participantIdentity),
    }
}

export async function generateFcaReportDraft({
    patientName,
    domain,
    practiceName,
    notes,
    transcripts,
    additionalContext,
    builderFormData,
    analysisEvidence,
    model,
    provider,
    baseUrl,
    hasApiKey,
    apiKey,
    jobId,
    reportTypeConfig,
}) {
    const style = resolveFcaStyleForReport(builderFormData)
    const steeringNotes = resolveFcaSteeringNotes(builderFormData)
    const promptConfig = reportTypeConfig?.fcaPromptConfig
    // A document whose recorded specifics the analysis captured is represented in the corpus by that
    // finding, so its raw text is dropped rather than counted twice. A document the analyst merely
    // read - findings but no recorded detail - keeps its text: dropping it would lose the measures
    // and equipment lists the report cannot reconstruct.
    const analystCapturedDocumentIds = analysisEvidence ? resolveAnalystCapturedDocumentIds(analysisEvidence) : []
    const evidenceMap = buildFcaEvidenceMap({
        notes,
        transcripts,
        additionalContext,
        builderFormData,
        analysisEvidence,
        analystCapturedDocumentIds,
        style,
    })
    const resolvedApiKey = String(apiKey || resolveChatApiKey({ provider, model })).trim()
    const useModel = shouldUseModelAdapter({ provider, apiKey: resolvedApiKey })
    const providerLabel = resolveChatProviderLabel({ provider, model })
    // The model sees only de-identified role phrases. The participant and known family names are
    // restored locally after composition; none are disclosed to the model.
    const participantIdentity = resolveParticipantIdentity(builderFormData)
    const identityKnown = hasIdentityValues(participantIdentity)
    // Reference guidance frames every section. It stays out of the evidence corpus on purpose
    // (buildCorpus never sees it), so its sentences can never be selected as observed evidence.
    // The built-in NDIS text is authored here and carries no participant detail, so it is sent
    // verbatim; only a configured override goes through de-identification.
    const referenceGuidanceText = resolveFcaReferenceGuidance(promptConfig?.referenceGuidance)
    const referenceGuidanceForPrompt = !referenceGuidanceText
        ? ''
        : referenceGuidanceText === FCA_REFERENCE_GUIDANCE_TEXT
            ? referenceGuidanceText
            : deidentifyLlmText(referenceGuidanceText, { participantIdentity, patientName })

    const sectionDraftsById = new Map()
    const sectionDiagnostics = []
    const usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, reasoningTokens: 0, calls: 0 }

    const writeSection = async ({ section, evidenceLines, sectionDigests }) => {
        const snippets = selectManifestSnippets({ sectionId: section.id, profileTags: evidenceMap.profileTags })
        // Applied here rather than in the corpus so both writers - model and heuristic - quote the
        // practice by name.
        const practiceEvidenceLines = (Array.isArray(evidenceLines) ? evidenceLines : [])
            .map((line) => replaceDomainKeyWithPracticeName(line, domain, practiceName))

        let content = ''
        let adapter = 'heuristic'
        let adapterError = null

        if (useModel) {
            try {
                const generated = await generateSectionWithModel({
                    section,
                    patientName,
                    participantIdentity,
                    domain,
                    practiceName,
                    evidenceLines: practiceEvidenceLines,
                    snippets,
                    referenceGuidanceText: referenceGuidanceForPrompt,
                    model,
                    baseUrl,
                    apiKey: resolvedApiKey,
                    provider: providerLabel,
                    promptConfig,
                    style,
                    steeringNotes,
                })
                content = generated.content
                // Accumulated per section so a report's real spend is knowable even though each
                // section is its own request.
                accumulateUsage(usageTotals, generated.usage)
                adapter = providerLabel
            } catch (error) {
                adapterError = String(error?.message || 'Section generation failed')
            }
        }

        if (!content) {
            content = buildHeuristicSection({
                section,
                evidenceLines: practiceEvidenceLines,
                sectionDigests,
            })
        }

        sectionDraftsById.set(section.id, { id: section.id, title: section.title, content })
        sectionDiagnostics.push({
            sectionId: section.id,
            adapter,
            evidenceLines: practiceEvidenceLines.length,
            snippetCount: snippets.length,
            error: adapterError,
            words: wordCount(content),
        })
    }

    for (const section of FCA_REPORT_BLUEPRINT) {
        await writeSection({ section, evidenceLines: evidenceMap.bySection[section.id] || [] })
    }

    // The executive summary is written last so it digests the sections that were just produced
    // rather than the raw notes, then placed first by the composed report.
    const summaryDigests = FCA_REPORT_BLUEPRINT
        .map((section) => {
            const content = String(sectionDraftsById.get(section.id)?.content || '')
            if (content.startsWith('No section-specific evidence was selected')) return ''
            const text = firstSentences(content)
            return text ? `${section.title}: ${text}` : ''
        })
        .filter(Boolean)
    const summaryEvidence = summaryDigests.length > 0
        ? summaryDigests
        : (evidenceMap.bySection[FCA_EXECUTIVE_SUMMARY_SECTION.id] || [])

    // Scores, hours and measured counts travel to the summary directly rather than only through the
    // opening of each body section, so the planner who reads nothing else still sees them.
    const keyFacts = extractExecutiveSummaryKeyFacts(sectionDraftsById)

    await writeSection({
        section: FCA_EXECUTIVE_SUMMARY_SECTION,
        evidenceLines: [...keyFacts, ...summaryEvidence],
        sectionDigests: summaryDigests,
    })

    const sectionDrafts = FCA_REPORT_SECTIONS
        .map((section) => sectionDraftsById.get(section.id))
        .filter(Boolean)

    const composedMarkdown = composeReport({
        patientName,
        domain,
        practiceName,
        jobId,
        detailsRows: buildReportDetailsRows({
            participantIdentity,
            builderFormData,
            patientName,
            practiceName,
        }),
        sectionDrafts,
    })
    const markdown = restoreFcaIdentityReferences(composedMarkdown, participantIdentity)
    const qa = runFcaQa({ markdown, blueprint: FCA_REPORT_SECTIONS, promptConfig, style })

    return {
        markdown,
        meta: {
            blueprintVersion: 1,
            manifestVersion: Number(FCA_LANGUAGE_MANIFEST.version || 0),
            adapter: useModel ? `${providerLabel}-with-heuristic-fallback` : 'heuristic-only',
            sectionDiagnostics,
            profileTags: evidenceMap.profileTags,
            sourceSentenceCount: evidenceMap.sourceSentenceCount,
            sourceTextLength: evidenceMap.sourceTextLength,
            transcriptEvidenceSource: evidenceMap.transcriptEvidenceSource,
            // Which analyst evidence the corpus led with, and which attachments it replaced. Without
            // this, "why does this section read like that" is unanswerable from the report alone.
            analystEvidence: {
                used: Boolean(analysisEvidence),
                factCount: Array.isArray(analysisEvidence?.structuredEvidenceFacts)
                    ? analysisEvidence.structuredEvidenceFacts.length
                    : 0,
                analysisGeneratedAt: String(analysisEvidence?.generatedAt || '').trim() || null,
                suppressedDocumentIds: analystCapturedDocumentIds,
            },
            // Which shape the report was written to, and whether the clinician steered emphasis.
            reportStyle: {
                id: style.id,
                label: style.label,
                bodyWordMultiplier: style.bodyWordMultiplier,
                summaryMinWords: style.summaryMinWords,
            },
            steeringNotesSupplied: Boolean(steeringNotes),
            // Which official material framed the sections, and how much of it was sent. The text
            // itself is static, so only the provenance and size are carried in the report metadata.
            referenceGuidance: {
                sources: referenceGuidanceForPrompt ? FCA_REFERENCE_SOURCES.map((item) => item.url) : [],
                characters: referenceGuidanceForPrompt.length,
                isDefaultNdisGuidance: referenceGuidanceForPrompt === FCA_REFERENCE_GUIDANCE_TEXT,
            },
            // De-identification happened, and the glossary records the identity block used for
            // local name restoration.
            deidentified: evidenceMap.deidentified,
            identityGlossary: identityKnown ? participantIdentity : null,
            qa,
            // Real per-report spend. The job row used to be priced from the length of the notes and
            // the finished markdown, which cannot see reasoning tokens.
            usage: usageTotals.calls > 0 ? usageTotals : null,
        },
    }
}
