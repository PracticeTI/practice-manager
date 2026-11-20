// "What is waiting on a person?" — the review queue for worker-written records.
//
// The patient Overview shows the worker cards (toggle, status, settings). This
// module answers the complementary question, across *all* workers at once: which
// worker artefacts is nobody yet responsible for? That is the useful half of
// "keep worker output separate until a human has reviewed it", without moving
// documents between tab sections as their state changes.
//
// A record is in the queue only while it is still in the state the worker left
// it in. "Reviewed" is not a new flag: it is the existing lifecycle — sending or
// accepting a quote, sourcing an equipment suggestion, opening a report. Inventing
// a parallel reviewed/unreviewed marker would put a second source of truth next to
// the one the rest of the app already reads.
//
// Reports only joined the queue once their review left a trace. A finished report
// used to be reviewed by reading it, which recorded nothing, so the queue had
// nothing to read. Opening the report now writes that trace on the job row (see
// `patientReportReview.js`), which is what earns the entry its place here rather
// than a badge that could disagree with the job's own status.
//
// Only workers with an unambiguous "nobody has acted yet" state are listed. Two do
// not have one today (see `WORKERS_WITHOUT_A_REVIEW_SIGNAL`), and are reported
// rather than guessed at.
//
// Pure and browser-safe: the queue, the UI and the tests share one derivation.

import { WORKER_DEFINITIONS } from './aiWorkers.js'
import { SOURCING_STATUS_UNSOURCED, normalizeSourcingStatus } from './equipmentSourcingStatus.js'
import { isUnreviewedWorkerQuote, selectUnreviewedReportJob } from './workerProvenance.js'

const WORKER_LABELS = Object.fromEntries(
    WORKER_DEFINITIONS.map((worker) => [worker.key, worker.label])
)

/**
 * Workers whose output has no unambiguous "awaiting a human" state, so the queue
 * must not pretend to know. Kept here (rather than silently omitted) because the
 * reason is a fact about the records, not an oversight:
 *   - analyst (FCA Analyst): a completed run is "Ready", which says the run
 *     finished, not that anybody read the suggestions.
 *   - scribe (Transcript Summariser): a stored summary is itself the artefact.
 * Adding a review marker to those two is what would let them join the queue.
 *
 * `reporting` (FCA Builder) used to be listed here for the same reason as the
 * analyst — a report is "Ready" the moment it is written, and reading it left no
 * trace. Opening a report now records the review on the job, so the reporting
 * worker's output answers the same question the other queue entries do.
 *
 * The placement decision (why Analysis and Summary stay in the agent pod) is recorded
 * in docs/WORKER_PROVENANCE.md.
 */
export const WORKERS_WITHOUT_A_REVIEW_SIGNAL = ['analyst', 'scribe']

/** Quotes first: a quote is participant-facing, so an unreviewed one is the most urgent. */
const KIND_ORDER = ['quotes', 'equipment', 'report']

/**
 * The agent named on a report job, read from the event type it was queued with:
 * the HSR Writer queues `hsr_creator_*`, everything else is the reporting worker.
 *
 * The reporting worker's registry label ("Reporting") is not the name the practice
 * reads or writes it under — every surface that shows it calls it the FCA Builder
 * (see `reportTypeArtwork.js`), so the queue says the same thing rather than naming
 * an agent nobody sees.
 */
function reportJobWorker(row) {
    const eventType = String(row?.event_type ?? row?.eventType ?? '').trim().toLowerCase()

    if (eventType.startsWith('hsr')) {
        return { key: 'hsrCreator', label: WORKER_LABELS.hsrCreator || 'HSR Writer' }
    }

    return { key: 'reporting', label: 'FCA Builder' }
}

