/**
 * The review lifecycle for worker-written reports.
 *
 * A report job ends at `completed`: the worker has published a report and there is
 * nothing left for it to do. A person reviews that report by reading it, and until
 * now reading left no trace at all, which is why `reporting` was the one worker the
 * review queue could not list (see docs/WORKER_PROVENANCE.md).
 *
 * Opening the report now records the review on the job row, so the queue can ask the
 * same question it asks of a quote or an equipment suggestion — "has anybody taken
 * this on yet?" — and answer it from the record rather than from a parallel state.
 *
 * The marker sits on the *job* rather than on the report row because `patient_reports`
 * holds one row per patient that every run upserts, so it cannot say which run a
 * person has read; the job is the record of the run that produced the report.
 *
 * Both surfaces that list the queue — the patient Overview and the practice-wide
 * Tasks roll-up — read this state, so the SQL lives here rather than in either route.
 * The helpers take a connection because both callers already hold one; "is this job
 * unreviewed?" stays in `workerProvenance.js` so the rule has one definition.
 */

import { runOptionalDdl } from './pgOptionalDdl.js'

export const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'

/** The review marker's own columns, added to a queue table that predates them. */
const REVIEW_COLUMN_STATEMENTS = [
    'ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL',
    'ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(128)',
]

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveReportQueueTableName() {
    const table = String(process.env.REPORT_QUEUE_TABLE || DEFAULT_REPORT_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('REPORT_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

/**
 * The newest job per patient, as the queue reads it. Ordered in SQL rather than in
 * JS so the newest row is chosen the same way for one patient and for a whole
 * practice; a job with no `created_at` falls back to when it completed.
 *
 * `SELECT *` rather than a column list: a queue table that predates the review
 * columns still answers the query, and the missing column simply reads as "nobody
 * has opened this report yet".
 */
const LATEST_JOB_SELECT = `
    SELECT DISTINCT ON (patient_id) *
    FROM {table}
    WHERE domain = $1
      AND LOWER(COALESCE(status, '')) <> 'pending delete'
    ORDER BY patient_id, COALESCE(created_at, completed_at) DESC NULLS LAST, id DESC
`

const LATEST_JOB_FOR_PATIENT_SELECT = `
    SELECT *
    FROM {table}
    WHERE domain = $1
      AND patient_id = $2
      AND LOWER(COALESCE(status, '')) <> 'pending delete'
    ORDER BY COALESCE(created_at, completed_at) DESC NULLS LAST, id DESC
    LIMIT 1
`

/** The columns the review queue reads off a job row, in one shape for both surfaces. */
export function normalizeReportJobRow(row) {
    if (!row || typeof row !== 'object') return null

    return {
        id: row.id ?? null,
        patientId: row.patient_id ?? row.patientId ?? null,
        patientName: String(row.patient_name || row.patientName || '').trim(),
        eventType: String(row.event_type || row.eventType || '').trim(),
        status: String(row.status || '').trim().toLowerCase(),
        reviewedAt: row.reviewed_at || row.reviewedAt || null,
        reviewedBy: row.reviewed_by || row.reviewedBy || null,
        completedAt: row.completed_at || row.completedAt || null,
        createdAt: row.created_at || row.createdAt || null,
        updatedAt: row.updated_at || row.updatedAt || null,
    }
}

/**
 * Add the review columns to a queue table created before they existed.
 *
 * The table belongs to the worker service, which creates it without them, so this
 * is an upgrade of an existing table rather than part of its definition. A caller
 * that cannot add them may still read — an unpresent column reads as unreviewed —
 * and a runtime role that does not own the table simply skips the upgrade
 * (see `lib/pgOptionalDdl.js`).
 */
export async function ensureReportReviewColumns(connection, table = resolveReportQueueTableName()) {
    for (const clause of REVIEW_COLUMN_STATEMENTS) {
        await runOptionalDdl(connection, `ALTER TABLE ${table} ${clause}`)
    }
}

/** One patient's newest job, in the shape the review queue reads. */
export async function loadLatestReportJob(connection, { domain, patientId, table = resolveReportQueueTableName() }) {
    const result = await connection.query(
        LATEST_JOB_FOR_PATIENT_SELECT.replace('{table}', table),
        [domain, patientId]
    )

    return normalizeReportJobRow(result.rows?.[0] || null)
}

/**
 * The newest job for every patient in the domain — what a practice-wide roll-up
 * needs, without carrying job history it would only sort through again.
 */
export async function loadLatestReportJobs(connection, { domain, table = resolveReportQueueTableName() }) {
    const result = await connection.query(
        LATEST_JOB_SELECT.replace('{table}', table),
        [domain]
    )

    return (result.rows || []).map(normalizeReportJobRow).filter(Boolean)
}

/**
 * Record that a person has opened a report, which is what takes the job off the
 * queue. Only a completed job can be reviewed — a run still in flight has no report
 * to read — and the caller may name the job or let the patient's newest one stand in.
 *
 * `updated_at` is deliberately left alone: it is the worker's bookkeeping and the
 * Reports list orders queued jobs by it, so a review must not look like a new run.
 *
 * Returns the reviewed job, or null when there was nothing to review (already
 * reviewed, never completed, or gone).
 */
export async function markReportJobReviewed(connection, {
    domain,
    jobId = null,
    patientId = null,
    reviewedBy = null,
    table = resolveReportQueueTableName(),
}) {
    const conditions = [
        'domain = $1',
        `LOWER(COALESCE(status, '')) = 'completed'`,
        'reviewed_at IS NULL',
    ]
    const values = [domain, reviewedBy]

    if (jobId !== null && jobId !== undefined && jobId !== '') {
        values.push(jobId)
        conditions.push(`id = $${values.length}`)
    } else if (patientId !== null && patientId !== undefined && patientId !== '') {
        values.push(patientId)
        conditions.push(`patient_id = $${values.length}`)
    } else {
        return null
    }

    const result = await connection.query(
        `
        UPDATE ${table}
        SET reviewed_at = NOW(), reviewed_by = $2
        WHERE id = (
            SELECT id
            FROM ${table}
            WHERE ${conditions.join(' AND ')}
            ORDER BY COALESCE(created_at, completed_at) DESC NULLS LAST, id DESC
            LIMIT 1
        )
        RETURNING *
        `,
        values
    )

    return normalizeReportJobRow(result.rows?.[0] || null)
}
