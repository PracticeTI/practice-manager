import { createHash } from 'node:crypto'
import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensureScribeQueueTable, resolveScribeQueueTableName } from './scribeQueue.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'
import { requestChatCompletion, resolveChatApiKey, resolveChatProviderLabel, isUnsupportedChatProvider } from './chatModelRequest.js'
import {
    EGRESS_CHANNEL_TRANSCRIPT_SUMMARY,
    buildIdentityBlockFromPatient,
    guardOutgoingChat,
    resolveSubjectNoun,
} from '../privacy/index.js'

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 30
const DEFAULT_RETRY_MAX_SECONDS = 1800
const DEFAULT_STALE_PROCESSING_MINUTES = 15
const DEFAULT_SCRIBE_SUMMARIES_TABLE = 'patient_transcript_summaries'
const DEFAULT_SCRIBE_SUMMARY_STYLE = 'topic-bullets-third-person'
const OTF10_SCRIBE_SUMMARY_STYLE = 'otf10-home-services'
// FCA summaries are a report-specific style, exactly like the OTF10 one: the FCA builder
// consumes them instead of the generic summaries so the evidence arrives already shaped for
// the report sections. The style row lives alongside the others in patient_transcript_summaries
// (unique on domain + transcription_id + summary_style), so it never overwrites them.
const FCA_SCRIBE_SUMMARY_STYLE = 'fca-functional-capacity'
const DEFAULT_SCRIBE_WORKER_PROMPT = 'Summarize the completed transcript into a concise bullet-point list of conversation topics written in third person. Focus on functional impacts, symptoms, safety, supports, and agreed follow-up priorities.'
const DEFAULT_HSR_SUMMARISER_WORKER_PROMPT = 'Summarize the completed transcript for a TAC OTF10 Home Services Review. Prioritize evidence about personal care, domestic tasks, mobility, equipment, supervision, safety, and the level of home support required. Use only evidence from the transcript and do not invent findings or support needs.'
const DEFAULT_FCA_SUMMARISER_WORKER_PROMPT = 'Summarize the completed transcript for an NDIS Functional Capacity Assessment. Prioritize evidence about personal care and daily living, domestic function and community participation, assistive technology and environmental supports, and risk and safeguarding. For every finding keep the concrete task, aid, trigger, and the support it implies. Use only evidence from the transcript and do not invent findings, diagnoses, scores, or support needs.'
const PENDING_DELETE_STATUS = 'pending delete'