function toCount(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function plural(count, singular, pluralForm = `${singular}s`) {
    return count === 1 ? singular : pluralForm
}

function quoteNumbers(rows) {
    return rows
        .map((row) => String(row?.quote_number || '').trim())
        .filter(Boolean)
}

/** The oldest of a set of timestamps, or null. Lets the UI age the entry. */
function oldestTimestamp(rows, keys) {
    let oldest = null
    for (const row of rows) {
        for (const key of keys) {
            const raw = row?.[key]
            if (!raw) continue
            const time = new Date(raw).getTime()
            if (!Number.isFinite(time)) continue
            if (oldest === null || time < oldest) oldest = time
        }
    }
    return oldest === null ? null : new Date(oldest).toISOString()
}

/** Equipment suggestions a person has not acted on yet. */
export function selectUnsourcedEquipmentSuggestions(suggestions) {
    const rows = Array.isArray(suggestions) ? suggestions : []
    return rows.filter((suggestion) => normalizeSourcingStatus(suggestion?.sourcingStatus) === SOURCING_STATUS_UNSOURCED)
}

/**
 * The first timestamp a row carries, in ISO. A report entry is aged by *when the
 * report landed*, so this takes the first key present rather than the oldest of all
 * of them — a job requested yesterday and completed this morning waited since this
 * morning.
 */
function firstTimestamp(row, keys) {
    for (const key of keys) {
        const raw = row?.[key]
        if (!raw) continue
        const time = new Date(raw).getTime()
        if (Number.isFinite(time)) return new Date(time).toISOString()
    }
    return null
}

/**
 * Builds the queue. `tabAvailability` drops entries whose destination tab is not
 * on screen (for example the Equipment tab disappears when the Equipment Sourcer
 * is switched off for the patient), so a row can never link somewhere unreachable.
 */
export function buildWorkerReviewItems({
    quotes = [],
    equipmentSuggestions = [],
    reportJobs = [],
    tabAvailability = {},
} = {}) {
    const workerDraftQuotes = (Array.isArray(quotes) ? quotes : []).filter(isUnreviewedWorkerQuote)
    const unsourcedEquipment = selectUnsourcedEquipmentSuggestions(equipmentSuggestions)
    const unreviewedReport = selectUnreviewedReportJob(reportJobs)

    const items = []

    if (workerDraftQuotes.length > 0 && tabAvailability.quotes !== false) {
        const numbers = quoteNumbers(workerDraftQuotes)
        const count = workerDraftQuotes.length
        items.push({
            key: 'quotes',
            tab: 'quotes',
            kind: 'quotes',
            workerKey: 'quoteWriter',
            workerLabel: WORKER_LABELS.quoteWriter || 'Quote Writer',
            count,
            title: count === 1 && numbers[0]
                ? `Quote ${numbers[0]} needs review`
                : `${count} ${plural(count, 'quote')} need review`,
            detail: `Drafted by the ${WORKER_LABELS.quoteWriter || 'Quote Writer'}. Check the supports and the price limits, then send it to the participant.`,
            actionLabel: 'Review quote',
            oldestCreatedAt: oldestTimestamp(workerDraftQuotes, ['created_at', 'createdAt']),
            recordIds: workerDraftQuotes.map((row) => row?.id).filter(Boolean),
        })
    }

    if (unsourcedEquipment.length > 0 && tabAvailability.equipment !== false) {
        const count = unsourcedEquipment.length
        items.push({
            key: 'equipment',
            tab: 'equipment',
            kind: 'equipment',
            workerKey: 'equipmentSourcer',
            workerLabel: WORKER_LABELS.equipmentSourcer || 'Equipment Sourcer',
            count,
            title: `${count} equipment ${plural(count, 'suggestion')} to source`,
            detail: `Found by the ${WORKER_LABELS.equipmentSourcer || 'Equipment Sourcer'} with nothing sourced or quoted yet.`,
            actionLabel: 'Review equipment',
            oldestCreatedAt: oldestTimestamp(unsourcedEquipment, ['createdAt', 'updatedAt', 'created_at']),
            recordIds: [],
        })
    }

    if (unreviewedReport && tabAvailability.report !== false) {
        const worker = reportJobWorker(unreviewedReport)
        items.push({
            key: 'report',
            tab: 'report',
            kind: 'report',
            workerKey: worker.key,
            workerLabel: worker.label,
            // One patient has one current report, so this entry is never a count of
            // many: reviewing it is reading the report that is already there.
            count: 1,
            title: 'Report ready to review',
            detail: `Written by the ${worker.label}. Read it and check the findings before it goes to the participant.`,
            actionLabel: 'Review report',
            oldestCreatedAt: firstTimestamp(
                unreviewedReport,
                ['completedAt', 'completed_at', 'createdAt', 'created_at'],
            ),
            recordIds: unreviewedReport.id ? [unreviewedReport.id] : [],
            reportJobId: unreviewedReport.id ?? null,
        })
    }

    return items.sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind))
}

export function summarizeWorkerReviewItems(items) {
    const rows = Array.isArray(items) ? items : []
    const total = rows.reduce((sum, item) => sum + toCount(item?.count), 0)

    return {
        itemCount: rows.length,
        total,
        summaryText: total === 0
            ? 'Nothing from your agents is waiting on review.'
            : `${total} ${plural(total, 'item')} from your agents ${total === 1 ? 'is' : 'are'} waiting on review.`,
    }
}
