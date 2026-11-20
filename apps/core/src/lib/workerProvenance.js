// Provenance vocabulary for worker-written records.
//
// The question every one of these records has to answer is "did a machine make
// this, and has a person taken ownership of it yet?". That answer belongs on the
// *record*, not on the tab that happens to contain it: a tab is a category, and a
// category routinely holds records in different states (the Reports tab merges
// generated reports with hand-saved drafts; the Quotes tab holds the worker's
// draft beside hand-built quotes). Moving a tab between sections as its records
// change state would leave a tab that has to be in two places at once, and would
// reorder the strip under the user's cursor.
//
// So: one vocabulary, applied per record, and rendered the same way everywhere.
// Kept pure and browser-safe so the panel, the review queue and the tests agree.

import { QUOTE_WRITER_ORIGIN } from './patientQuoteDrafting.js'

/** Created by a worker and not yet taken on by a person. This is what needs review. */
export const PROVENANCE_WORKER_DRAFT = 'worker-draft'

/** Started by a worker; a person has since moved it on (sent, accepted, published). */
export const PROVENANCE_WORKER_ASSISTED = 'worker-assisted'

/** Brought in from an external system rather than created here. */
export const PROVENANCE_IMPORTED = 'imported'

/** No machine involvement recorded. */
export const PROVENANCE_NONE = 'none'

/**
 * Badge copy per provenance state, so the two surfaces that show it (the record
 * row and the review queue) can never drift apart in wording.
 */
export const PROVENANCE_BADGES = {
    [PROVENANCE_WORKER_DRAFT]: {
        label: 'Worker draft',
        title: 'Drafted by a worker — review it before it leaves the practice.',
        className: 'border-sky-200 bg-sky-50 text-sky-700',
    },
    [PROVENANCE_WORKER_ASSISTED]: {
        label: 'Worker-assisted',
        title: 'A worker started this document; a person has since reviewed and moved it on.',
        className: 'border-gray-200 bg-gray-50 text-gray-500',
    },
    [PROVENANCE_IMPORTED]: {
        label: 'Imported',
        title: 'Imported from an external source.',
        className: 'border-gray-200 bg-gray-50 text-gray-500',
    },
}

export function cleanProvenanceText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

/**
 * True when a quote is one the Quote Writer created.
 *
 * Either marker alone identifies it: the row carries `external_source` (which the
 * table's unique index uses, so re-runs update one draft instead of piling up)
 * and `metadata.origin`. Both are checked in one place so the "is this the
 * worker's document?" question cannot be answered two different ways — an earlier
 * version accepted both markers when naming the provenance but only one when
 * deciding whether it had been reviewed, which silently reported an untouched
 * worker draft as already reviewed.
 */
export function isQuoteWriterQuote(row) {
    const source = cleanProvenanceText(row?.external_source).toLowerCase()
    const origin = cleanProvenanceText(row?.metadata?.origin).toLowerCase()
    return source === QUOTE_WRITER_ORIGIN || origin === QUOTE_WRITER_ORIGIN
}

/**
 * True when a quote is the Quote Writer's own draft that nobody has taken on yet.
 *
 * "Taken on" is deliberately the *existing* lifecycle: sending or accepting a
 * quote is the practitioner putting their name to it. No second review flag is
 * introduced, because a parallel state machine would be a second source of truth
 * for the same fact — and it would have to be kept in step with the status the
 * rest of the app already reads.
 */
export function isUnreviewedWorkerQuote(row) {
    if (!isQuoteWriterQuote(row)) return false
    return cleanProvenanceText(row?.status).toLowerCase() === 'draft'
}

/** The provenance state of a quote row: worker draft, worker-assisted, or imported. */
export function resolveQuoteProvenance(row) {
    if (isQuoteWriterQuote(row)) {
        return isUnreviewedWorkerQuote(row) ? PROVENANCE_WORKER_DRAFT : PROVENANCE_WORKER_ASSISTED
    }

    // Anything else with an external id came from an import (see `patient_cases`,
    // which uses the same external_* columns).
    if (cleanProvenanceText(row?.external_id)) return PROVENANCE_IMPORTED

    return PROVENANCE_NONE
}

/** The badge to render for a quote row, or null when there is nothing to say. */
export function describeQuoteProvenanceBadge(row) {
    const provenance = resolveQuoteProvenance(row)
    return PROVENANCE_BADGES[provenance] || null
}

/**
 * The report queue's terminal status: the worker has finished and a report exists.
 * Nothing further happens to the row until somebody edits the config again, which
 * queues a new one.
 */
const REPORT_JOB_COMPLETED_STATUS = 'completed'

/**
 * True when a report job finished and nobody has opened its report yet.
 *
 * Reports are the one worker artefact whose "nobody has acted yet" state had to be
 * *created* rather than read off the record: a finished report is reviewed by
 * reading it, and reading left no trace (see docs/WORKER_PROVENANCE.md).
 * The trace is now `reviewed_at` on the job row, written when the report is opened
 * (see `patientReportReview.js`) — so "unreviewed" stays a fact about the record
 * rather than a second state machine layered on top of the job's own status.
 */
export function isUnreviewedReportJob(row) {
    if (!row || typeof row !== 'object') return false
    if (cleanProvenanceText(row.status).toLowerCase() !== REPORT_JOB_COMPLETED_STATUS) return false

    // Absent, '', null and undefined all read as "nobody has opened it".
    return !cleanProvenanceText(row.reviewed_at ?? row.reviewedAt)
}

/** A job's creation time, or -Infinity so malformed rows sort last rather than first. */
function reportJobSortValue(row) {
    const raw = row?.created_at ?? row?.createdAt ?? row?.completed_at ?? row?.completedAt
    const time = raw ? new Date(raw).getTime() : Number.NaN
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

/**
 * Which of two jobs is the newer run. Ties fall to the higher id, which is the order
 * the queue's own SQL reads the newest row in — two runs cannot be assumed to be a
 * second apart.
 */
function compareReportJobRecency(left, right) {
    const leftTime = reportJobSortValue(left)
    const rightTime = reportJobSortValue(right)
    if (leftTime !== rightTime) return leftTime - rightTime
    return Number(left?.id ?? 0) - Number(right?.id ?? 0)
}

/** The newest report job in a set of rows, or null. */
export function selectLatestReportJob(rows) {
    const candidates = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object')

    let latest = null
    for (const row of candidates) {
        if (!latest || compareReportJobRecency(row, latest) > 0) latest = row
    }
    return latest
}

/**
 * The finished report nobody has opened, or null.
 *
 * Only the *newest* job counts: a run still queued or processing means a fresh
 * report is on its way, so the previous one is no longer what is waiting on a
 * person, and a failure means the run a person would review never landed.
 */
export function selectUnreviewedReportJob(rows) {
    const latest = selectLatestReportJob(rows)
    return isUnreviewedReportJob(latest) ? latest : null
}