function isFcaSummaryStyle(style) {
    return String(style || '').trim().toLowerCase() === FCA_SCRIBE_SUMMARY_STYLE
}

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(1, Math.floor(parsed))
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function getConfig() {
    return {
        enabled: isTrue(process.env.SCRIBE_WORKER_ENABLED || 'false'),
        table: resolveScribeQueueTableName(),
        summariesTable: resolveScribeSummariesTableName(),
        batchSize: parsePositiveInt(process.env.SCRIBE_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.SCRIBE_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        defaultMaxAttempts: parsePositiveInt(process.env.SCRIBE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.SCRIBE_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.SCRIBE_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.SCRIBE_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        )
    }
}

function resolveScribeSummariesTableName() {
    const table = String(process.env.PATIENT_TRANSCRIPT_SUMMARIES_TABLE || DEFAULT_SCRIBE_SUMMARIES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_TRANSCRIPT_SUMMARIES_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function truncateText(value, maxLength = 2000) {
    if (!value) return ''
    const text = String(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
}

function parseJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function parsePayload(row) {
    const raw = row?.payload_json || row?.payload || null
    if (!raw) return {}
    if (typeof raw === 'object') return raw
    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function sentenceSplit(source) {
    return String(source || '')
        .replace(/\r/g, '')
        .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 20)
}

function uniqueLines(lines) {
    const seen = new Set()
    const out = []
    for (const line of lines) {
        const normalized = String(line || '').replace(/\s+/g, ' ').trim()
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(normalized)
    }
    return out
}

function shortenOccupationalTherapist(value) {
    return String(value || '')
        .replace(/\bthe occupational therapist and the patient\b/gi, 'OT and the patient')
}

function stripSpeakerPrefix(value) {
    return String(value || '').replace(/^\s*(ot|patient|carer|support worker|clinician)\s*:\s*/i, '').trim()
}

function detectSpeaker(value) {
    const match = String(value || '').match(/^\s*(ot|patient|carer|support worker|clinician)\s*:/i)
    if (!match) return ''
    return String(match[1] || '').trim().toLowerCase()
}

function isLikelyQuestionLine(value) {
    const text = String(value || '').trim()
    if (!text) return false
    if (text.includes('?')) return true
    const withoutSpeaker = stripSpeakerPrefix(text).toLowerCase()
    return /^(how|what|when|where|why|who|which|do|does|did|are|is|can|could|would|will|any)\b/.test(withoutSpeaker)
}

function isLowValueEvidenceLine(value) {
    const line = String(value || '').trim()
    if (!line) return true
    if (line.length < 24) return true

    const speaker = detectSpeaker(line)
    const core = stripSpeakerPrefix(line).toLowerCase()

    if (speaker === 'ot' && isLikelyQuestionLine(line)) {
        return true
    }

    if (/^(hi|hello|thanks for coming|good to see you|let'?s start)\b/.test(core)) {
        return true
    }

    if (/\bcheck in\b/.test(core) && isLikelyQuestionLine(line)) {
        return true
    }

    return false
}

function scoreEvidenceLine(value) {
    const line = String(value || '').trim()
    if (!line) return 0

    const speaker = detectSpeaker(line)
    const core = stripSpeakerPrefix(line).toLowerCase()
    let score = 0

    if (speaker === 'patient' || speaker === 'carer') score += 3
    if (speaker === 'ot' || speaker === 'clinician') score -= 1
    if (isLikelyQuestionLine(line)) score -= 3
    if (/\b(i|my|me)\b/.test(core)) score += 1
    if (/\b(fatigue|pain|fall|near miss|unsafe|harder|difficult|slow|support|assist)\b/.test(core)) score += 2

    return score
}

function isLowValueActionItem(value) {
    const line = String(value || '').trim()
    if (!line) return true
    if (isLikelyQuestionLine(line)) return true
    const core = stripSpeakerPrefix(line).toLowerCase()
    if (/\bcheck in\b/.test(core) && core.length < 120) return true
    return false
}

function cleanTranscriptText(value, maxLength = 140000) {
    return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength)
}

function buildSummarySentences(transcriptText, maxSentences = 6) {
    const sentences = sentenceSplit(transcriptText)
    return uniqueLines(sentences).slice(0, maxSentences)
}

function buildActionItems(transcriptText, maxItems = 5) {
    const candidates = sentenceSplit(transcriptText)
    const patterns = [
        /\b(follow up|follow-up|plan|next step|action|need to|should|will)\b/i,
        /\b(refer|arrange|book|schedule|review|update|check)\b/i,
    ]

    const matched = []
    for (const line of candidates) {
        const lower = line.toLowerCase()
        if (!patterns.some((pattern) => pattern.test(lower))) continue
        if (isLowValueActionItem(line)) continue
        matched.push(line)
        if (matched.length >= maxItems) break
    }

    return uniqueLines(matched).map(shortenOccupationalTherapist)
}

function resolveSummaryEvidenceLimit(style) {
    const normalized = String(style || '').trim().toLowerCase()
    if (normalized === 'clinical-brief') return 6
    if (normalized === 'detailed') return 16
    // FCA has to cover many functional domains from one transcript, so it needs the same
    // headroom as `detailed` rather than the generic 10.
    if (normalized === FCA_SCRIBE_SUMMARY_STYLE) return 16
    return 10
}

function toStructuredEvidenceDomain(label) {
    const normalized = String(label || '').trim().toLowerCase()
    if (!normalized) return 'general'
    return normalized
}

function createEvidenceRule(domain, pattern, impact) {
    return { domain, pattern, impact }
}

const STRUCTURED_EVIDENCE_RULES = [
    createEvidenceRule('fatigue', /\bfatigue|energy|endurance|post-exertional|crash\b/i, 'Reduced activity tolerance and inconsistent engagement across routines.'),
    createEvidenceRule('pain', /\bpain|burning|tingling|neuropath|ache|flare\b/i, 'Pain variability is likely to disrupt function and increase support needs.'),
    createEvidenceRule('mobility', /\bmobility|walking|stair|transfer|fall|near miss|balance|gait\b/i, 'Mobility reliability and falls safety require structured supports.'),
    createEvidenceRule('adl-personal-care', /\bshower|bathing|dressing|toilet|toileting|grooming|hygiene\b/i, 'Personal care independence is reduced and safety supervision may be needed.'),
    createEvidenceRule('upper-limb-function', /\bhand|dexterity|tremor|grip|fine motor\b/i, 'Upper-limb control limits task speed, precision, and completion quality.'),
    createEvidenceRule('cognition', /\bcognit|memory|attention|executive|planning|organis|organize|checklist\b/i, 'Executive load and memory demands reduce independent task completion.'),
    createEvidenceRule('domestic-function', /\bkitchen|meal|cooking|prep|laundry|cleaning|domestic\b/i, 'Domestic routines are likely to require pacing, adaptation, or direct assistance.'),
    createEvidenceRule('community-access', /\bcommunity|outings?|social|appointment|participation|shopping\b/i, 'Community participation is reduced by functional reliability limits.'),
    createEvidenceRule('transport', /\btransport|public transport|travel|driving\b/i, 'Transport barriers are likely to restrict appointment and participation access.'),
    createEvidenceRule('supports', /\bpartner|support worker|informal support|assistance|carer\b/i, 'Current support load indicates ongoing care coordination requirements.'),
    createEvidenceRule('assistive-technology', /\bergonomic|assistive|equipment|modification|shower chair|grab rail|wheelchair\b/i, 'Environmental and assistive supports are relevant to safety and task completion.'),
    createEvidenceRule('planning-follow-up', /\bplan|next step|action|follow up|follow-up|review|goal|refer|arrange\b/i, 'Follow-up actions indicate unresolved needs requiring coordinated implementation.'),
]

// Section titles keyed by FCA_REPORT_BLUEPRINT id (two/src/lib/jobs/fcaReportGeneration.js).
// Keeping the ids identical means the FCA worker's keyword scoring lands each finding in the
// right report section, and the builder can group suggestions per step.
const FCA_SECTION_TITLES = {
    'participant-context': 'Participant Context and Living Situation',
    'medical-background': 'Clinical Background and Relevant History',
    'change-of-circumstances': 'Change of Circumstances Since the Last Plan Review',
    'falls-injury-history': 'Falls and Injury History',
    'current-functioning': 'Current Functional Presentation',
    'adl-personal-care': 'Personal Care and Activities of Daily Living',
    'domestic-community': 'Domestic Function and Community Participation',
    'overnight-sleep': 'Sleep, Overnight Needs and Wellbeing',
    'assistive-technology': 'Assistive Technology and Environmental Supports',
    'risk-safeguarding': 'Risk Profile and Safeguarding Considerations',
    'restrictive-practice': 'Restrictive Practice Considerations',
    'support-worker-training': 'Capability and Training Requirements for Support Workers',
    'standardised-assessment-summary': 'Assessment Findings and Clinical Interpretation',
    'goals-outcomes': 'Goals and Expected Outcomes',
    'alternatives-considered': 'Consideration of Alternatives',
    'recommendations-funding': 'Recommendations and Funding Rationale',
}

// Ordered most-specific first: buildStructuredEvidenceFacts stops at the first matching rule
// for a sentence, so a showering finding must not be captured by the broader mobility rule.
const FCA_STRUCTURED_EVIDENCE_RULES = [
    createEvidenceRule('adl-personal-care', /\bshower|bath|dress|undress|toilet|groom|hygiene|shav|eating|feeding|meal prep|plate\b/i, 'Personal care requires assistance, supervision, or adaptive setup to remain safe.'),
    createEvidenceRule('assistive-technology', /\bassistive|equipment|\baid\b|wheelchair|scooter|hoist|modification|grab rail|hand rail|ramp|shower chair|shower stool|seated setup|ergonomic|perching stool\b/i, 'Assistive technology and environmental supports are required for safe task completion.'),
    createEvidenceRule('standardised-assessment-summary', /\bwhodas|assessment|score|measure|standardis|standardiz\b/i, 'Standardised findings substantiate the functional capacity conclusions.'),
    createEvidenceRule('falls-injury-history', /\bfell\b|\bfalls?\b|\bfalling\b|fractur|injur|ambulance|emergency department|loss of consciousness|concussion|stitches\b/i, 'Recorded falls and injuries establish a pattern of unsafe independent activity.'),
    createEvidenceRule('overnight-sleep', /\bovernight|nocturnal|\bnight(?:s|time)?\b|\bsleep|wakes?|waking|insomnia\b/i, 'Overnight need determines the level of continuous support required.'),
    createEvidenceRule('restrictive-practice', /\brestrictive|restricted|locked|\block\b|surveillance|sedat|physical intervention|monitoring device\b/i, 'The arrangement must be characterised against restrictive practice requirements.'),
    createEvidenceRule('risk-safeguarding', /\brisk|unsafe|near miss|escalat|behaviou?r|supervision|vulnerab|scald|burn|wander|leave the stove\b/i, 'Identified risks indicate a safeguarding and supervision requirement.'),
    createEvidenceRule('domestic-community', /\bdomestic|clean|vacuum|laundry|cooking|kitchen|garden|shopping|community|outing|social|appointment|transport|public transport\b/i, 'Domestic and community tasks are limited by functional capacity and require support.'),
    createEvidenceRule('goals-outcomes', /\bgoal|outcome|want(?:s|ed)? to|would like|hopes?\b|capacity building|routine|independen/i, 'Stated goals anchor the capacity-building and outcome recommendations.'),
    createEvidenceRule('alternatives-considered', /\bresidential care|residential aged|nursing home|supported accommodation|\bsil\b|hospital admission|alternative|less costly|cost of care\b/i, 'Alternatives must be weighed against the cost and risk of the support requested.'),
    createEvidenceRule('recommendations-funding', /\brecommend|funding|reasonable|necessar|hours|therapy|refer|arrange|review|support plan\b/i, 'Unresolved needs indicate ongoing funded support and review requirements.'),
    createEvidenceRule('change-of-circumstances', /\bsince (?:the |his |her )?(?:last |previous )?(?:plan|review|assessment)|change of circumstances|deteriorat|declined since|rapid(?:ly)? declin/i, 'The change since the last review is the basis for the request.'),
    createEvidenceRule('current-functioning', /\bmobility|walking|stair|transfer|balance|gait|communicat|speech|cognit|memory|attention|planning|concentrat|dexterity|grip|\bhand\b|upper limb\b/i, 'Current functioning limits reliability and safety across everyday activity.'),
    createEvidenceRule('medical-background', /\bdiagnos|condition|medical|neurolog|history|medication|pain|fatigue|energy|endurance\b/i, 'Clinical background is directly relevant to functional capacity and support need.'),
    createEvidenceRule('support-worker-training', /\bsupport worker\b[^.]*\b(?:training|competenc|skill|incident)|manual handling|\binduction\b|\bshadow shift\b/i, 'Support capability determines whether the funded support can be delivered safely.'),
    createEvidenceRule('participant-context', /\bfamily|lives? with|hous(e|ing)|living arrangement|support worker|carer|informal support|partner\b/i, 'Living situation and informal supports shape the practical support plan.'),
]

function resolveStructuredEvidenceRules(style) {
    return isFcaSummaryStyle(style) ? FCA_STRUCTURED_EVIDENCE_RULES : STRUCTURED_EVIDENCE_RULES
}

function formatFcaEvidenceFact(fact) {
    const item = fact && typeof fact === 'object' ? fact : {}
    const domain = String(item.domain || 'general').trim()
    const observedIssue = String(item.observedIssue || '').trim()
    const functionalImpact = String(item.functionalImpact || '').trim()
    const supportImplication = String(item.supportImplication || '').trim()
    if (!observedIssue && !functionalImpact && !supportImplication) return ''

    return [
        `- ${FCA_SECTION_TITLES[domain] || domain}`,
        observedIssue ? `  Evidence: ${observedIssue}` : '',
        functionalImpact ? `  Functional impact: ${functionalImpact}` : '',
        supportImplication ? `  Support implication: ${supportImplication}` : '',
    ].filter(Boolean).join('\n')
}

function buildStructuredEvidenceFacts(transcriptText, style) {
    const maxFacts = resolveSummaryEvidenceLimit(style)
    const maxPerDomain = 2
    const rules = resolveStructuredEvidenceRules(style)
    const candidates = uniqueLines(sentenceSplit(transcriptText))
        .filter((sentence) => !isLowValueEvidenceLine(sentence))
        .sort((a, b) => scoreEvidenceLine(b) - scoreEvidenceLine(a))
    const facts = []
    const seen = new Set()
    const seenObservedIssue = new Set()
    const domainCounts = new Map()

    const tryAddFact = (sentence, rule) => {
        const domain = toStructuredEvidenceDomain(rule.domain)
        if ((domainCounts.get(domain) || 0) >= maxPerDomain) return false

        const observedIssue = shortenOccupationalTherapist(stripSpeakerPrefix(sentence)).slice(0, 280)
        if (!observedIssue) return false
        const key = `${domain}:${observedIssue.toLowerCase()}`
        const observationKey = observedIssue.toLowerCase()
        if (seen.has(key) || seenObservedIssue.has(observationKey)) return false

        seen.add(key)
        seenObservedIssue.add(observationKey)
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
        facts.push({
            domain,
            observedIssue,
            functionalImpact: rule.impact,
            supportImplication: 'Consider support planning that addresses reliability, safety, and participation barriers in this domain.',
        })
        return true
    }

    // Pass 1: cover as many distinct domains as possible before repeating any one domain,
    // so a pain-heavy transcript doesn't crowd out the other functional areas the report needs.
    for (const sentence of candidates) {
        if (facts.length >= maxFacts) return facts
        for (const rule of rules) {
            if (!rule.pattern.test(sentence)) continue
            if (domainCounts.has(toStructuredEvidenceDomain(rule.domain))) continue
            if (tryAddFact(sentence, rule)) break
        }
    }

    // Pass 2: fill any remaining slots, still capped at maxPerDomain per domain.
    for (const sentence of candidates) {
        if (facts.length >= maxFacts) return facts
        for (const rule of rules) {
            if (!rule.pattern.test(sentence)) continue
            if (tryAddFact(sentence, rule)) break
        }
    }

    return facts
}

function formatStructuredEvidenceFact(fact) {
    const item = fact && typeof fact === 'object' ? fact : {}
    const domain = String(item.domain || 'general').trim()
    const observedIssue = String(item.observedIssue || '').trim()
    const functionalImpact = String(item.functionalImpact || '').trim()
    const supportImplication = String(item.supportImplication || '').trim()
    const parts = [observedIssue, functionalImpact, supportImplication].filter(Boolean)
    if (parts.length === 0) return ''
    return `- Evidence (${domain}): ${parts.join(' ')}`
}

function formatOtf10EvidenceFact(fact) {
    const item = fact && typeof fact === 'object' ? fact : {}
    const domain = String(item.domain || 'general').trim()
    const observedIssue = String(item.observedIssue || '').trim()
    const functionalImpact = String(item.functionalImpact || '').trim()
    const supportImplication = String(item.supportImplication || '').trim()
    if (!observedIssue && !functionalImpact && !supportImplication) return ''

    return [
        `- Area: ${domain}`,
        observedIssue ? `  Evidence: ${observedIssue}` : '',
        functionalImpact ? `  Functional impact: ${functionalImpact}` : '',
        supportImplication ? `  Support implication: ${supportImplication}` : '',
    ].filter(Boolean).join('\n')
}

const EVIDENCE_SYSTEM_PROMPT_BASE = [
    'You are an occupational therapist summarizing a consultation transcript for a clinical record.',
    'Use only what the transcript states or clearly demonstrates. Never invent diagnoses, dates, hours, equipment, or services.',
    'Write in professional Australian clinical English, third person, referring to the person as "the patient".',
    'Return valid JSON only.',
].join(' ')

const OTF10_SYSTEM_PROMPT_FOCUS = 'This summary supports a TAC OTF10 Home Services Review, so prioritise findings that bear on home services, personal care, domestic tasks, equipment, and supervision needs.'

const FCA_SYSTEM_PROMPT_FOCUS = 'This summary supports an NDIS Functional Capacity Assessment, so prioritise findings that bear on daily living and personal care, domestic function and community participation, assistive technology and environmental supports, risk and safeguarding, and the level of funded support each finding implies. Label every finding with the functional domain it belongs to.'

const EVIDENCE_FACT_RULES = [
    'Rules for facts:',
    '- Return between 4 and 10 facts, each covering a DIFFERENT functional area. Never emit two facts for the same domain unless the transcript supports genuinely distinct findings.',
    '- domain: one short lowercase label such as pain, fatigue, mobility, adl-personal-care, domestic-function, community-access, cognition, upper-limb-function, assistive-technology, supports, transport, planning-follow-up.',
    '- observedIssue: what the patient reported or the OT observed, in one specific clinical sentence. Paraphrase into clinical language rather than quoting conversational speech, and keep the concrete detail (which task, which limb, what triggers it, what aid is used).',
    '- functionalImpact: how this limits performance of a specific everyday task.',
    '- supportImplication: the concrete home-service, equipment, or supervision implication that follows. Be specific to this finding.',
    '- Never use filler such as "Consider support planning that addresses reliability, safety, and participation barriers in this domain."',
    '- Skip anything the transcript does not support. Fewer, well-evidenced facts are better than padding.',
].join('\n')

// The allowed FCA domains are the FCA_REPORT_BLUEPRINT section ids. Facts labelled with them are
// placed into the matching report section by the FCA worker's keyword scoring, and the builder
// groups them by step, so the label is not cosmetic.
const FCA_EVIDENCE_FACT_RULES = [
    'Rules for facts:',
    '- Return between 6 and 16 facts, each covering a DIFFERENT functional area. Never emit two facts for the same domain unless the transcript supports genuinely distinct findings.',
    '- domain: use exactly one of these functional domains: participant-context, medical-background, current-functioning, adl-personal-care, domestic-community, assistive-technology, risk-safeguarding, standardised-assessment-summary, goals-outcomes, recommendations-funding.',
    '- observedIssue: what the patient reported or the OT observed, in one specific clinical sentence. Paraphrase into clinical language rather than quoting conversational speech, and keep the concrete detail (which task, which limb, what triggers it, what aid is used).',
    '- functionalImpact: how this limits performance of a specific everyday task.',
    '- supportImplication: the concrete support, equipment, or funding implication that follows. Be specific to this finding.',
    '- Never use filler such as "Consider support planning that addresses reliability, safety, and participation barriers in this domain."',
    '- Prioritise findings that evidence functional capacity and support need over conversational content.',
    '- Skip anything the transcript does not support. Fewer, well-evidenced facts are better than padding.',
].join('\n')

const EVIDENCE_FOLLOW_UP_RULES = [
    'Rules for followUps:',
    '- Return at most 5, and only concrete actions, referrals, assessments, or reviews that the transcript shows were agreed, requested, or arranged.',
    '- Write each as a third-person clinical action naming who does what, e.g. "Podiatrist to provide a treatment plan for the right foot."',
    '- Never include a symptom, a patient belief or fear, a piece of advice the patient disagreed with, or a restatement of a functional limitation. Those belong in facts, not followUps.',
    '- Never quote conversational speech and never use first person.',
    '- Return an empty array if the transcript records no agreed actions. An empty array is expected and correct.',
].join('\n')

const EVIDENCE_TOPIC_RULES = [
    'Rules for topics:',
    '- Return 4 to 8 third-person bullets describing what this consultation actually established, one short sentence each.',
    '- Each topic must carry the specific finding, not just the subject discussed. Write "Reports right-sided back pain that prevents bending to vacuum" rather than "Review of pain patterns and symptom triggers".',
    '- A bullet that would read identically for a different patient is wrong. Name the task, aid, trigger, or body part involved.',
    '- Never quote conversational speech and never use first person.',
].join('\n')

const EVIDENCE_BRIEF_RULES = [
    'Rules for brief:',
    '- One clinical paragraph of 60-120 words covering presentation, functional impact, and support needs established in this consultation.',
    '- Prose only, no bullets, no first person, no quoted speech.',
].join('\n')

function buildEvidenceUserInstructions(style) {
    // FCA and OTF10 both drop the generic topic bullets: their consumers read the
    // domain-tagged facts, and the topics would only add section-agnostic noise.
    const isOtf10 = style === OTF10_SCRIBE_SUMMARY_STYLE
    const isFca = isFcaSummaryStyle(style)
    const suppressTopics = isOtf10 || isFca
    const isBrief = style === 'clinical-brief'

    return [
        'Summarize this consultation transcript.',
        '',
        'Return JSON of the form {"facts": [{"domain": "...", "observedIssue": "...", "functionalImpact": "...", "supportImplication": "..."}], "followUps": ["..."], "topics": ["..."], "brief": "..."}.',
        '',
        isFca ? FCA_EVIDENCE_FACT_RULES : EVIDENCE_FACT_RULES,
        '',
        EVIDENCE_FOLLOW_UP_RULES,
        '',
        suppressTopics ? null : EVIDENCE_TOPIC_RULES,
        suppressTopics ? null : '',
        isBrief ? EVIDENCE_BRIEF_RULES : null,
        isBrief ? '' : null,
        suppressTopics ? 'Return an empty array for topics and an empty string for brief.' : null,
        isBrief ? null : 'Return an empty string for brief.',
    ].filter((line) => line !== null).join('\n').trim()
}

function supportsCustomTemperature(model) {
    return !/^(gpt-5|o[13-9])/i.test(String(model || '').trim())
}

function normalizeLlmEvidenceFacts(parsed) {
    const rawFacts = Array.isArray(parsed?.facts)
        ? parsed.facts
        : Array.isArray(parsed)
            ? parsed
            : []

    const facts = []
    for (const item of rawFacts) {
        if (!item || typeof item !== 'object') continue
        const domain = toStructuredEvidenceDomain(item.domain)
        const observedIssue = String(item.observedIssue || '').trim().slice(0, 400)
        if (!observedIssue) continue
        facts.push({
            domain,
            observedIssue,
            functionalImpact: String(item.functionalImpact || '').trim().slice(0, 400),
            supportImplication: String(item.supportImplication || '').trim().slice(0, 400),
        })
    }
    return facts
}

function normalizeLlmTextList(raw, { maxItems, maxLength }) {
    const items = Array.isArray(raw) ? raw : []
    const out = []

    for (const item of items) {
        const text = String(typeof item === 'object' && item !== null ? (item.action || item.text || item.topic || '') : item || '')
            .trim()
            .replace(/\s{2,}/g, ' ')
            .slice(0, maxLength)
        if (!text) continue
        // First person or a question means the model echoed conversational speech rather than
        // writing a clinical statement.
        if (/\b(i|i'm|i'll|my|me|we'll)\b/i.test(text)) continue
        if (text.includes('?')) continue
        out.push(text)
        if (out.length >= maxItems) break
    }

    return uniqueLines(out)
}

function normalizeLlmFollowUps(parsed, maxItems = 5) {
    return normalizeLlmTextList(parsed?.followUps, { maxItems, maxLength: 300 })
}

function normalizeLlmTopics(parsed, maxItems = 8) {
    return normalizeLlmTextList(parsed?.topics, { maxItems, maxLength: 300 })
        .map((topic) => (topic.startsWith('- ') ? topic : `- ${topic}`))
}

function normalizeLlmBrief(parsed) {
    const text = String(parsed?.brief || '').trim().replace(/\s{2,}/g, ' ').slice(0, 1200)
    return /\b(i|i'm|my|me)\b/i.test(text) ? '' : text
}

async function generateTranscriptEvidenceWithOpenAi({
    transcriptText,
    identity,
    subjectNoun = 'participant',
    style,
    model,
    provider,
    baseUrl,
    apiKey,
    workerPrompt,
    additionalInstructions,
}) {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    const resolvedApiKey = resolveChatApiKey({ provider: normalizedProvider, model, apiKey })
    if (!resolvedApiKey || isUnsupportedChatProvider(normalizedProvider)) {
        return null
    }

    const resolvedModel = String(model || '').trim() || process.env.REPORT_WORKER_AI_MODEL || 'gpt-4.1-mini'
    const systemPrompt = [
        EVIDENCE_SYSTEM_PROMPT_BASE,
        style === OTF10_SCRIBE_SUMMARY_STYLE ? OTF10_SYSTEM_PROMPT_FOCUS : null,
        isFcaSummaryStyle(style) ? FCA_SYSTEM_PROMPT_FOCUS : null,
        String(workerPrompt || '').trim() || null,
        String(additionalInstructions || '').trim() || null,
    ].filter(Boolean).join(' ')

    // A transcript is the richest identifier source in the system - people say their own name, their
    // relative's name and their address out loud. It is scrubbed here, so the *stored* summary is
    // already de-identified for every downstream reader (the report writer and the analyst).
    const guarded = guardOutgoingChat(
        {
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `${buildEvidenceUserInstructions(style)}\n\nRefer to the person only as "the ${subjectNoun}".\n\nTranscript:\n${truncateText(transcriptText, 60000)}`,
            }],
        },
        { identity, channel: EGRESS_CHANNEL_TRANSCRIPT_SUMMARY }
    )

    const result = await requestChatCompletion({
        provider: normalizedProvider,
        model: resolvedModel,
        baseUrl,
        apiKey: resolvedApiKey,
        system: guarded.system,
        messages: guarded.messages,
        jsonMode: true,
        temperature: 0.2,
        errorLabel: 'Transcript evidence extraction failed',
    })
    if (!result.ok) {
        throw new Error(result.error)
    }

    let parsed = null
    try {
        parsed = JSON.parse(String(result.text || '').trim())
    } catch {
        return null
    }

    const facts = normalizeLlmEvidenceFacts(parsed)
    if (facts.length === 0) return null

    return {
        facts,
        followUps: normalizeLlmFollowUps(parsed),
        topics: normalizeLlmTopics(parsed),
        brief: normalizeLlmBrief(parsed),
    }
}

function inferConversationTopics(transcriptText) {
    const source = String(transcriptText || '').toLowerCase()
    const topicPatterns = [
        {
            key: 'fatigue',
            pattern: /\bfatigue|energy|endurance|crash\b/i,
            templates: [
                'Assessment of endurance limits and recovery pacing needs.',
                'Assessment of fatigue variability and energy management strategies.',
                'Review of endurance limits with pacing and recovery planning.',
            ],
        },
        {
            key: 'pain',
            pattern: /\bpain|burning|tingling|neuropath\b/i,
            templates: [
                'Review of pain patterns and common symptom triggers.',
                'Exploration of symptom patterns and activity-related pain flare triggers.',
                'Assessment of pain variability and activity-related escalation cues.',
            ],
        },
        {
            key: 'mobility',
            pattern: /\bmobility|walking|stair|transfer|fall|near miss|balance\b/i,
            templates: [
                'Assessment of mobility safety, transfer reliability, and falls risk.',
                'Review of stair safety, balance confidence, and fall risk factors.',
                'Assessment of transfer safety and environmental mobility hazards.',
            ],
        },
        {
            key: 'personal-care',
            pattern: /\bshower|bathing|dressing|toilet|toileting|grooming\b/i,
            templates: [
                'Review of hygiene and self-care tasks with safety considerations.',
                'Assessment of personal care barriers and adaptive daily routines.',
                'Review of showering and dressing routines with safety supports.',
            ],
        },
        {
            key: 'upper-limb',
            pattern: /\bhand|dexterity|tremor|grip|fine motor\b/i,
            templates: [
                'Assessment of upper-limb control and fine motor limitations.',
                'Review of hand function, dexterity, and task precision limits.',
                'Assessment of upper-limb capacity and performance barriers in daily tasks.',
            ],
        },
        {
            key: 'cognition',
            pattern: /\bcognit|memory|attention|checklist|admin|forms\b/i,
            templates: [
                'Assessment of cognitive fatigue and executive functioning supports.',
                'Review of attention demands and memory-related task supports.',
                'Assessment of cognitive load and compensatory strategies for daily planning.',
            ],
        },
        {
            key: 'domestic',
            pattern: /\bkitchen|meal|cooking|prep|laundry|cleaning|domestic\b/i,
            templates: [
                'Review of domestic task capacity and home-management strategies.',
                'Assessment of household task demands and pacing supports.',
                'Review of kitchen and home-management limits with practical adaptations.',
            ],
        },
        {
            key: 'community',
            pattern: /\bcommunity|outings?|social|appointment|participation\b/i,
            templates: [
                'Review of community participation limits and recovery planning.',
                'Assessment of participation barriers and re-engagement priorities.',
                'Review of social and community access constraints with recovery goals.',
            ],
        },
        {
            key: 'transport',
            pattern: /\btransport|public transport|travel\b/i,
            templates: [
                'Assessment of transport reliability and access planning.',
                'Review of travel barriers and sustainable access supports.',
                'Assessment of transport demands and participation access barriers.',
            ],
        },
        {
            key: 'support',
            pattern: /\bpartner|support worker|informal support|assistance\b/i,
            templates: [
                'Review of support needs and informal care burden.',
                'Assessment of care coordination and practical support demands.',
                'Review of existing support structures and gaps in task assistance.',
            ],
        },
        {
            key: 'assistive',
            pattern: /\bergonomic|assistive|equipment|modification|shower chair|grab rail\b/i,
            templates: [
                'Assessment of assistive equipment and environmental modifications.',
                'Review of ergonomic supports and home adaptations.',
                'Assessment of equipment needs and safety-focused environmental changes.',
            ],
        },
        {
            key: 'planning',
            pattern: /\bplan|next step|action|follow up|review|goal\b/i,
            templates: [
                'Review of next-step goals and agreed follow-up actions.',
                'Assessment of forward planning and confidence-building goals.',
                'Review of follow-up priorities and coordinated next steps.',
            ],
        },
    ]

    const topics = []
    for (const entry of topicPatterns) {
        if (!entry.pattern.test(source)) continue
        const template = entry.templates[Math.abs(source.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)) % entry.templates.length]
        if (!topics.some((item) => item.key === entry.key)) {
            topics.push({ key: entry.key, statement: template })
        }
    }

    return topics.slice(0, 8).map((item) => item.statement)
}

function buildThirdPersonTopicBullets(transcriptText) {
    const topics = inferConversationTopics(transcriptText)
    if (topics.length === 0) {
        return ['- OT reviewed current functional concerns and follow-up priorities.']
    }
    return topics.map((topic) => `- ${topic}`)
}

function buildTranscriptSummary(record, payload = {}, { llmEvidenceFacts = null, llmFollowUps = null, llmTopics = null, llmBrief = '' } = {}) {
    const transcriptText = cleanTranscriptText(record?.transcript_text || payload?.transcriptText || '')
    const summaryLines = buildSummarySentences(transcriptText)
    const style = String(payload?.scribeConfig?.summaryStyle || DEFAULT_SCRIBE_SUMMARY_STYLE).trim().toLowerCase() || DEFAULT_SCRIBE_SUMMARY_STYLE
    const includeActionItems = payload?.scribeConfig?.includeActionItems !== false
    const isOtf10Style = style === OTF10_SCRIBE_SUMMARY_STYLE
    const isFcaStyle = isFcaSummaryStyle(style)
    const usableLlmFacts = Array.isArray(llmEvidenceFacts) && llmEvidenceFacts.length > 0 ? llmEvidenceFacts : null
    const structuredEvidenceFacts = usableLlmFacts || buildStructuredEvidenceFacts(transcriptText, style)
    const evidenceExtractor = usableLlmFacts
        ? resolveChatProviderLabel({ provider: payload?.aiUsage?.provider, model: payload?.aiUsage?.model })
        : 'heuristic'
    const usableLlmTopics = Array.isArray(llmTopics) && llmTopics.length > 0 ? llmTopics : null
    const topicBullets = usableLlmTopics || buildThirdPersonTopicBullets(transcriptText)
    // Keyword-matched transcript lines are unsafe as follow-ups: they surface patient beliefs and
    // symptoms as though they were agreed clinical actions. OTF10 and FCA therefore have no
    // heuristic fallback and only use follow-ups the model actually extracted.
    const actionItems = Array.isArray(llmFollowUps) && llmFollowUps.length > 0
        ? llmFollowUps
        : (isOtf10Style || isFcaStyle)
            ? []
            : buildActionItems(transcriptText)

    let summaryText = ''
    if (isOtf10Style) {
        const evidenceBlocks = structuredEvidenceFacts
            .slice(0, 10)
            .map(formatOtf10EvidenceFact)
            .filter(Boolean)
        const actionBullets = includeActionItems
            ? actionItems.slice(0, 5).map((item) => `- Follow-up: ${item}`)
            : []
        summaryText = Array.from(new Set([
            ...evidenceBlocks,
            ...actionBullets,
        ])).slice(0, 20).join('\n')
        if (!summaryText) {
            summaryText = 'No specific home-service evidence was identified in the transcript.'
        }
    } else if (isFcaStyle) {
        const evidenceBlocks = structuredEvidenceFacts
            .slice(0, 16)
            .map(formatFcaEvidenceFact)
            .filter(Boolean)
        const actionBullets = includeActionItems
            ? actionItems.slice(0, 5).map((item) => `- Follow-up: ${item}`)
            : []
        // `uniqueLines` flattens whitespace, which would collapse these multi-line blocks back
        // into one paragraph, so de-duplicate with a Set instead.
        summaryText = Array.from(new Set([
            ...evidenceBlocks,
            ...actionBullets,
        ])).slice(0, 30).join('\n\n')
        if (!summaryText) {
            summaryText = 'No Functional Capacity Assessment evidence was identified in this transcript.'
        }
    } else if (style === 'clinical-brief') {
        summaryText = String(llmBrief || '').trim()
            || (summaryLines.length > 0
                ? summaryLines.join(' ')
                : 'Transcript contained limited interpretable content for summarization.')
    } else if (style === 'detailed') {
        const evidenceBullets = structuredEvidenceFacts.map(formatStructuredEvidenceFact).filter(Boolean)
        const actionBullets = includeActionItems
            ? actionItems.map((item) => `- Follow-up: ${item}`)
            : []
        summaryText = uniqueLines([...topicBullets, ...evidenceBullets, ...actionBullets]).slice(0, 28).join('\n')
    } else {
        const evidenceBullets = structuredEvidenceFacts
            .slice(0, 4)
            .map((fact) => {
                const domain = String(fact?.domain || 'general').trim()
                const observedIssue = String(fact?.observedIssue || '').trim()
                return observedIssue ? `- Evidence (${domain}): ${observedIssue}` : ''
            })
            .filter(Boolean)
        summaryText = uniqueLines([...topicBullets, ...evidenceBullets]).slice(0, 14).join('\n')
    }

    return {
        summaryText,
        summaryLines,
        structuredEvidenceFacts,
        evidenceExtractor,
        actionItems: includeActionItems ? actionItems : [],
        style,
        sourceStats: {
            transcriptChars: transcriptText.length,
            sentenceCount: sentenceSplit(transcriptText).length,
            structuredFactCount: structuredEvidenceFacts.length,
            actionItemCount: includeActionItems ? actionItems.length : 0,
        },
        generator: 'two-scribe-worker-v1',
        generatedAt: new Date().toISOString(),
    }
}

function getScribeConfig(payload, patientMetadata) {
    const metadata = patientMetadata && typeof patientMetadata === 'object' ? patientMetadata : {}
    const patientAgents = metadata.patientAgents && typeof metadata.patientAgents === 'object' ? metadata.patientAgents : {}
    const payloadConfig = payload?.scribeConfig && typeof payload.scribeConfig === 'object'
        ? payload.scribeConfig
        : {}
    const requestedStyle = String(payloadConfig.summaryStyle || '').trim().toLowerCase()
    const isOtf10 = requestedStyle === OTF10_SCRIBE_SUMMARY_STYLE
    const isFca = requestedStyle === FCA_SCRIBE_SUMMARY_STYLE
    const savedConfig = isOtf10 && patientAgents.hsrSummariserConfig && typeof patientAgents.hsrSummariserConfig === 'object'
        ? patientAgents.hsrSummariserConfig
        : isFca && patientAgents.fcaSummariserConfig && typeof patientAgents.fcaSummariserConfig === 'object'
            ? patientAgents.fcaSummariserConfig
            : patientAgents.scribeConfig && typeof patientAgents.scribeConfig === 'object'
                ? patientAgents.scribeConfig
                : {}
    // payload.scribeConfig is an explicit per-job override (e.g. report-worker OTF10/FCA
    // summary prerequisites requesting a specific style) and must win over the patient's
    // saved default, otherwise those prereq jobs silently regenerate the default-style
    // summary and the requesting report job defers forever waiting for a style it'll never see.
    const config = { ...savedConfig, ...payloadConfig }

    return {
        summaryStyle: String(config.summaryStyle || DEFAULT_SCRIBE_SUMMARY_STYLE).trim() || DEFAULT_SCRIBE_SUMMARY_STYLE,
        includeActionItems: config.includeActionItems !== false,
        additionalInstructions: String(config.additionalInstructions || '').trim(),
        workerPrompt: String(config.workerPrompt || '').trim()
            || (isOtf10 ? DEFAULT_HSR_SUMMARISER_WORKER_PROMPT : isFca ? DEFAULT_FCA_SUMMARISER_WORKER_PROMPT : ''),
    }
}

function resolveScribeWorkerPrompt({ payload, scribeConfig }) {
    const explicitPrompt = String(payload?.scribeConfig?.workerPrompt || scribeConfig?.workerPrompt || '').trim()
    if (explicitPrompt) {
        return explicitPrompt
    }

    const style = String(scribeConfig?.summaryStyle || DEFAULT_SCRIBE_SUMMARY_STYLE).trim().toLowerCase() || DEFAULT_SCRIBE_SUMMARY_STYLE
    const includeActionItems = scribeConfig?.includeActionItems !== false
    const additionalInstructions = String(scribeConfig?.additionalInstructions || '').trim()

    const styleDirective = style === 'clinical-brief'
        ? 'Return a concise clinical brief in prose and avoid bullet formatting.'
        : style === 'detailed'
            ? 'Return a detailed bullet-point list of conversation topics written in third person.'
            : style === FCA_SCRIBE_SUMMARY_STYLE
                ? 'Return Functional Capacity Assessment evidence grouped by functional domain, naming the task, aid, trigger, and support implication for each finding.'
                : 'Return a concise bullet-point list of conversation topics written in third person.'

    const actionDirective = includeActionItems
        ? 'Include action-oriented follow-up topics when present in the transcript.'
        : 'Do not include separate action-item bullets.'

    return [
        DEFAULT_SCRIBE_WORKER_PROMPT,
        styleDirective,
        actionDirective,
        additionalInstructions || null,
    ].filter(Boolean).join(' ')
}

function isScribeAgentEnabled(metadata, summaryStyle = DEFAULT_SCRIBE_SUMMARY_STYLE) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
    const isOtf10 = String(summaryStyle || '').trim().toLowerCase() === OTF10_SCRIBE_SUMMARY_STYLE
    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        if (isOtf10) {
            return patientAgents.hsrSummariser === true
                || patientAgents.hsr_summariser === true
                || patientAgents.hsrCreator === true
                || patientAgents.hsr_creator === true
        }
        return patientAgents.scribe === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        if (isOtf10) {
            return legacyAgents.hsrSummariser === true
                || legacyAgents.hsr_summariser === true
                || legacyAgents.hsrCreator === true
                || legacyAgents.hsr_creator === true
        }
        return legacyAgents.scribe === true
    }

    return false
}

function getSummarySchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        transcription_id BIGINT NOT NULL,
        summary_style VARCHAR(80) NOT NULL DEFAULT 'topic-bullets-third-person',
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        summary_text TEXT,
        summary_payload_json TEXT NOT NULL DEFAULT '{}',
        last_job_id BIGINT,
        source_text_length INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ${table}_domain_transcription_style_unique UNIQUE (domain, transcription_id, summary_style)
      )
    `,
            indexes: [
                `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`,
                `CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`
            ]
        }
    }

    if (dbType === 'mysql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        transcription_id BIGINT NOT NULL,
        summary_style VARCHAR(80) NOT NULL DEFAULT 'topic-bullets-third-person',
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        summary_text TEXT,
        summary_payload_json LONGTEXT NOT NULL,
        last_job_id BIGINT,
        source_text_length INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY ${table}_domain_transcription_style_unique (domain, transcription_id, summary_style),
        KEY ${table}_domain_patient_idx (domain, patient_id),
        KEY ${table}_updated_idx (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
            indexes: []
        }
    }

    throw new Error(`Unsupported database type for transcript summaries: ${dbType}`)
}

async function ensureScribeSummariesTable(connection, dbType, table) {
    const schema = getSummarySchemaStatements(table, dbType)
    await connection.query(schema.create)

    if (dbType === 'postgresql') {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS summary_style VARCHAR(80) NOT NULL DEFAULT 'topic-bullets-third-person'`)
        await connection.query(`UPDATE ${table} SET summary_style = COALESCE(NULLIF(summary_payload_json::jsonb->>'summaryStyle', ''), 'topic-bullets-third-person') WHERE summary_style = 'topic-bullets-third-person'`)
        await connection.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_domain_transcription_unique`)
        await connection.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_domain_transcription_style_unique ON ${table} (domain, transcription_id, summary_style)`)
    } else {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS summary_style VARCHAR(80) NOT NULL DEFAULT 'topic-bullets-third-person'`)
        await connection.query(`UPDATE ${table} SET summary_style = COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(summary_payload_json, '$.summaryStyle')), ''), 'topic-bullets-third-person') WHERE summary_style = 'topic-bullets-third-person'`)
        try { await connection.query(`ALTER TABLE ${table} DROP INDEX ${table}_domain_transcription_unique`) } catch { }
        try { await connection.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${table}_domain_transcription_style_unique (domain, transcription_id, summary_style)`) } catch { }
    }

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }

    if (dbType === 'postgresql') {
        await ensurePermissiveRowLevelSecurity(connection, table, `${table}_rls_policy`)
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

async function markCompletedPostgres(connection, table, rowId) {
    await connection.query(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
        [rowId]
    )
}

async function markCompletedMySql(connection, table, rowId) {
    await connection.execute(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = UTC_TIMESTAMP(),
          error_message = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [rowId]
    )
}

async function markFailedPostgres(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    const status = shouldFail ? 'failed' : 'queued'

    // `$3` is used both as an assignment target and in the CASE comparison below, so
    // both uses need an explicit ::text cast. Without them Postgres deduces
    // `character varying` from the assignment and `text` from `$3 = 'queued'` and
    // rejects the whole statement with 42P08 "inconsistent types deduced for
    // parameter $3" - which leaves the job stuck in `processing` (UI: "Working").
    await connection.query(
        `
      UPDATE ${table}
      SET attempts = $2::integer,
          status = $3::text,
          error_message = $4,
          next_attempt_at = CASE WHEN $3::text = 'queued' THEN NOW() + ($5::integer || ' seconds')::interval ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
        [id, attempts, status, errorMessage, Math.max(0, Math.floor(Number(nextRetrySeconds) || 0))]
    )
}

async function markFailedMySql(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    await connection.execute(
        `
      UPDATE ${table}
      SET attempts = ?,
          status = ?,
          error_message = ?,
          next_attempt_at = CASE WHEN ? = 'queued' THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND) ELSE NULL END,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [attempts, shouldFail ? 'failed' : 'queued', errorMessage, shouldFail ? 'failed' : 'queued', nextRetrySeconds, id]
    )
}

