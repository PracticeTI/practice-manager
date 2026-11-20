// Display helpers for the patient record's Summary tab.
//
// The Transcript Summariser (two/src/lib/jobs/scribeWorker.js) stores one summary per transcript per
// style, and it writes two different text shapes:
//
//   generic  - "- Reports sliding of kitchen chairs." then "- Evidence (mobility): ... Functional
//              impact: ... Support implication: ..." on a single line
//   OTF10    - "- Area: mobility" followed by indented "Evidence:" / "Functional impact:" /
//              "Support implication:" lines
//
// Both report-specific styles also store the findings as `structuredEvidenceFacts`, which is the
// same data the FCA report builder consumes. Rendering those facts as labelled blocks avoids the
// run-on bullet the text shape produces (every field joined into one line) and avoids repeating the
// follow-ups that the Action items card already lists.

// Styles whose summary text IS the evidence block, so the structured facts are the summary.
export const STRUCTURED_SUMMARY_STYLES = ['otf10-home-services', 'fca-functional-capacity']

// Styles the Transcript Summariser can produce, in the order the patient Summary tab lists
// them. Labels live here so the Summary tab and the cross-patient documents index name the
// same style identically.
export const DEFAULT_SUMMARY_STYLE = 'topic-bullets-third-person'
export const SUMMARY_STYLE_LABELS = {
    [DEFAULT_SUMMARY_STYLE]: 'General Summary',
    'otf10-home-services': 'OTF10 Home Services',
    'fca-functional-capacity': 'FCA Functional Capacity',
}

// Domain labels for both vocabularies: the FCA report section ids (scribeWorker FCA_SECTION_TITLES)
// and the generic/OTF10 evidence rule domains (scribeWorker STRUCTURED_EVIDENCE_RULES).
export const EVIDENCE_DOMAIN_LABELS = {
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
    fatigue: 'Fatigue and Endurance',
    pain: 'Pain',
    mobility: 'Mobility and Falls Safety',
    'upper-limb-function': 'Upper-limb Function',
    cognition: 'Cognition and Executive Function',
    'domestic-function': 'Domestic Function',
    'community-access': 'Community Access',
    transport: 'Transport',
    supports: 'Supports and Caregiver Load',
    'planning-follow-up': 'Planning and Follow-up',
    general: 'General',
}

// Evidence line prefixes that carry a colon, so a topic bullet such as "Evidence suggests ..." is
// never mistaken for an evidence block. The marker may sit mid-line: the FCA text shape puts the
// section title on the bullet line and the `Evidence:` field after it ("- Personal Care and
// Activities of Daily Living Evidence: ..."), while OTF10 uses "- Area: mobility" followed by
// indented sub-fields.
const EVIDENCE_BLOCK_PATTERN = /(?:^|\s)(?:area|evidence(?:\s*\([^)]*\))?)\s*:/i
const FOLLOW_UP_PATTERN = /^follow[\s-]?ups?\s*:/i
const BULLET_PATTERN = /^[-*\u2022]\s+(.*)$/

export function normalizeSummaryStyleKey(value) {
    return String(value || '').trim().toLowerCase()
}

export function isStructuredSummaryStyle(summaryStyle) {
    return STRUCTURED_SUMMARY_STYLES.includes(normalizeSummaryStyleKey(summaryStyle))
}

/**
 * Human label for a stored summary style. An unlisted style still gets a readable label
 * (title-cased from its key) rather than disappearing from a list.
 */
