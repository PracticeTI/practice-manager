// Evidence scope for the FCA report: what the stored analysis covers, and whether it still covers it.
//
// Once the FCA Analyst is on for a patient, the report leads with the analyst's section evidence
// rather than re-deriving everything from the raw record. That only holds together if the analysis
// was built from the same record the report is about to write from - so the report defers while the
// analysis is missing or stale, instead of quietly citing findings from notes that have since changed.
//
// Pure: no database, no model. See `reportWorker.js` for the loading and the gate.

/**
 * Marker that starts a per-file section in the queue's `additionalContext`.
 *
 * Mirrors `ATTACHMENT_SECTION_PREFIX` in `one/src/lib/fcaAttachments.js`; the `file:<id>` suffix of
 * the header line is how a block is matched back to a stored file.
 */
const ATTACHMENT_SECTION_PREFIX = '=== Attached file:'

const ATTACHMENT_FILE_ID_PATTERN = /file:([^|\s=]+)\s*=+\s*$/

function normalizeCount(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeDocumentId(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * The inputs an analysis was built from.
 *
 * Recorded on the analysis as `sourceStats`, and rebuilt for the report from the record in hand, so
 * the two can be compared. Documents are compared by id and order-insensitively: a set of documents
 * is the same evidence regardless of which file was uploaded first.
 */
export function buildAnalysisSourceFingerprint({ notesLength, transcriptCount, transcriptSummaryCount, documentIds } = {}) {
    const ids = (Array.isArray(documentIds) ? documentIds : [])
        .map(normalizeDocumentId)
        .filter((id) => id !== null)

    return {
        notesLength: normalizeCount(notesLength),
        transcriptCount: normalizeCount(transcriptCount),
        transcriptSummaryCount: normalizeCount(transcriptSummaryCount),
        documentIds: [...new Set(ids)].sort((left, right) => left - right),
    }
}

/**
 * Compare a stored analysis against the record the report is about to use.
 *
 * Every difference is reported, not just the first: a clinician deciding whether to re-run the
 * analyst needs to know what changed.
 */
export function describeAnalysisStaleness({ analysis, current } = {}) {
    const sourceStats = analysis?.sourceStats && typeof analysis.sourceStats === 'object' && !Array.isArray(analysis.sourceStats)
        ? analysis.sourceStats
        : null

    if (!sourceStats) {
        return { stale: true, reasons: ['no analysis has been run for this patient'] }
    }

    const recorded = buildAnalysisSourceFingerprint(sourceStats)
    const next = buildAnalysisSourceFingerprint(current)
    const reasons = []

    if (recorded.notesLength !== next.notesLength) {
        reasons.push(`the notes changed (${recorded.notesLength} -> ${next.notesLength} characters)`)
    }
    if (recorded.transcriptCount !== next.transcriptCount) {
        reasons.push(`the transcript count changed (${recorded.transcriptCount} -> ${next.transcriptCount})`)
    }
    if (recorded.transcriptSummaryCount !== next.transcriptSummaryCount) {
        reasons.push(`the transcript summary count changed (${recorded.transcriptSummaryCount} -> ${next.transcriptSummaryCount})`)
    }
    if (recorded.documentIds.join(',') !== next.documentIds.join(',')) {
        reasons.push(
            `the documents in evidence scope changed ([${recorded.documentIds.join(', ')}] -> [${next.documentIds.join(', ')}])`
        )
    }

    return { stale: reasons.length > 0, reasons }
}

/** Whether the FCA Analyst agent is switched on for a patient's metadata. */
export function isFcaAnalystEnabled(metadata) {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null
    if (!source) return false

    // Same shape order as the rest of the app: the modern `patientAgents` container wins, and the
    // legacy `agents` container is only read when it is absent.
    for (const key of ['patientAgents', 'agents']) {
        const agents = source[key]
        if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
            return agents.analyst === true || agents.analysis === true
        }
    }

    return false
}

/**
 * Which in-scope documents the analysis captured the *specifics* of.
 *
 * Only these are safe to drop from the report corpus. A document the analyst merely read - and
 * summarised into findings that carry no recorded detail - still holds measures, scores and
 * equipment lists that the report would otherwise lose, and losing them is the whole risk of routing
 * a document through the analyst instead of attaching it.
 *
 * The match is by exact file name against each fact's `sourceName`, and that fact must also record
 * `evidenceDetail`. An analysis without provenance suppresses nothing rather than guessing.
 */
export function resolveAnalystCapturedDocumentIds(analysisPayload) {
    const sourceStats = analysisPayload?.sourceStats
    const ids = Array.isArray(sourceStats?.documentIds) ? sourceStats.documentIds : []
    const names = Array.isArray(sourceStats?.documentNames) ? sourceStats.documentNames : []
    if (ids.length === 0 || names.length === 0) return []

    const capturedNames = new Set()
    const facts = Array.isArray(analysisPayload?.structuredEvidenceFacts) ? analysisPayload.structuredEvidenceFacts : []
    for (const fact of facts) {
        const name = String(fact?.sourceName || '').trim().toLowerCase()
        const detail = String(fact?.evidenceDetail || '').trim()
        if (name && detail) capturedNames.add(name)
    }
    if (capturedNames.size === 0) return []

    const captured = []
    for (let index = 0; index < ids.length; index += 1) {
        const name = String(names[index] || '').trim().toLowerCase()
        if (!name || !capturedNames.has(name)) continue
        const id = normalizeDocumentId(ids[index])
        if (id !== null) captured.push(id)
    }

    return captured
}

/** Split an `additionalContext` block into its preamble and its per-file sections. */
export function splitAttachmentContextBlocks(additionalContext) {
    const preamble = []
    const blocks = []
    let current = null

    for (const line of String(additionalContext || '').replace(/\r\n?/g, '\n').split('\n')) {
        if (line.startsWith(ATTACHMENT_SECTION_PREFIX)) {
            current = { header: line, lines: [] }
            blocks.push(current)
            continue
        }
        if (!current) {
            preamble.push(line)
            continue
        }
        current.lines.push(line)
    }

    return { preamble: preamble.join('\n').trim(), blocks }
}

function renderAttachmentBlock(block) {
    return [block.header, ...block.lines].join('\n').trim()
}

/**
 * Drop the attached documents the analyst already read, so the same document does not reach the
 * report twice - once as raw text and once as the facts derived from it.
 *
 * Only documents that are actually in the analyst's evidence scope are removed, and only when the
 * caller has a fresh analysis to replace them with. A document that is attached but *not* in scope
 * is the analyst's blind spot, so it stays.
 */
export function suppressAnalystScopedAttachments(additionalContext, documentIds = []) {
    const text = String(additionalContext || '')
    if (!text.trim()) return { text: '', suppressed: [] }

    const scoped = new Set(
        (Array.isArray(documentIds) ? documentIds : [])
            .map((id) => String(normalizeDocumentId(id) ?? '').trim())
            .filter(Boolean)
    )
    if (scoped.size === 0) return { text, suppressed: [] }

    const { preamble, blocks } = splitAttachmentContextBlocks(text)
    const kept = []
    const suppressed = []

    for (const block of blocks) {
        const match = ATTACHMENT_FILE_ID_PATTERN.exec(String(block.header || ''))
        const fileId = match ? String(match[1]).trim() : ''
        if (fileId && scoped.has(fileId)) {
            suppressed.push(String(block.header || '').trim())
            continue
        }
        kept.push(renderAttachmentBlock(block))
    }

    return {
        text: [preamble, ...kept].filter(Boolean).join('\n\n'),
        suppressed,
    }
}