async function claimMessagesPostgres(connection, table, batchSize, workerId, defaultMaxAttempts) {
    const sql = `
    WITH candidate AS (
      SELECT id
      FROM ${table}
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1)
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${table} AS q
    SET status = 'processing',
        claimed_at = NOW(),
        claimed_by = $3,
        updated_at = NOW()
    FROM candidate
    WHERE q.id = candidate.id
    RETURNING q.*
  `

    const result = await connection.query(sql, [defaultMaxAttempts, batchSize, workerId])
    return result.rows || []
}

async function claimMessagesMySql(connection, table, batchSize, workerId, defaultMaxAttempts) {
    await connection.beginTransaction()

    try {
        const [rows] = await connection.execute(
            `
        SELECT id
        FROM ${table}
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
          AND COALESCE(attempts, 0) < COALESCE(max_attempts, ?)
        ORDER BY created_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
            [defaultMaxAttempts, batchSize]
        )

        const ids = rows.map((row) => row.id)
        if (ids.length === 0) {
            await connection.commit()
            return []
        }

        const placeholders = ids.map(() => '?').join(', ')
        await connection.execute(
            `
        UPDATE ${table}
        SET status = 'processing',
            claimed_at = UTC_TIMESTAMP(),
            claimed_by = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id IN (${placeholders})
      `,
            [workerId, ...ids]
        )

        const [claimedRows] = await connection.execute(
            `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
            ids
        )

        await connection.commit()
        return claimedRows || []
    } catch (error) {
        await connection.rollback()
        throw error
    }
}

