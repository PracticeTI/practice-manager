import { REPORT_WORDS_PER_PAGE_ESTIMATE } from '../../lib/reportPageMetrics.js'

/** Report style labels, mirroring the worker's `FCA_REPORT_STYLES`. */
const FCA_REPORT_STYLE_LABELS = {
    standard: 'Standard',
    extended: 'Extended',
}

function resolveStyleLabel(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return FCA_REPORT_STYLE_LABELS[normalized] || FCA_REPORT_STYLE_LABELS.standard
}

export function buildFcaQueueSummary({ patientName, formData, sectionPlan, transcriptSummary, fileCount }) {
    const safePatientName = String(patientName || '').trim() || 'the selected participant'
    const safeFormData = formData && typeof formData === 'object' && !Array.isArray(formData) ? formData : {}
    const safeTranscripts = transcriptSummary && typeof transcriptSummary === 'object' && !Array.isArray(transcriptSummary)
        ? transcriptSummary
        : null
    const estimatedWords = (Array.isArray(sectionPlan) ? sectionPlan : []).reduce((total, section) => {
        const sectionWords = Number(section?.minWords)
        return total + (Number.isFinite(sectionWords) ? sectionWords : 0)
    }, 0)
    // No floor: a floor was standing in for a page size, and it made every short report claim 15
    // pages. The page size now comes from the same metrics the preview and the DOCX use.
    const estimatedPages = Math.max(1, Math.ceil(estimatedWords / REPORT_WORDS_PER_PAGE_ESTIMATE))
    const inclusionItems = [
        'Executive summary for the NDIA planner',
        'Participant details and demographics',
        'Background and relevant history',
        'Current concerns and functional impacts',
        'Diagnosis and medical context',
        'Functional capacity assessment',
        'Interventions and support recommendations',
        'Goals and objectives',
    ]

    // The clinician's steering notes are direction rather than report content, so they are reported
    // alongside the evidence rather than as a section the report will contain.
    const steeringApplied = Boolean(String(safeFormData.additionalNotes || '').trim())
    const styleLabel = resolveStyleLabel(safeFormData.reportStyle)

    // What the builder is actually sending, so the review step shows which stored data is in play
    // rather than only listing report sections.
    const evidenceItems = []
    const totalTranscripts = Number(safeTranscripts?.totalCount) || 0
    if (totalTranscripts > 0) {
        const includedTranscripts = Number(safeTranscripts?.includedCount) || 0
        evidenceItems.push(`${includedTranscripts} of ${totalTranscripts} stored transcript${totalTranscripts === 1 ? '' : 's'} included`)

        const editedCount = Number(safeTranscripts?.editedCount) || 0
        if (editedCount > 0) {
            evidenceItems.push(`${editedCount} summar${editedCount === 1 ? 'y' : 'ies'} edited for this report`)
        }
    }

    const safeFileCount = Number(fileCount) || 0
    if (safeFileCount > 0) {
        evidenceItems.push(`${safeFileCount} attached file${safeFileCount === 1 ? '' : 's'}`)
    }

    const pendingEvidenceCount = Number(safeTranscripts?.pendingEvidenceCount) || 0
    const pendingNote = pendingEvidenceCount > 0
        ? ` ${pendingEvidenceCount} transcript summar${pendingEvidenceCount === 1 ? 'y is' : 'ies are'} still being prepared, so the job will wait and start automatically once they are ready.`
        : ''

    return {
        recipient: safePatientName,
        purpose: 'A comprehensive NDIS Functional Capacity Assessment report for plan review, support planning, and clinical decision-making.',
        inclusions: inclusionItems,
        evidenceItems,
        estimatedWords,
        estimatedPages,
        estimatedPagesLabel: `${estimatedPages} A4 page${estimatedPages === 1 ? '' : 's'}`,
        styleLabel,
        steeringApplied,
        queueNote: `The report will be queued in the background and generated at ${styleLabel} length from ${safePatientName === 'the selected participant' ? 'the builder inputs' : safePatientName}'s builder inputs, any linked notes, and the configured FCA prompt setup.${pendingNote}`,
    }
}
