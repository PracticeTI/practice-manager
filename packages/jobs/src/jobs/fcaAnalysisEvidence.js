// FCA Analyst evidence engine.
//
// The analyst used to be a keyword catalog over notes + transcript summaries: it could only
// surface which of nine canned interventions a patient matched. The FCA report needs
// report-grade evidence instead - the same domain-tagged findings the transcript summariser
// already produces (`fca-functional-capacity` style), but covering the whole patient rather
// than one consultation.
//
// So this module asks the model for findings labelled with `FCA_REPORT_BLUEPRINT` section ids.
// Reusing the blueprint ids (and the fact shape) is deliberate: the FCA worker already knows how
// to consume `{ domain, observedIssue, functionalImpact, supportImplication }`, and the ids let
// the report place each finding in the right section without a second vocabulary.
//
// There is no heuristic path. The analyst's whole value is evidence quality, so an unavailable
// model is an error to surface, not something to paper over with keyword matching.

import { FCA_REPORT_BLUEPRINT } from './fcaReportGeneration.js'
import { EGRESS_CHANNEL_ANALYSIS, guardOutgoingChat } from '../privacy/index.js'
import { requestChatCompletion, resolveChatApiKey, isUnsupportedChatProvider } from './chatModelRequest.js'

/** Source caps. The analyst must see the whole record - a trimmed corpus is what we are fixing. */
export const FCA_ANALYSIS_NOTES_CHARS = 120000
export const FCA_ANALYSIS_TRANSCRIPT_CHARS = 120000

/**
 * Combined cap for the reference documents in scope (letters, discharge summaries, assessments).
 *
 * Larger per document than the report's own attachment cap, because the point of routing a
 * document through the analyst is that it gets read in full rather than tail-truncated at report
 * time.
 */
export const FCA_ANALYSIS_DOCUMENT_CHARS = 120000

/** Per-fact caps. Long enough to carry clinical detail, short enough to stay scannable. */
export const FCA_ANALYSIS_FACT_TEXT_CHARS = 400
export const FCA_ANALYSIS_JUSTIFICATION_CHARS = 600
export const FCA_ANALYSIS_SUMMARY_CHARS = 1600

/**
 * Cap for a fact's recorded specifics.
 *
 * Separate from the finding's own prose because it is not prose: it is the measures, scores, dates
 * and equipment a source records, kept so a report can cite them even when the source document is
 * not attached to it.
 */
export const FCA_ANALYSIS_DETAIL_CHARS = 600

/** How many findings are kept. A section with 30 findings is noise, not evidence. */
export const FCA_ANALYSIS_MAX_FACTS_PER_SECTION = 8
export const FCA_ANALYSIS_MAX_FACTS = 80

/** Findings whose label is not a report section land here; the report ignores them by section. */
export const FCA_ANALYSIS_GENERAL_DOMAIN = 'general'

/** Every section the report expects evidence for, in report order. */
export const FCA_ANALYSIS_SECTIONS = FCA_REPORT_BLUEPRINT.map((section) => ({
    id: String(section.id || '').trim(),
    title: String(section.title || '').trim(),
}))

const SECTION_IDS = new Set(FCA_ANALYSIS_SECTIONS.map((section) => section.id))

const SECTION_TITLE_BY_ID = new Map(FCA_ANALYSIS_SECTIONS.map((section) => [section.id, section.title]))

/**
 * Loose labels the model may reach for, mapped onto report sections.
 *
 * The transcript summariser asks for section ids, but a model writing about "mobility" or
 * "fatigue" naturally labels the finding with the functional area. Mapping those onto the
 * section they evidence keeps them usable instead of dumping them into `general`.
 */