async function reclaimStaleProcessingPostgres(connection, table, staleProcessingMinutes) {
    const result = await connection.query(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = NOW()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= NOW() - ($1 || ' minutes')::interval
      RETURNING id
    `,
        [staleProcessingMinutes]
    )
    return result.rowCount || 0
}

async function reclaimStaleProcessingMySql(connection, table, staleProcessingMinutes) {
    const [result] = await connection.execute(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
    `,
        [staleProcessingMinutes]
    )
    return result?.affectedRows || 0
}

async function upsertSummaryPostgres(connection, table, summaryRow) {
    const result = await connection.query(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        transcription_id,
        summary_style,
        status,
        summary_text,
        summary_payload_json,
        last_job_id,
        source_text_length,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        'ready',
        $5,
        $6,
        $7,
        $8,
        NOW(),
        NOW()
      )
    ON CONFLICT (domain, transcription_id, summary_style)
      DO UPDATE SET
        patient_id = EXCLUDED.patient_id,
        status = 'ready',
        summary_text = EXCLUDED.summary_text,
        summary_payload_json = EXCLUDED.summary_payload_json,
        last_job_id = EXCLUDED.last_job_id,
        source_text_length = EXCLUDED.source_text_length,
        updated_at = NOW()
      RETURNING id
    `,
        [
            summaryRow.domain,
            summaryRow.patientId,
            summaryRow.transcriptionId,
            summaryRow.summaryStyle,
            summaryRow.summaryText,
            JSON.stringify(summaryRow.payload),
            summaryRow.lastJobId,
            summaryRow.sourceTextLength,
        ]
    )

    return result?.rows?.[0]?.id || null
}

async function upsertSummaryMySql(connection, table, summaryRow) {
    const [result] = await connection.execute(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        transcription_id,
        summary_style,
        status,
        summary_text,
        summary_payload_json,
        last_job_id,
        source_text_length,
        created_at,
        updated_at
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        'ready',
        ?,
        ?,
        ?,
        ?,
        UTC_TIMESTAMP(),
        UTC_TIMESTAMP()
      )
    ON DUPLICATE KEY UPDATE
        patient_id = VALUES(patient_id),
        status = 'ready',
        summary_text = VALUES(summary_text),
        summary_payload_json = VALUES(summary_payload_json),
        last_job_id = VALUES(last_job_id),
        source_text_length = VALUES(source_text_length),
        updated_at = UTC_TIMESTAMP()
    `,
        [
            summaryRow.domain,
            summaryRow.patientId,
            summaryRow.transcriptionId,
            summaryRow.summaryStyle,
            summaryRow.summaryText,
            JSON.stringify(summaryRow.payload),
            summaryRow.lastJobId,
            summaryRow.sourceTextLength,
        ]
    )

    return result?.insertId || null
}

