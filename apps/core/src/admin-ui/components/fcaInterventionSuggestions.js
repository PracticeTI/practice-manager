function normalizeInterventionCandidate(value) {
    if (typeof value !== 'string') return ''
    return value.replace(/\s+/g, ' ').trim()
}

function normalizeInterventionRecommendation(value) {
    if (typeof value === 'string') {
        const intervention = normalizeInterventionCandidate(value)
        return intervention ? { intervention, justification: '' } : null
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    const intervention = normalizeInterventionCandidate(value.intervention || value.label || value.name)
    if (!intervention) return null

    return {
        intervention,
        justification: normalizeInterventionCandidate(value.justification || value.reason),
    }
}

function normalizeInterventionList(values) {
    const normalized = []
    const seen = new Set()

    for (const value of Array.isArray(values) ? values : []) {
        const candidate = normalizeInterventionCandidate(value)
        if (!candidate) continue
        const lowered = candidate.toLowerCase()
        if (seen.has(lowered)) continue
        seen.add(lowered)
        normalized.push(candidate)
    }

    return normalized
}

function normalizeInterventionRecommendations(values) {
    const normalized = []
    const seen = new Set()

    for (const value of Array.isArray(values) ? values : []) {
        const candidate = normalizeInterventionRecommendation(value)
        if (!candidate) continue

        const lowered = candidate.intervention.toLowerCase()
        if (seen.has(lowered)) {
            const existing = normalized.find((item) => item.intervention.toLowerCase() === lowered)
            if (existing && !existing.justification && candidate.justification) {
                existing.justification = candidate.justification
            }
            continue
        }

        seen.add(lowered)
        normalized.push(candidate)
    }

    return normalized
}

function titleCasePhrase(value) {
    return String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

function buildFallbackRecommendation(candidate, evidenceText) {
    const intervention = normalizeInterventionCandidate(candidate)
    if (!intervention) return null

    return {
        intervention,
        justification: normalizeInterventionCandidate(evidenceText),
    }
}

function extractRecommendationsFromLegacySuggestions(analysisPayload) {
    const suggestions = Array.isArray(analysisPayload?.suggestions) ? analysisPayload.suggestions : []
    const extracted = []
    const knownPatterns = [
        { canonical: 'Occupational therapy', pattern: /\boccupational therapy\b/i },
        { canonical: 'Physiotherapy', pattern: /\bphysiotherapy\b/i },
        { canonical: 'Speech pathology', pattern: /\bspeech pathology\b/i },
        { canonical: 'Home modifications', pattern: /\bhome modifications\b/i },
        { canonical: 'Assistive technology', pattern: /\bassistive technology\b/i },
        { canonical: 'Personal care support', pattern: /\bpersonal care support\b/i },
        { canonical: 'Community access support', pattern: /\bcommunity access support\b/i },
        { canonical: 'Psychosocial support', pattern: /\bpsychosocial support\b/i },
        { canonical: 'Pain management strategies', pattern: /\bpain management strategies\b/i },
        { canonical: 'Mobility equipment', pattern: /\bmobility equipment\b/i },
        { canonical: 'Mobility support', pattern: /\bmobility support\b/i },
    ]

    for (const group of suggestions) {
        const groupKey = String(group?.key || '').trim().toLowerCase()
        const evidenceItems = Array.isArray(group?.evidence) ? group.evidence : []

        if (!['supports', 'recommendations', 'interventions'].includes(groupKey)) {
            continue
        }

        for (const evidenceItem of evidenceItems) {
            const text = normalizeInterventionCandidate(evidenceItem)
            if (!text) continue

            for (const patternEntry of knownPatterns) {
                if (patternEntry.pattern.test(text)) {
                    extracted.push(buildFallbackRecommendation(patternEntry.canonical, text))
                }
            }
        }
    }

    return normalizeInterventionRecommendations(extracted)
}

function extractInterventionRecommendationsFromAnalysisPayload(analysisPayload) {
    const directRecommendations = normalizeInterventionRecommendations(analysisPayload?.recommendedInterventions)
    if (directRecommendations.length > 0) {
        return directRecommendations
    }

    return extractRecommendationsFromLegacySuggestions(analysisPayload)
}

function extractInterventionSuggestionsFromAnalysisPayload(analysisPayload) {
    return extractInterventionRecommendationsFromAnalysisPayload(analysisPayload).map((item) => item.intervention)
}

// The FCA Analyst also identifies supports that are already in place (see
// `addressedInterventions` in two/src/lib/jobs/analysisWorker.js). Unlike recommendations there is
// no legacy fallback source for these - an empty/missing array just means nothing was identified.
function extractAddressedInterventionsFromAnalysisPayload(analysisPayload) {
    return normalizeInterventionRecommendations(analysisPayload?.addressedInterventions)
}

// Analyst suggestions lead (they come from structured, curated evidence); the note-derived list
// follows as coverage. Keep this order in step with `mergeConcernSuggestions` in
// fcaConcernSuggestions.js.
function mergeInterventionSuggestions(noteSuggestions, analysisSuggestions) {
    const normalizedAnalysis = normalizeInterventionRecommendations(analysisSuggestions).map((item) => item.intervention)

    return normalizeInterventionList([
        ...normalizedAnalysis,
        ...noteSuggestions,
    ])
}

export {
    extractAddressedInterventionsFromAnalysisPayload,
    extractInterventionRecommendationsFromAnalysisPayload,
    extractInterventionSuggestionsFromAnalysisPayload,
    mergeInterventionSuggestions,
}