const DOMAIN_ALIASES = {
    // Functional areas -> the section that discusses them.
    mobility: 'current-functioning',
    transfer: 'current-functioning',
    transfers: 'current-functioning',
    'upper-limb-function': 'current-functioning',
    'fine-motor': 'current-functioning',
    fatigue: 'current-functioning',
    pain: 'current-functioning',
    cognition: 'current-functioning',
    communication: 'current-functioning',
    swallowing: 'current-functioning',
    'domestic-function': 'domestic-community',
    'community-access': 'domestic-community',
    transport: 'domestic-community',
    'social-participation': 'domestic-community',
    adl: 'adl-personal-care',
    'personal-care': 'adl-personal-care',
    hygiene: 'adl-personal-care',
    equipment: 'assistive-technology',
    'home-modifications': 'assistive-technology',
    'environmental-supports': 'assistive-technology',
    safety: 'risk-safeguarding',
    'falls-risk': 'risk-safeguarding',
    behaviour: 'risk-safeguarding',
    supervision: 'risk-safeguarding',
    assessment: 'standardised-assessment-summary',
    measures: 'standardised-assessment-summary',
    'standardised-assessment': 'standardised-assessment-summary',
    goals: 'goals-outcomes',
    outcomes: 'goals-outcomes',
    funding: 'recommendations-funding',
    recommendations: 'recommendations-funding',
    supports: 'recommendations-funding',
    diagnosis: 'medical-background',
    history: 'medical-background',
    medical: 'medical-background',
    'living-situation': 'participant-context',
    'support-network': 'participant-context',
    'referral': 'referral-purpose',
    'planning-follow-up': 'rationale-conclusion',
    'plan-review': 'rationale-conclusion',
    'review-recommendations': 'rationale-conclusion',
}

/** The domain vocabulary offered to the model, in report order. */
export function listAnalysisEvidenceDomains() {
    return FCA_ANALYSIS_SECTIONS.map((section) => section.id)
}

/**
 * Resolve a model-supplied label to a report section id, or `general`.
 *
 * A label that already names a section wins outright; otherwise an alias is tried; otherwise the
 * finding is kept but unplaced (the report's keyword scoring still sees it, because the flat fact
 * list carries it).
 */
export function normalizeAnalysisEvidenceDomain(label) {
    const normalized = String(label || '').trim().toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

    if (!normalized) return FCA_ANALYSIS_GENERAL_DOMAIN
    if (SECTION_IDS.has(normalized)) return normalized

    const alias = DOMAIN_ALIASES[normalized]
    if (alias && SECTION_IDS.has(alias)) return alias

    return FCA_ANALYSIS_GENERAL_DOMAIN
}

function clampText(value, maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function truncateSource(value, maxLength) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim()
    if (text.length <= maxLength) return text

    // Cut on a line boundary where possible so the model does not read half a sentence.
    const slice = text.slice(0, maxLength)
    const lastBreak = slice.lastIndexOf('\n')
    const trimmed = lastBreak > maxLength * 0.6 ? slice.slice(0, lastBreak) : slice
    return `${trimmed}\n\n[source truncated at ${maxLength} of ${text.length} characters]`
}

const ANALYSIS_EVIDENCE_SYSTEM_PROMPT = [
    'You are an occupational therapist extracting functional capacity evidence from a patient record for an NDIS Functional Capacity Assessment.',
    'Use only what the notes, transcript evidence and reference documents state or clearly demonstrate. Never invent diagnoses, dates, scores, medications, hours, equipment, incidents, or services.',
    'A reference document that argues for funding is evidence of the facts it records, not of its conclusions, requests or persuasive framing.',
    'Write in professional Australian clinical English, third person, referring to the person as "the participant".',
    'Never write a person\'s name, address, phone number, email, or an NDIS or claim number.',
    'Return valid JSON only.',
].join(' ')

const ANALYSIS_FACT_RULES = [
    'Rules for facts:',
    '- Return one fact per distinct finding. Never emit two facts for the same finding.',
    '- domain: use exactly one of these section ids: {{DOMAINS}}.',
    '- observedIssue: what the participant reported or the clinician observed, in one specific clinical sentence. Keep the concrete detail (which task, which aid, what triggers it).',
    '- functionalImpact: how this limits performance of a specific everyday task.',
    '- supportImplication: the concrete support, equipment, or funding implication that follows from this finding. Be specific to the finding.',
    '- evidenceDetail: the specifics a source records for this finding, quoted faithfully - measures and scores with their totals, dates, equipment and aids, support hours. Leave it empty when the source records none. Never restate the finding here.',
    '- source: "notes", "transcript" or "document" - where the finding came from. When more than one source states the same thing, prefer "notes". For a document-sourced fact, also set "sourceName" to that document\'s file name.',
    '- Never use filler such as "Consider support planning that addresses reliability, safety, and participation barriers in this domain."',
    '- Skip anything the record does not support. Fewer, well-evidenced facts are better than padding.',
    '- Cover the record broadly: aim for findings across several different domains rather than many findings in one.',
    '- When the record contains standardised measures (FIM, WHODAS, Barthel, Lawton IADL, Care and Needs Scale), emit a finding for "standardised-assessment-summary" that names each measure with its total and, where the record gives them, its domain or item scores. Name only measures the record actually contains.',
].join('\n')