async function fetchTranscriptForSummaryPostgres(connection, domain, patientId, transcriptionId) {
    const params = [domain, patientId]
    let whereClause = 'WHERE t.domain = $1 AND t.patient_id = $2'

    if (Number.isFinite(Number(transcriptionId)) && Number(transcriptionId) > 0) {
        params.push(Number(transcriptionId))
        whereClause += ` AND t.id = $${params.length}`
    }

    const result = await connection.query(
        `
      SELECT
        t.id,
        t.domain,
        t.patient_id,
        t.status,
        t.transcript_text,
        t.metadata,
        t.created_at,
        t.updated_at,
        p.patient_name,
        p.metadata AS patient_metadata
      FROM patient_transcriptions t
      LEFT JOIN patients p
        ON p.id = t.patient_id
       AND p.domain = t.domain
      ${whereClause}
        AND COALESCE(t.transcript_text, '') <> ''
        AND t.status <> $${params.length + 1}
      ORDER BY COALESCE(t.updated_at, t.created_at) DESC
      LIMIT 1
    `,
        [...params, PENDING_DELETE_STATUS]
    )

    return result.rows?.[0] || null
}

async function fetchTranscriptForSummaryMySql(connection, domain, patientId, transcriptionId) {
    const params = [domain, patientId]
    let whereClause = 'WHERE t.domain = ? AND t.patient_id = ?'

    if (Number.isFinite(Number(transcriptionId)) && Number(transcriptionId) > 0) {
        params.push(Number(transcriptionId))
        whereClause += ' AND t.id = ?'
    }

    const [rows] = await connection.execute(
        `
      SELECT
        t.id,
        t.domain,
        t.patient_id,
        t.status,
        t.transcript_text,
        t.metadata,
        t.created_at,
        t.updated_at,
        p.patient_name,
        p.metadata AS patient_metadata
      FROM patient_transcriptions t
      LEFT JOIN patients p
        ON p.id = t.patient_id
       AND p.domain = t.domain
      ${whereClause}
        AND COALESCE(t.transcript_text, '') <> ''
        AND t.status <> ?
      ORDER BY COALESCE(t.updated_at, t.created_at) DESC
      LIMIT 1
    `,
        [...params, PENDING_DELETE_STATUS]
    )

    return rows?.[0] || null
}

