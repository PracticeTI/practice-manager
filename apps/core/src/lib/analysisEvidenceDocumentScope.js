// Which reference documents an FCA Analyst run is built from, and how much of them it reads.
//
// Pure policy only - no database, no DOCX reader - so it can be unit tested and imported from
// anywhere. The server half (reading flagged `patient_files` rows and extracting their text) lives
// in `analysisEvidenceDocuments.js`, the same split as `fcaAttachments.js` / `attachmentText.js`.

/**
 * Per-document text cap for the analyst.
 *
 * Matches the report's `MAX_ATTACHMENT_TEXT_CHARS` (60,000), so attaching a document and routing it
 * through the analyst read the same slice of it. The analyst's advantage is not a bigger slice but
 * summarisation: it turns that slice into section-tagged findings instead of leaving raw prose to
 * compete for sentence slots at report time.
 */
export const MAX_ANALYSIS_DOCUMENT_TEXT_CHARS = 60000

/** Combined budget for every document in scope, matching the notes/transcript source cap. */
export const MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS = 120000

/** Every document in scope, as the analyst job payload carries it. */
export function normalizeAnalysisDocuments(documents, { maxTotalChars = MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS } = {}) {
    const budget = Number.isFinite(Number(maxTotalChars)) && Number(maxTotalChars) > 0
        ? Number(maxTotalChars)
        : MAX_ANALYSIS_DOCUMENT_CONTEXT_CHARS

    const normalized = []
    let remaining = budget

    for (const document of Array.isArray(documents) ? documents : []) {
        if (!document || typeof document !== 'object' || Array.isArray(document)) continue
        const text = String(document.text || '').trim()
        if (!text) continue
        // Kept whole or dropped: a document cut at an arbitrary point is worse than an absent one,
        // because the model cannot tell what it is missing. The prompt applies the final combined
        // cap with its own explicit truncation note.
        if (text.length > remaining) continue

        remaining -= text.length
        normalized.push({
            id: document.id ?? null,
            fileName: String(document.fileName || 'reference document').trim() || 'reference document',
            text,
            truncated: document.truncated === true,
            originalLength: Number.isFinite(Number(document.originalLength))
                ? Number(document.originalLength)
                : text.length,
        })
    }

    return normalized
}