/**
 * Reference documents are argument as often as they are observation.
 *
 * A Letter of Support is written to obtain funding, so its severity claims and its conclusions are
 * not findings about the participant. Its measurements, observations and equipment lists are. The
 * analyst's facts lead the report corpus once the report reads them, which makes an unlabelled
 * document a worse source than no document at all.
 */
const ANALYSIS_DOCUMENT_RULES = [
    'Rules for reference documents:',
    '- Each document is labelled with its file name and is included as evidence of the participant\'s function.',
    '- Extract only what a document records: measures and scores, functional observations, aids and equipment, diagnoses, and dates.',
    '- Never treat a document\'s conclusions, requests or persuasive framing - "reasonable and necessary", "good value", "I request an increase", "should be funded" - as findings about the participant.',
    '- Do not turn a document\'s funding request into a recommended intervention. Recommendations follow from the functional evidence, not from what a document asks for.',
].join('\n')

const ANALYSIS_INTERVENTION_RULES = [
    'Rules for interventions:',
    '- recommendedInterventions: new or increased supports. Return {{MIN_RECOMMENDED}} to {{MAX_RECOMMENDED}} items, each with a non-empty intervention and a justification.',
    '- addressedInterventions: supports already in place. Return up to {{MAX_ADDRESSED}} items, each with a non-empty intervention and a justification. Only include one the record shows is actually in place.',
    '- sources: the sources that state the support, one or more of "notes", "transcript", "document". Unlike a fact, a support can be evidenced by several sources at once - list every source that states it. Add "sourceNames" with the file names of the documents when "document" is included. Never list a source the support does not come from.',
    '- Do not emit any other recommendation or support list.',
    '- The justification must cite the functional finding that drives it, not restate the support.',
].join('\n')

const ANALYSIS_SUMMARY_RULES = [
    'Rules for summaryText:',
    '- One clinical paragraph of 80-160 words covering the participant\'s functional profile, the main functional impacts, the risks identified, and the level of support the evidence indicates.',
    '- Prose only, no bullets, no headings, no first person.',
].join('\n')

/** The system prompt, optionally extended by the domain's configured analyst focus. */
export function buildAnalysisEvidenceSystemPrompt({ workerPrompt, additionalInstructions } = {}) {
    const configured = [String(workerPrompt || '').trim(), String(additionalInstructions || '').trim()]
        .filter(Boolean)
        .join(' ')

    return [ANALYSIS_EVIDENCE_SYSTEM_PROMPT, configured || null].filter(Boolean).join(' ')
}

/**
 * The user prompt: the whole record, the domain vocabulary, and the response contract.
 *
 * `notes` and `transcriptEvidence` are separate so the model can tell the clinician's own record
 * apart from the consultation digests, which are already paraphrased.
 */