function buildSummaryGenerationFingerprint({ transcriptText, scribeConfig, aiUsage }) {
    return createHash('sha256').update(JSON.stringify({
        transcriptText: cleanTranscriptText(transcriptText),
        summaryStyle: String(scribeConfig?.summaryStyle || DEFAULT_SCRIBE_SUMMARY_STYLE).trim().toLowerCase(),
        includeActionItems: scribeConfig?.includeActionItems !== false,
        workerPrompt: String(scribeConfig?.workerPrompt || '').trim(),
        additionalInstructions: String(scribeConfig?.additionalInstructions || '').trim(),
        model: String(aiUsage?.model || '').trim(),
        provider: String(aiUsage?.provider || '').trim().toLowerCase(),
        baseUrl: String(aiUsage?.baseUrl || '').trim(),
    })).digest('hex')
}

function buildSummaryGenerationLockKey(domain, transcriptionId, summaryStyle) {
    return `scribe:${String(domain || '').trim().toLowerCase()}:${Number(transcriptionId) || 0}:${String(summaryStyle || DEFAULT_SCRIBE_SUMMARY_STYLE).trim().toLowerCase()}`
}

async function tryAcquireSummaryGenerationLock(connection, dbType, lockKey) {
    if (dbType === 'postgresql') {
        const result = await connection.query(
            'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
            [lockKey]
        )
        return result?.rows?.[0]?.acquired === true
    }

    const mysqlLockKey = createHash('sha256').update(lockKey).digest('hex')
    const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [mysqlLockKey])
    return Number(rows?.[0]?.acquired) === 1
}