export function describeSummaryStyleLabel(summaryStyle) {
    const style = normalizeSummaryStyleKey(summaryStyle)
    if (!style) return SUMMARY_STYLE_LABELS[DEFAULT_SUMMARY_STYLE]
    return SUMMARY_STYLE_LABELS[style]
        || style.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function describeEvidenceDomain(domain) {
    const key = normalizeSummaryStyleKey(domain)
    if (!key) return EVIDENCE_DOMAIN_LABELS.general
    return EVIDENCE_DOMAIN_LABELS[key]
        || key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function parseJsonValue(value) {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
        return JSON.parse(trimmed)
    } catch {
        return null
    }
}

/**
 * Normalize `summaryPayload.structuredEvidenceFacts` (object payload or raw JSON string) into the
 * fields the Summary tab renders. Entries without any text are dropped, and exact repeats of the
 * same finding in the same domain collapse to one block.
 *
 * @returns {Array<{ domain: string, label: string, observedIssue: string, functionalImpact: string, supportImplication: string }>}
 */
export function normalizeStructuredEvidenceFacts(summaryPayload) {
    const payload = parseJsonValue(summaryPayload)
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const rawFacts = parseJsonValue(source.structuredEvidenceFacts)
    if (!Array.isArray(rawFacts)) return []

    const seen = new Set()
    const facts = []
    for (const rawFact of rawFacts) {
        const item = rawFact && typeof rawFact === 'object' && !Array.isArray(rawFact) ? rawFact : null
        if (!item) continue

        const domain = normalizeSummaryStyleKey(item.domain) || 'general'
        const observedIssue = String(item.observedIssue || '').trim()
        const functionalImpact = String(item.functionalImpact || '').trim()
        const supportImplication = String(item.supportImplication || '').trim()
        if (!observedIssue && !functionalImpact && !supportImplication) continue

        const dedupeKey = `${domain}|${observedIssue.toLowerCase()}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)

        facts.push({ domain, label: describeEvidenceDomain(domain), observedIssue, functionalImpact, supportImplication })
    }
    return facts
}

/**
 * Group normalized facts by domain, keeping the order the summariser emitted them in.
 *
 * @returns {Array<{ key: string, domain: string, label: string, items: Array<object> }>}
 */
export function groupEvidenceFactsByDomain(facts) {
    const groups = []
    const byDomain = new Map()
    for (const fact of Array.isArray(facts) ? facts : []) {
        if (!fact || typeof fact !== 'object') continue
        const domain = normalizeSummaryStyleKey(fact.domain) || 'general'
        let group = byDomain.get(domain)
        if (!group) {
            group = { key: domain, domain, label: fact.label || describeEvidenceDomain(domain), items: [] }
            byDomain.set(domain, group)
            groups.push(group)
        }
        group.items.push(fact)
    }
    return groups
}

/**
 * Split stored summary text into ordered items so callers can keep one shape and drop another.
 * Continuation lines (OTF10 sub-fields) belong to the item above them; a blank line ends the item
 * rather than being glued to it, so prose summaries keep their paragraphs.
 *
 * @returns {{ items: Array<{ kind: 'topic'|'evidence'|'followUp', text: string }>, topicLines: string[], evidenceLines: string[], followUpLines: string[] }}
 */
export function splitScribeSummaryText(summaryText) {
    const items = []
    let current = null

    const flush = () => {
        if (!current) return
        // Classify on the assembled item, not on the bullet's first line: the FCA shape only reveals
        // its `Evidence:` marker once the indented sub-fields have been joined in.
        const text = current.text.trim()
        if (text) items.push({ kind: classifySummaryLine(text), text })
        current = null
    }

    for (const rawLine of String(summaryText || '').split('\n')) {
        const line = String(rawLine || '').trim()
        if (!line) {
            flush()
            continue
        }

        const bulletMatch = line.match(BULLET_PATTERN)
        if (bulletMatch) {
            flush()
            current = { text: bulletMatch[1].trim() }
            continue
        }

        if (current) {
            current.text = `${current.text} ${line}`.trim()
            continue
        }

        current = { text: line }
    }
    flush()

    return {
        items,
        topicLines: items.filter((item) => item.kind === 'topic').map((item) => item.text),
        evidenceLines: items.filter((item) => item.kind === 'evidence').map((item) => item.text),
        followUpLines: items.filter((item) => item.kind === 'followUp').map((item) => item.text),
    }
}

function classifySummaryLine(text) {
    const line = String(text || '').trim()
    if (FOLLOW_UP_PATTERN.test(line)) return 'followUp'
    if (EVIDENCE_BLOCK_PATTERN.test(line)) return 'evidence'
    return 'topic'
}