export function buildAnalysisEvidenceUserPrompt({
    subjectNoun = 'participant',
    notes,
    transcriptEvidence,
    evidenceDocuments,
    recommendationBounds,
    addressedBounds,
} = {}) {
    const minRecommended = Number.isFinite(Number(recommendationBounds?.minRecommendedInterventions))
        ? Number(recommendationBounds.minRecommendedInterventions)
        : 0
    const maxRecommended = Number.isFinite(Number(recommendationBounds?.maxRecommendedInterventions))
        ? Number(recommendationBounds.maxRecommendedInterventions)
        : 50
    const maxAddressed = Number.isFinite(Number(addressedBounds?.maxAddressedInterventions))
        ? Number(addressedBounds.maxAddressedInterventions)
        : 50

    const contract = 'Return JSON of the form {"summaryText": "...", "facts": [{"domain": "...", "observedIssue": "...", "functionalImpact": "...", "supportImplication": "...", "evidenceDetail": "...", "source": "notes"}], "recommendedInterventions": [{"intervention": "...", "justification": "...", "sources": ["notes"]}], "addressedInterventions": [{"intervention": "...", "justification": "...", "sources": ["notes"]}]}.'

    const ruleBlocks = [
        ANALYSIS_FACT_RULES.replace('{{DOMAINS}}', listAnalysisEvidenceDomains().join(', ')),
        ANALYSIS_INTERVENTION_RULES
            .replace('{{MIN_RECOMMENDED}}', String(minRecommended))
            .replace('{{MAX_RECOMMENDED}}', String(maxRecommended))
            .replace('{{MAX_ADDRESSED}}', String(maxAddressed)),
        ANALYSIS_SUMMARY_RULES,
    ]

    const notesBlock = truncateSource(notes, FCA_ANALYSIS_NOTES_CHARS)
    const transcriptBlock = truncateSource(transcriptEvidence, FCA_ANALYSIS_TRANSCRIPT_CHARS)
    const documentBlock = truncateSource(buildDocumentEvidenceBlock(evidenceDocuments), FCA_ANALYSIS_DOCUMENT_CHARS)

    // The document rules are only sent when documents are actually in scope, so a record with none
    // is not told about a source it does not have.
    if (documentBlock) ruleBlocks.push(ANALYSIS_DOCUMENT_RULES)

    return [
        `Extract the functional capacity evidence from the record of the ${subjectNoun}.`,
        `Refer to the person only as "the ${subjectNoun}".`,
        '',
        contract,
        '',
        ...ruleBlocks,
        '',
        'Patient notes:',
        notesBlock || 'No patient notes are available.',
        '',
        'Consultation transcript evidence:',
        transcriptBlock || 'No transcript evidence is available.',
        ...(documentBlock
            ? ['', 'Reference documents in scope (extract their recorded facts only):', documentBlock]
            : []),
    ].join('\n').trim()
}

/**
 * Accept the in-scope documents as they travel on the job payload.
 *
 * The text is extracted and capped by the caller (`one` owns the DOCX reader), so this only
 * enforces the shape the prompt relies on - a file name and non-empty text - and drops anything
 * else rather than letting a malformed entry reach the model.
 */
export function normalizeEvidenceDocuments(value) {
    const documents = []
    for (const item of Array.isArray(value) ? value : []) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const text = String(item.text || '').trim()
        if (!text) continue
        const id = Number.parseInt(String(item.id ?? ''), 10)

        documents.push({
            id: Number.isFinite(id) ? id : null,
            fileName: String(item.fileName || 'Reference document').trim() || 'Reference document',
            text,
            truncated: item.truncated === true,
        })
    }
    return documents
}

/**
 * Label each in-scope document so the model can cite it, and so a fact can say which one it came
 * from. Unreadable documents are dropped upstream and never reach here.
 */function buildDocumentEvidenceBlock(evidenceDocuments) {
    const blocks = []
    for (const document of Array.isArray(evidenceDocuments) ? evidenceDocuments : []) {
        if (!document || typeof document !== 'object') continue
        const text = String(document.text || '').trim()
        if (!text) continue
        const name = String(document.fileName || 'Reference document').trim() || 'Reference document'
        blocks.push(`--- Document: ${name} ---\n${text}`)
    }
    return blocks.join('\n\n')
}

const FACT_SOURCES = new Set(['notes', 'transcript', 'document'])

/** Display order for provenance: the clinician's own record first, then the consultation digest. */
const SOURCE_ORDER = ['notes', 'transcript', 'document']
const SOURCE_RANK = new Map(SOURCE_ORDER.map((source, index) => [source, index]))

/** How many document names a single support may cite. */
const MAX_INTERVENTION_SOURCE_NAMES = 5

function normalizeFactSource(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return FACT_SOURCES.has(normalized) ? normalized : ''
}

/** A model may answer with a string or an array for either key; accept both. */
function readSourceList(value) {
    if (Array.isArray(value)) return value
    if (value === null || value === undefined) return []
    return [value]
}

/**
 * The sources a support came from, ordered and deduped.
 *
 * A fact names a single `source`, but a support is frequently stated by more than one place (the
 * notes and the consultation, or the notes and a letter), so supports carry `sources`. A model that
 * answers with the singular key is understood rather than discarded, and an unrecognised value is
 * dropped so a consumer can rely on what it is told.
 */
