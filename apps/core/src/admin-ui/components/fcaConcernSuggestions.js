// Step 4 "Current Concerns" suggestion sources.
//
// The catalog below is the single source of truth for the concern labels Step 4 offers. Two passes
// read it: the builder's own scrape of the clinical notes (`extractNotesData`) and the FCA Analyst
// evidence pass (`extractConcernsFromAnalysisPayload`). Keeping one catalog means the vocabulary
// cannot drift between the two.
const CONCERN_PATTERNS = [
    { pattern: /fatigue/i, concern: 'Fatigue/energy limitations' },
    { pattern: /fine motor|hand|tremor|precision/i, concern: 'Fine motor coordination difficulties' },
    { pattern: /walking|mobility|legs|gait/i, concern: 'Mobility limitations' },
    { pattern: /cognitive|brain fog|memory/i, concern: 'Cognitive impairment' },
    { pattern: /pain|neuropathic/i, concern: 'Pain management' },
    { pattern: /speech|communication|speaking/i, concern: 'Communication difficulties' },
    { pattern: /temperature|heat/i, concern: 'Temperature regulation issues' },
    { pattern: /self-care|adt|grooming|dressing/i, concern: 'Self-care support needed' },
    { pattern: /stairs|ramps?|access|modification/i, concern: 'Home access barriers' },
    { pattern: /community|social|participation/i, concern: 'Community participation limitations' },
]

// Analyst groups whose evidence describes functional limitation rather than, say, goals.
const ANALYSIS_EVIDENCE_GROUP_KEYS = new Set(['supports', 'recommendations', 'interventions', 'concerns', 'functional'])

function normalizeSuggestionValue(value) {
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim()
}

// Labels, in catalog order, for any concern keyword the text mentions.
function extractConcernLabels(text) {
    const haystack = String(text || '').toLowerCase()
    if (!haystack) return []

    const labels = []
    for (const { pattern, concern } of CONCERN_PATTERNS) {
        if (labels.includes(concern)) continue
        if (pattern.test(haystack)) labels.push(concern)
    }

    return labels
}

// The sentences the FCA Analyst used to justify each support, plus its justification text. Those are
// already the function-relevant subset of the notes, so they are a better concern source than a raw
// scrape of the whole corpus.
function collectAnalysisEvidenceText(analysisPayload) {
    const texts = []

    const push = (value) => {
        const text = normalizeSuggestionValue(value)
        if (text) texts.push(text)
    }

    const pushItem = (item) => {
        if (typeof item === 'string') {
            push(item)
            return
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) return

        push(item.justification || item.reason)
        for (const evidence of Array.isArray(item.evidence) ? item.evidence : []) push(evidence)
    }

    for (const key of ['recommendedInterventions', 'addressedInterventions']) {
        for (const item of Array.isArray(analysisPayload?.[key]) ? analysisPayload[key] : []) pushItem(item)
    }

    // Legacy grouped shape: [{ key: 'supports', evidence: [...] }]. Payloads written before the
    // structured arrays existed carry their evidence here instead.
    for (const group of Array.isArray(analysisPayload?.suggestions) ? analysisPayload.suggestions : []) {
        const groupKey = String(group?.key || '').trim().toLowerCase()
        if (!ANALYSIS_EVIDENCE_GROUP_KEYS.has(groupKey)) continue
        for (const evidence of Array.isArray(group?.evidence) ? group.evidence : []) push(evidence)
    }

    return texts
}

function extractConcernsFromAnalysisPayload(analysisPayload) {
    const evidenceText = collectAnalysisEvidenceText(analysisPayload).join('\n')
    return extractConcernLabels(evidenceText)
}

// Analyst suggestions lead (they come from curated evidence); the note scrape follows so the
// clinician still sees every candidate the notes support.
function mergeConcernSuggestions(noteSuggestions, analysisSuggestions) {
    const merged = []
    const seen = new Set()

    for (const source of [analysisSuggestions, noteSuggestions]) {
        for (const value of Array.isArray(source) ? source : []) {
            const candidate = normalizeSuggestionValue(value)
            if (!candidate) continue
            const key = candidate.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(candidate)
        }
    }

    return merged
}

/**
 * Build the Step 4 form value from the merged suggestions.
 *
 * Additive by design: everything the clinician already listed is kept, and every suggestion they
 * have not listed is added. The earlier prefill wrote only the first three suggestions into three
 * fixed slots, which silently dropped the analyst's remaining concerns and let the selected set
 * change on its own when the analyst's evidence changed - a saved draft could move from
 * `[Fatigue, Mobility, Home access barriers]` to `[Fatigue, Mobility, Cognitive impairment]`,
 * losing a concern the clinician never removed. Concerns are a closed catalog of labels, so an
 * additive prefill cannot lose free text, and any of them can still be removed afterwards.
 */
function buildConcernPrefill(prevConcerns, suggestions) {
    const existing = (Array.isArray(prevConcerns) ? prevConcerns : []).map((value) => String(value || '').trim())
    const merged = existing.filter(Boolean)
    const seen = new Set(merged.map((value) => value.toLowerCase()))

    for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
        const candidate = normalizeSuggestionValue(suggestion)
        if (!candidate) continue
        const key = candidate.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(candidate)
    }

    return merged.length > 0 ? merged : existing
}

export {
    extractConcernLabels,
    extractConcernsFromAnalysisPayload,
    mergeConcernSuggestions,
    buildConcernPrefill,
}
