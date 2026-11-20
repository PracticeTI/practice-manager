// Browser-safe helpers for the FCA builder's transcript step.
//
// Only sibling browser-safe modules may be imported here (relative paths, never the `@/` alias)
// so the node test runner can load it directly, following the src/lib/fcaAttachments.js
// convention.
//
// The shape written here is read back by `resolveTranscriptSelection` in
// two/src/lib/jobs/fcaReportGeneration.js, so the two must stay in step:
//
//   formData.transcriptSelection = {
//       excludedIds: ['34'],
//       summaryOverrides: { '33': 'edited summary text' },
//   }

import { formatAttachmentDate, isRecordingFile } from './fcaAttachments.js'

// Must match FCA_SCRIBE_SUMMARY_STYLE in two/src/lib/jobs/scribeWorker.js.
export const FCA_SUMMARY_STYLE = 'fca-functional-capacity'

function toIdString(value) {
    return String(value ?? '').trim()
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function normalizeTranscriptSelection(raw) {
    const source = safeObject(raw)

    const excludedIds = [...new Set(
        (Array.isArray(source.excludedIds) ? source.excludedIds : [])
            .map(toIdString)
            .filter(Boolean)
    )]

    const summaryOverrides = {}
    const rawOverrides = safeObject(source.summaryOverrides)
    for (const [key, value] of Object.entries(rawOverrides)) {
        const id = toIdString(key)
        const text = String(value ?? '')
        // An override that is only whitespace is the same as no override, so it is dropped rather
        // than persisted and sent to the worker as empty evidence.
        if (id && text.trim()) summaryOverrides[id] = text
    }

    return { excludedIds, summaryOverrides }
}

export function isTranscriptIncluded(raw, id) {
    const key = toIdString(id)
    if (!key) return false
    return !normalizeTranscriptSelection(raw).excludedIds.includes(key)
}

export function setTranscriptIncluded(raw, id, included) {
    const normalized = normalizeTranscriptSelection(raw)
    const key = toIdString(id)
    if (!key) return normalized

    const excludedIds = included
        ? normalized.excludedIds.filter((item) => item !== key)
        : [...new Set([...normalized.excludedIds, key])]

    return { ...normalized, excludedIds }
}

export function setTranscriptsIncluded(raw, ids, included) {
    let next = normalizeTranscriptSelection(raw)
    for (const id of Array.isArray(ids) ? ids : []) {
        next = setTranscriptIncluded(next, id, included)
    }
    return next
}

export function setTranscriptSummaryOverride(raw, id, text) {
    const normalized = normalizeTranscriptSelection(raw)
    const key = toIdString(id)
    if (!key) return normalized

    const summaryOverrides = { ...normalized.summaryOverrides }
    if (String(text ?? '').trim()) {
        summaryOverrides[key] = text
    } else {
        delete summaryOverrides[key]
    }

    return { ...normalized, summaryOverrides }
}

/**
 * Whether a stored transcript title is really a recording filename rather than a human label.
 * Titles are set by whoever created the transcript: the browser recorder writes
 * `note-recording-<ddmmyy>-<hhmmss>.webm`, while seeded and uploaded transcripts have real names.
 */
export function isRecordingTitle(title) {
    const text = String(title || '').trim()
    if (!text) return false
    if (isRecordingFile('', text)) return true
    return /^(note[-_ ])?recording[-_ ]/i.test(text)
}

/** Pull `ddmmyy-hhmmss` out of a recording filename, rejecting impossible dates. */
function parseRecordingStamp(title) {
    const match = /(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(title || ''))
    if (!match) return null

    const day = Number(match[1])
    const month = Number(match[2])
    const hour = Number(match[4])
    const minute = Number(match[5])

    if (day < 1 || day > 31 || month < 1 || month > 12) return null
    if (hour > 23 || minute > 59) return null

    return { day, month, year: 2000 + Number(match[3]), hour, minute }
}

function formatClock(hour, minute) {
    const hour12 = hour % 12 === 0 ? 12 : hour % 12
    const suffix = hour < 12 ? 'am' : 'pm'
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

/**
 * A display label for the consultation behind a transcript.
 *
 * Recordings are never surfaced as recordings. A human title is used when the transcript has one;
 * otherwise the consultation date is derived, preferring the timestamp embedded in the recording's
 * own filename because the record's `startedAt` is the transcription run and not the consultation.
 * The filename itself is only ever read for that timestamp - it is never displayed.
 */
export function describeTranscriptConsultation(transcript, index = 0) {
    const record = transcript && typeof transcript === 'object' && !Array.isArray(transcript) ? transcript : {}
    const rawTitle = String(record.title || '').trim()

    if (rawTitle && !isRecordingTitle(rawTitle)) {
        const recordDate = new Date(record.updated_at || record.updatedAt || record.created_at || record.createdAt || '')
        return {
            title: rawTitle,
            dateLabel: Number.isNaN(recordDate.getTime()) ? '' : formatAttachmentDate(recordDate),
            timeLabel: '',
        }
    }

    const stamp = parseRecordingStamp(rawTitle)
    if (stamp) {
        const stampDate = new Date(stamp.year, stamp.month - 1, stamp.day)
        if (!Number.isNaN(stampDate.getTime())) {
            return {
                title: `Consultation — ${formatAttachmentDate(stampDate)}`,
                dateLabel: '',
                timeLabel: formatClock(stamp.hour, stamp.minute),
            }
        }
    }

    const recordDate = new Date(record.updated_at || record.updatedAt || record.created_at || record.createdAt || '')
    if (!Number.isNaN(recordDate.getTime())) {
        return { title: `Consultation — ${formatAttachmentDate(recordDate)}`, dateLabel: '', timeLabel: '' }
    }

    return { title: `Transcript ${index + 1}`, dateLabel: '', timeLabel: '' }
}

/**
 * The per-transcript summary status shown in the step. `queued`/`processing` come from the scribe
 * job, `failed` surfaces the job error, and `missing` means nothing has been prepared yet.
 */
export function resolveTranscriptSummaryStatus(row) {
    if (row?.hasSummary) return 'ready'
    const queueStatus = String(row?.queueStatus || '').trim().toLowerCase()
    if (queueStatus === 'processing') return 'processing'
    if (queueStatus === 'queued') return 'queued'
    if (queueStatus === 'failed') return 'failed'
    return 'missing'
}

export function describeTranscriptSummaryStatus(row) {
    switch (resolveTranscriptSummaryStatus(row)) {
        case 'ready':
            return 'FCA summary ready'
        case 'processing':
            return 'Preparing summary…'
        case 'queued':
            return 'Queued for summary'
        case 'failed':
            return row?.queueError ? `Summary failed: ${row.queueError}` : 'Summary failed'
        default:
            return 'No FCA summary yet'
    }
}

/**
 * Merges the transcript list, the stored FCA summaries and the readiness report from
 * `/api/database/patients/scribe-summary` into the rows the step renders.
 *
 * `storedText` is always the unedited FCA summary so the UI can tell whether the clinician has
 * changed it; `summaryText` is what will actually reach the report.
 */
export function buildTranscriptRows({ transcripts, summaries, fca, selection }) {
    const normalizedSelection = normalizeTranscriptSelection(selection)

    const summaryByTranscriptionId = new Map()
    for (const summary of Array.isArray(summaries) ? summaries : []) {
        if (String(summary?.summaryStyle || '').trim() !== FCA_SUMMARY_STYLE) continue
        const id = toIdString(summary?.transcriptionId)
        if (id) summaryByTranscriptionId.set(id, summary)
    }

    const stateByTranscriptionId = new Map()
    for (const item of Array.isArray(fca?.transcripts) ? fca.transcripts : []) {
        const id = toIdString(item?.transcriptionId)
        if (id) stateByTranscriptionId.set(id, item)
    }

    return (Array.isArray(transcripts) ? transcripts : []).map((transcript, index) => {
        const id = toIdString(transcript?.id)
        const summary = summaryByTranscriptionId.get(id) || null
        const state = stateByTranscriptionId.get(id) || null
        const storedText = String(summary?.summaryText || '').trim()
        const override = normalizedSelection.summaryOverrides[id] || ''
        const hasSummary = Boolean(storedText)
        const consultation = describeTranscriptConsultation(transcript, index)

        const row = {
            id,
            title: consultation.title,
            dateLabel: consultation.dateLabel,
            timeLabel: consultation.timeLabel,
            status: String(transcript?.status || '').trim(),
            updatedAt: transcript?.updated_at || transcript?.updatedAt || null,
            audioSeconds: Number(transcript?.audio_seconds || 0) || 0,
            hasSummary,
            storedText,
            summaryText: override || storedText,
            isEdited: Boolean(override),
            included: !normalizedSelection.excludedIds.includes(id),
            queueStatus: state?.queueStatus || null,
            queueError: state?.queueError || null,
        }

        row.summaryStatus = resolveTranscriptSummaryStatus(row)
        row.summaryStatusLabel = describeTranscriptSummaryStatus(row)
        return row
    })
}

/**
 * Whether every included transcript has something to send to the report: a stored FCA summary or
 * a clinician-written override. Mirrors `findTranscriptsMissingFcaSummary` in
 * two/src/lib/jobs/reportWorker.js so the builder and the worker agree on readiness.
 */
export function findTranscriptsMissingEvidence(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => {
        if (!row?.included) return false
        return !String(row.summaryText || '').trim()
    })
}