function normalizeInterventionSources(item) {
    const kinds = []
    for (const candidate of [...readSourceList(item?.sources), ...readSourceList(item?.source)]) {
        const kind = normalizeFactSource(candidate)
        if (kind && !kinds.includes(kind)) kinds.push(kind)
    }
    kinds.sort((left, right) => SOURCE_RANK.get(left) - SOURCE_RANK.get(right))

    if (!kinds.includes('document')) return { sources: kinds, sourceNames: [] }

    const names = []
    const seenNames = new Set()
    for (const candidate of [...readSourceList(item?.sourceNames), ...readSourceList(item?.sourceName)]) {
        const name = clampText(candidate, 160)
        if (!name) continue
        const key = name.toLowerCase()
        if (seenNames.has(key)) continue
        seenNames.add(key)
        names.push(name)
        if (names.length >= MAX_INTERVENTION_SOURCE_NAMES) break
    }

    return { sources: kinds, sourceNames: names }
}

function normalizeFact(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null

    const observedIssue = clampText(item.observedIssue, FCA_ANALYSIS_FACT_TEXT_CHARS)
    if (!observedIssue) return null

    const fact = {
        domain: normalizeAnalysisEvidenceDomain(item.domain),
        observedIssue,
        functionalImpact: clampText(item.functionalImpact, FCA_ANALYSIS_FACT_TEXT_CHARS),
        supportImplication: clampText(item.supportImplication, FCA_ANALYSIS_FACT_TEXT_CHARS),
    }

    // Recorded specifics travel with their finding. They are the reason a document can stay out of
    // the report's attachment list without the report losing its measures and equipment.
    const evidenceDetail = clampText(item.evidenceDetail, FCA_ANALYSIS_DETAIL_CHARS)
    if (evidenceDetail) fact.evidenceDetail = evidenceDetail

    // Provenance is optional: an unlabelled source is dropped rather than guessed at, so a consumer
    // can rely on `source` meaning exactly what it says.
    const source = normalizeFactSource(item.source)
    if (source) fact.source = source
    if (source === 'document') {
        const sourceName = clampText(item.sourceName, 160)
        if (sourceName) fact.sourceName = sourceName
    }

    return fact
}

function normalizeInterventions(raw, max) {
    const items = Array.isArray(raw) ? raw : []
    const out = []
    const seen = new Set()

    for (const item of items) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const intervention = clampText(item.intervention, 200)
        if (!intervention) continue
        const key = intervention.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        const provenance = normalizeInterventionSources(item)
        const entry = {
            intervention,
            justification: clampText(item.justification, FCA_ANALYSIS_JUSTIFICATION_CHARS),
        }
        // Absent when the model could not say where the support came from - the app shows nothing
        // rather than guessing a source on its behalf.
        if (provenance.sources.length > 0) entry.sources = provenance.sources
        if (provenance.sourceNames.length > 0) entry.sourceNames = provenance.sourceNames

        out.push(entry)
        if (out.length >= max) break
    }

    return out
}

/**
 * Normalise a model response into the analyst payload.
 *
 * Facts are returned flat (`structuredEvidenceFacts`, the shape the report already consumes) and
 * grouped by section (`sectionEvidence`). A fact whose label is not a report section is kept in
 * the flat list but not grouped, so nothing is silently dropped.
 */
export function normalizeAnalysisEvidencePayload(raw, { recommendationBounds, addressedBounds } = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const rawFacts = Array.isArray(source.facts) ? source.facts : []

    const facts = []
    const sectionEvidence = {}
    const perSectionCount = new Map()

    for (const item of rawFacts) {
        if (facts.length >= FCA_ANALYSIS_MAX_FACTS) break
        const fact = normalizeFact(item)
        if (!fact) continue

        // Same-section duplicates are dropped by content so the report does not score one
        // finding many times over.
        const contentKey = `${fact.domain}|${fact.observedIssue.toLowerCase()}`
        if (facts.some((existing) => `${existing.domain}|${existing.observedIssue.toLowerCase()}` === contentKey)) continue

        facts.push(fact)

        if (fact.domain === FCA_ANALYSIS_GENERAL_DOMAIN) continue
        const count = perSectionCount.get(fact.domain) || 0
        if (count >= FCA_ANALYSIS_MAX_FACTS_PER_SECTION) continue
        perSectionCount.set(fact.domain, count + 1)
        if (!sectionEvidence[fact.domain]) sectionEvidence[fact.domain] = []
        sectionEvidence[fact.domain].push(fact)
    }

    const maxRecommended = Number.isFinite(Number(recommendationBounds?.maxRecommendedInterventions))
        ? Number(recommendationBounds.maxRecommendedInterventions)
        : 50
    const maxAddressed = Number.isFinite(Number(addressedBounds?.maxAddressedInterventions))
        ? Number(addressedBounds.maxAddressedInterventions)
        : 50

    const summaryText = clampText(source.summaryText, FCA_ANALYSIS_SUMMARY_CHARS)

    return {
        summaryText,
        facts,
        sectionEvidence,
        recommendedInterventions: normalizeInterventions(source.recommendedInterventions, maxRecommended),
        addressedInterventions: normalizeInterventions(source.addressedInterventions, maxAddressed),
        sectionsCovered: Object.keys(sectionEvidence).sort(),
        domainTitles: Object.fromEntries(
            Object.keys(sectionEvidence).map((id) => [id, SECTION_TITLE_BY_ID.get(id) || id])
        ),
    }
}