async function releaseSummaryGenerationLock(connection, dbType, lockKey) {
    if (dbType === 'postgresql') {
        await connection.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        return
    }

    const mysqlLockKey = createHash('sha256').update(lockKey).digest('hex')
    await connection.execute('SELECT RELEASE_LOCK(?)', [mysqlLockKey])
}

async function fetchStoredSummaryFingerprint(connection, dbType, table, domain, transcriptionId, summaryStyle) {
    if (dbType === 'postgresql') {
        const result = await connection.query(
            `SELECT summary_payload_json FROM ${table} WHERE domain = $1 AND transcription_id = $2 AND summary_style = $3 LIMIT 1`,
            [domain, transcriptionId, summaryStyle]
        )
        return String(parseJsonObject(result?.rows?.[0]?.summary_payload_json)?.generationFingerprint || '').trim()
    }

    const [rows] = await connection.execute(
        `SELECT summary_payload_json FROM ${table} WHERE domain = ? AND transcription_id = ? AND summary_style = ? LIMIT 1`,
        [domain, transcriptionId, summaryStyle]
    )
    return String(parseJsonObject(rows?.[0]?.summary_payload_json)?.generationFingerprint || '').trim()
}

async function generateAndPersistScribeSummary({ connection, dbType, summariesTable, row, payload, record, transcriptText, scribeConfig, generationFingerprint, domain, patientId }) {
    // Built from the transcript's own patient row, so the same block covers the notes the report
    // writer will later read.
    const identity = buildIdentityBlockFromPatient(
        { patient_name: record?.patient_name, metadata: parseJsonObject(record?.patient_metadata) },
        {}
    )
    let llmEvidenceFacts = null
    let llmFollowUps = null
    let llmTopics = null
    let llmBrief = ''
    let evidenceExtractorError = null
    try {
        const extracted = await generateTranscriptEvidenceWithOpenAi({
            transcriptText,
            identity,
            subjectNoun: resolveSubjectNoun({ fundingSource: identity.fundingSource }),
            style: scribeConfig.summaryStyle,
            model: payload?.aiUsage?.model,
            provider: payload?.aiUsage?.provider,
            baseUrl: payload?.aiUsage?.baseUrl,
            apiKey: payload?.aiUsage?.apiKey,
            workerPrompt: scribeConfig.workerPrompt,
            additionalInstructions: scribeConfig.additionalInstructions,
        })
        llmEvidenceFacts = extracted?.facts || null
        llmFollowUps = extracted?.followUps || null
        llmTopics = extracted?.topics || null
        llmBrief = extracted?.brief || ''
    } catch (error) {
        evidenceExtractorError = truncateText(error?.message || 'Transcript evidence extraction failed', 500)
    }

    const summary = buildTranscriptSummary(
        record,
        { ...payload, scribeConfig },
        { llmEvidenceFacts, llmFollowUps, llmTopics, llmBrief }
    )
    const workerPrompt = resolveScribeWorkerPrompt({ payload, scribeConfig })

    const summaryPayload = {
        ...summary,
        generationFingerprint,
        evidenceExtractorError,
        domain,
        patientId,
        patientName: String(record.patient_name || payload?.patientName || '').trim(),
        transcriptionId: Number(record.id),
        eventType: String(row?.event_type || payload?.eventType || 'transcript_completed').trim().toLowerCase(),
        requestedAction: String(row?.requested_action || payload?.requestedAction || 'summarize_transcript').trim().toLowerCase(),
        source: String(payload?.source || 'one:transcript-completed').trim() || 'one:transcript-completed',
        workerPrompt,
        scribeConfig,
        additionalInstructions: scribeConfig.additionalInstructions,
    }

    const upsertPayload = {
        domain,
        patientId,
        transcriptionId: Number(record.id),
        summaryText: summary.summaryText,
        summaryStyle: scribeConfig.summaryStyle,
        payload: summaryPayload,
        lastJobId: Number(row?.id || 0) || null,
        sourceTextLength: summary.sourceStats.transcriptChars,
    }

    if (dbType === 'postgresql') {
        await upsertSummaryPostgres(connection, summariesTable, upsertPayload)
    } else {
        await upsertSummaryMySql(connection, summariesTable, upsertPayload)
    }

    return { skipped: false }
}

async function processScribeJobLocally(connection, dbType, summariesTable, row, payload) {
    const domain = String(row?.domain || payload?.domain || '').trim().toLowerCase()
    const patientId = Number.parseInt(String(row?.patient_id || payload?.patientId || ''), 10)
    const transcriptionId = Number.parseInt(String(row?.transcription_id || payload?.transcriptionId || ''), 10)

    if (!domain) {
        throw new Error('Scribe job missing domain')
    }
    if (!Number.isFinite(patientId) || patientId <= 0) {
        throw new Error('Scribe job missing patient id')
    }

    const record = dbType === 'postgresql'
        ? await fetchTranscriptForSummaryPostgres(connection, domain, patientId, transcriptionId)
        : await fetchTranscriptForSummaryMySql(connection, domain, patientId, transcriptionId)

    if (!record) {
        throw new Error('No transcript found for scribe job')
    }

    const transcriptStatus = String(record.status || '').trim().toLowerCase()
    if (transcriptStatus !== 'completed') {
        throw new Error(`Transcript ${record.id} is not completed yet`)
    }

    const transcriptText = cleanTranscriptText(record.transcript_text || '')
    if (!transcriptText) {
        throw new Error(`Transcript ${record.id} has no text to summarize`)
    }

    const patientMetadata = parseJsonObject(record.patient_metadata)
    const scribeConfig = getScribeConfig(payload, patientMetadata)
    const enabled = isScribeAgentEnabled(patientMetadata, scribeConfig.summaryStyle)
    if (!enabled) {
        return { skipped: true, reason: scribeConfig.summaryStyle === OTF10_SCRIBE_SUMMARY_STYLE ? 'hsr-summariser-disabled' : 'scribe-disabled' }
    }

    const generationFingerprint = buildSummaryGenerationFingerprint({
        transcriptText,
        scribeConfig,
        aiUsage: payload?.aiUsage,
    })
    const lockKey = buildSummaryGenerationLockKey(domain, record.id, scribeConfig.summaryStyle)
    const lockAcquired = await tryAcquireSummaryGenerationLock(connection, dbType, lockKey)
    if (!lockAcquired) {
        return { skipped: true, reason: 'duplicate-generation-active' }
    }

    try {
        const storedFingerprint = await fetchStoredSummaryFingerprint(
            connection,
            dbType,
            summariesTable,
            domain,
            Number(record.id),
            scribeConfig.summaryStyle
        )
        if (storedFingerprint === generationFingerprint) {
            return { skipped: true, reason: 'duplicate-generation-completed' }
        }

        return await generateAndPersistScribeSummary({
            connection,
            dbType,
            summariesTable,
            row,
            payload,
            record,
            transcriptText,
            scribeConfig,
            generationFingerprint,
            domain,
            patientId,
        })
    } finally {
        await releaseSummaryGenerationLock(connection, dbType, lockKey)
    }
}

