// Shared presentation helpers for the FCA Analyst panel. Pure and client-safe so the Analysis tab
// can state what an analysis was actually built from - in particular whether the reference
// documents in scope were used - without re-deriving the payload shape inside JSX.
//
// Two different questions live here and they must not be conflated:
//   1. Was a document in scope for the run?  -> `sourceStats.documentIds` (what the analyst was given)
//   2. Did the analyst use it?               -> facts carrying `source: 'document'` (what it kept)
// A letter can sit in scope and contribute nothing, and that is exactly what the panel has to say.

const DOCUMENT_SOURCE = 'document'

export const ANALYSIS_DOCUMENT_TONES = {
    none: 'none',
    used: 'used',
    unused: 'unused',
}

function formatCount(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number.toLocaleString('en-AU') : '0'
}

/**
 * Describe the reference-document contribution of a stored analysis.
 *
 * `recorded` distinguishes "the analyst had no documents" from "this analysis predates document
 * support": only the v2 analyst writes `documentIds`, so an absent key means unknown, not empty.
 */
export function summarizeAnalysisDocuments({ sourceStats, facts } = {}) {
    const recorded = Array.isArray(sourceStats?.documentIds)
    const ids = recorded ? sourceStats.documentIds : []
    const names = (Array.isArray(sourceStats?.documentNames) ? sourceStats.documentNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)
    const totalChars = Number(sourceStats?.documentLength || 0) > 0 ? Number(sourceStats.documentLength) : 0

    const documentFacts = (Array.isArray(facts) ? facts : []).filter(
        (fact) => String(fact?.source || '').trim() === DOCUMENT_SOURCE
    )
    const factDomains = [
        ...new Set(documentFacts.map((fact) => String(fact?.domain || '').trim()).filter(Boolean)),
    ]

    const base = {
        recorded,
        count: ids.length,
        names,
        totalChars,
        factCount: documentFacts.length,
        factDomains,
    }

    if (!recorded) {
        return { ...base, tone: ANALYSIS_DOCUMENT_TONES.none, summaryLabel: '', title: '' }
    }

    const count = ids.length
    const factCount = documentFacts.length
    const named = names.length > 0 ? names.join(', ') : `${formatCount(count)} document(s)`

    if (count === 0) {
        return {
            ...base,
            tone: ANALYSIS_DOCUMENT_TONES.none,
            summaryLabel: 'no reference documents',
            title: 'The analyst had no reference documents in scope for this analysis.',
        }
    }

    if (factCount === 0) {
        return {
            ...base,
            tone: ANALYSIS_DOCUMENT_TONES.unused,
            summaryLabel: `${count} reference document(s) · no findings from them`,
            title: `Reference documents the analyst read: ${named}. No finding is attributed to a document, so a document can be in scope without reaching the report.`,
        }
    }

    const readLabel = totalChars > 0
        ? `Reference documents the analyst read: ${named} (${formatCount(totalChars)} characters).`
        : `Reference documents the analyst read: ${named}.`

    return {
        ...base,
        tone: ANALYSIS_DOCUMENT_TONES.used,
        summaryLabel: `${count} reference document(s) · ${formatCount(factCount)} finding(s) from them`,
        title: `${readLabel} ${formatCount(factCount)} finding(s) are attributed to a document (${factDomains.join(', ')}).`,
    }
}