/** Last-resort model. A job must never reach this - see `resolveAnalysisEvidenceModel`. */
export const FCA_ANALYSIS_FALLBACK_MODEL = 'gpt-5-mini'

/**
 * Which model the analyst runs on.
 *
 * The order matters: the model chosen on the job always wins. The env fallbacks exist so the worker
 * can run without an enqueuer that supplies one, and the last resort is a constant. When a scheduled
 * backfill ran inside this service it supplied nothing, so every analysis it produced landed on
 * `FCA_ANALYSIS_FALLBACK_MODEL` and silently ignored the operator's AI & Defaults selection.
 */
export function resolveAnalysisEvidenceModel(model) {
    return String(model || '').trim()
        || String(process.env.ANALYSIS_WORKER_AI_MODEL || '').trim()
        || String(process.env.REPORT_WORKER_AI_MODEL || '').trim()
        || FCA_ANALYSIS_FALLBACK_MODEL
}

/**
 * Call the model for the analyst evidence.
 *
 * Throws when the provider is unavailable or the model returns unusable JSON - there is no
 * heuristic fallback, so the job failing loudly is the correct outcome.
 */
export async function generateAnalysisEvidenceWithOpenAi({
    notes,
    transcriptEvidence,
    evidenceDocuments,
    identity,
    subjectNoun = 'participant',
    workerPrompt,
    additionalInstructions,
    recommendationBounds,
    addressedBounds,
    model,
    provider,
    baseUrl,
    apiKey,
    fetchImpl = fetch,
} = {}) {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    const resolvedApiKey = resolveChatApiKey({ provider: normalizedProvider, model, apiKey })

    if (!resolvedApiKey) {
        throw new Error('FCA Analyst requires an AI key: set OPENAI_API_KEY or CLAUDE_API_KEY, or configure AI & Defaults for the domain.')
    }
    if (isUnsupportedChatProvider(normalizedProvider)) {
        throw new Error(`FCA Analyst does not support the ${normalizedProvider} provider.`)
    }

    const resolvedModel = resolveAnalysisEvidenceModel(model)

    // Notes, transcripts and evidence documents are the richest source of identifiers in the
    // system, so the prompt is de-identified and verified before it is sent. A surviving
    // identifier fails the job rather than reaching the provider.
    const guarded = guardOutgoingChat(
        {
            system: buildAnalysisEvidenceSystemPrompt({ workerPrompt, additionalInstructions }),
            messages: [{
                role: 'user',
                content: buildAnalysisEvidenceUserPrompt({
                    notes,
                    transcriptEvidence,
                    evidenceDocuments,
                    subjectNoun,
                    recommendationBounds,
                    addressedBounds,
                }),
            }],
        },
        { identity, channel: EGRESS_CHANNEL_ANALYSIS }
    )

    const result = await requestChatCompletion({
        provider: normalizedProvider,
        model: resolvedModel,
        baseUrl,
        apiKey: resolvedApiKey,
        system: guarded.system,
        messages: guarded.messages,
        jsonMode: true,
        errorLabel: 'FCA Analyst evidence extraction failed',
        fetchImpl,
    })
    if (!result.ok) {
        throw new Error(result.error)
    }

    const content = String(result.text || '').trim()
    if (!content) {
        throw new Error('FCA Analyst evidence extraction returned empty content')
    }

    let parsed = null
    try {
        parsed = JSON.parse(content)
    } catch {
        throw new Error('FCA Analyst evidence extraction returned invalid JSON')
    }

    return {
        payload: normalizeAnalysisEvidencePayload(parsed, { recommendationBounds, addressedBounds }),
        model: resolvedModel,
    }
}