async function enqueueMissingScribeJobsPostgres(connection, queueTable, summariesTable, limit) {
    const result = await connection.query(
        `
            WITH candidates AS (
                SELECT t.id,
                       t.domain,
                       t.patient_id,
                       p.patient_name,
                       p.metadata AS patient_metadata,
                       t.transcript_text,
                       t.updated_at,
                       t.created_at
                FROM patient_transcriptions t
                JOIN patients p
                  ON p.id = t.patient_id
                 AND p.domain = t.domain
                LEFT JOIN ${summariesTable} s
                  ON s.domain = t.domain
                 AND s.transcription_id = t.id
                WHERE s.id IS NULL
                  AND COALESCE(t.transcript_text, '') <> ''
                  AND LOWER(COALESCE(t.status, '')) = 'completed'
                  AND (
                    p.metadata->'patientAgents'->>'scribe' = 'true'
                    OR p.metadata->'agents'->>'scribe' = 'true'
                  )
                  AND COALESCE(t.updated_at, t.created_at) <= NOW() - INTERVAL '5 minutes'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM ${queueTable} q
                    WHERE q.domain = t.domain
                      AND q.patient_id = t.patient_id
                      AND q.transcription_id = t.id
                      AND q.status IN ('queued', 'processing')
                  )
                ORDER BY COALESCE(t.updated_at, t.created_at) DESC
                LIMIT $1
            )
            INSERT INTO ${queueTable} (
                status,
                domain,
                patient_id,
                patient_name,
                transcription_id,
                event_type,
                requested_action,
                payload_json,
                attempts,
                created_at,
                updated_at
            )
            SELECT
                'queued',
                domain,
                patient_id,
                patient_name,
                id,
                'scribe_backfill',
                'summarize_transcript',
                json_build_object(
                    'domain', domain,
                    'patientId', patient_id,
                    'patientName', patient_name,
                    'transcriptionId', id,
                    'source', 'two:scribe-worker-backfill'
                )::text,
                0,
                NOW(),
                NOW()
            FROM candidates
            RETURNING id
        `,
        [limit]
    )

    return result.rowCount || 0
}

async function enqueueMissingScribeJobsMySql(connection, queueTable, summariesTable, limit) {
    const [result] = await connection.execute(
        `
            INSERT INTO ${queueTable} (
                status,
                domain,
                patient_id,
                patient_name,
                transcription_id,
                event_type,
                requested_action,
                payload_json,
                attempts,
                created_at,
                updated_at
            )
            SELECT
                'queued',
                candidate.domain,
                candidate.patient_id,
                candidate.patient_name,
                candidate.id,
                'scribe_backfill',
                'summarize_transcript',
                JSON_OBJECT(
                    'domain', candidate.domain,
                    'patientId', candidate.patient_id,
                    'patientName', candidate.patient_name,
                    'transcriptionId', candidate.id,
                    'source', 'two:scribe-worker-backfill'
                ),
                0,
                UTC_TIMESTAMP(),
                UTC_TIMESTAMP()
            FROM (
                SELECT t.id,
                       t.domain,
                       t.patient_id,
                       p.patient_name,
                       t.updated_at,
                       t.created_at
                FROM patient_transcriptions t
                JOIN patients p
                  ON p.id = t.patient_id
                 AND p.domain = t.domain
                LEFT JOIN ${summariesTable} s
                  ON s.domain = t.domain
                 AND s.transcription_id = t.id
                WHERE s.id IS NULL
                  AND COALESCE(t.transcript_text, '') <> ''
                  AND LOWER(COALESCE(t.status, '')) = 'completed'
                  AND (
                    LOWER(JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.patientAgents.scribe'))) = 'true'
                    OR LOWER(JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.agents.scribe'))) = 'true'
                  )
                  AND COALESCE(t.updated_at, t.created_at) <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM ${queueTable} q
                    WHERE q.domain = t.domain
                      AND q.patient_id = t.patient_id
                      AND q.transcription_id = t.id
                      AND q.status IN ('queued', 'processing')
                  )
                ORDER BY COALESCE(t.updated_at, t.created_at) DESC
                LIMIT ?
            ) candidate
        `,
        [limit]
    )

    return result?.affectedRows || 0
}

export async function runScribeWorkerCycle(options = {}) {
    const forceRun = options && typeof options === 'object' && options.forceRun === true
    const config = getConfig()
    if (!config.enabled && !forceRun) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') {
        return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }
    }

    const workerId = `two-scribe-worker-${process.pid}`
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureScribeQueueTable(connection, dbType, config.table)
        await ensureScribeSummariesTable(connection, dbType, config.summariesTable)

        const reclaimed = dbType === 'postgresql'
            ? await reclaimStaleProcessingPostgres(connection, config.table, config.staleProcessingMinutes)
            : await reclaimStaleProcessingMySql(connection, config.table, config.staleProcessingMinutes)

        const backfilled = dbType === 'postgresql'
            ? await enqueueMissingScribeJobsPostgres(connection, config.table, config.summariesTable, config.batchSize)
            : await enqueueMissingScribeJobsMySql(connection, config.table, config.summariesTable, config.batchSize)

        const claimed = dbType === 'postgresql'
            ? await claimMessagesPostgres(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)
            : await claimMessagesMySql(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)

        if (claimed.length === 0) {
            return {
                skipped: true,
                reason: reclaimed > 0 ? 'reclaimed-only' : 'empty',
                reclaimed,
                backfilled
            }
        }

        let completedCount = 0
        let failedCount = 0

        for (const row of claimed) {
            const attempts = Number(row.attempts || 0) + 1
            const maxAttempts = Number(row.max_attempts || config.defaultMaxAttempts)

            try {
                const payload = parsePayload(row)
                await processScribeJobLocally(connection, dbType, config.summariesTable, row, payload)

                if (dbType === 'postgresql') {
                    await markCompletedPostgres(connection, config.table, row.id)
                } else {
                    await markCompletedMySql(connection, config.table, row.id)
                }

                completedCount += 1
            } catch (error) {
                const nextRetrySeconds = getBackoffSeconds(attempts, config)
                const safeErrorMessage = truncateText(error?.message || 'Scribe worker failed')

                if (dbType === 'postgresql') {
                    await markFailedPostgres(connection, config.table, row.id, safeErrorMessage, attempts, maxAttempts, nextRetrySeconds)
                } else {
                    await markFailedMySql(connection, config.table, row.id, safeErrorMessage, attempts, maxAttempts, nextRetrySeconds)
                }

                failedCount += 1
            }
        }

        return {
            skipped: false,
            forced: forceRun,
            reclaimed,
            backfilled,
            claimed: claimed.length,
            completed: completedCount,
            failed: failedCount
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export function startScribeWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('SCRIBE_WORKER_ENABLED=false - scribe worker is disabled')
        return () => { }
    }

    console.log(`SCRIBE_WORKER_ENABLED=true - scribe worker started (table=${config.table}, poll=${config.pollSeconds}s, batch=${config.batchSize})`)
    console.log(`Scribe worker stale processing timeout: ${config.staleProcessingMinutes} minute(s)`)

    let timer = null
    let stopped = false

    const run = async () => {
        try {
            const result = await runScribeWorkerCycle()
            if (!result.skipped) {
                console.log(`[${new Date().toISOString()}] Scribe worker cycle: reclaimed=${result.reclaimed || 0}, claimed=${result.claimed}, completed=${result.completed}, failed=${result.failed}`)
            } else if ((result.reclaimed || 0) > 0) {
                console.log(`[${new Date().toISOString()}] Scribe worker cycle: reclaimed=${result.reclaimed}, no new scribe jobs claimed yet`)
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Scribe worker cycle failed: ${error?.message || error}`)
        }
    }

    const bootstrap = async () => {
        try {
            if (stopped) return

            await run()
            timer = setInterval(() => {
                run().catch(() => { })
            }, config.pollSeconds * 1000)
        } catch (error) {
            console.error(`[startup] Scribe worker did not start cycles: ${error?.message || error}`)
        }
    }

    bootstrap().catch(() => { })

    return () => {
        stopped = true
        if (timer) {
            clearInterval(timer)
        }
    }
}

export default {
    startScribeWorker,
    runScribeWorkerCycle
}

export const __testOnly = {
    FCA_SCRIBE_SUMMARY_STYLE,
    FCA_SECTION_TITLES,
    FCA_STRUCTURED_EVIDENCE_RULES,
    buildStructuredEvidenceFacts,
    buildActionItems,
    buildThirdPersonTopicBullets,
    buildTranscriptSummary,
    buildEvidenceUserInstructions,
    buildFcaEvidenceFact: formatFcaEvidenceFact,
    resolveStructuredEvidenceRules,
    normalizeLlmEvidenceFacts,
    normalizeLlmFollowUps,
    normalizeLlmTopics,
    normalizeLlmBrief,
    supportsCustomTemperature,
    buildSummaryGenerationFingerprint,
    buildSummaryGenerationLockKey,
    getScribeConfig,
    isScribeAgentEnabled,
}
