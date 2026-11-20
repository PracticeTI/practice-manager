// Tests for the report review marker.
//
// The behaviour that matters: a report waits for review only while its newest job is
// finished and nobody has opened it, and the marker is written only onto a job that
// actually finished — never onto a run that has not published a report yet.
//
// Run with: node --test test/patientReportReview.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    ensureReportReviewColumns,
    loadLatestReportJob,
    loadLatestReportJobs,
    markReportJobReviewed,
    normalizeReportJobRow,
    resolveReportQueueTableName,
} from '../src/lib/patientReportReview.js'
import { isUnreviewedReportJob } from '../src/lib/workerProvenance.js'

/** A connection that records the SQL it is asked to run and answers with fixed rows. */
function fakeConnection(rows = []) {
    const queries = []
    return {
        queries,
        query: async (sql, values) => {
            queries.push({ sql, values })
            return { rows }
        },
    }
}

test('a raw job row reads the same way as the row the API ships', () => {
    const row = normalizeReportJobRow({
        id: 44,
        patient_id: 9,
        patient_name: '  Avery Sample  ',
        status: 'COMPLETED',
        event_type: 'hsr_creator_enabled',
        reviewed_at: null,
        completed_at: '2026-10-14T02:00:00.000Z',
        created_at: '2026-10-14T01:00:00.000Z',
    })

    assert.equal(row.patientId, 9)
    assert.equal(row.patientName, 'Avery Sample')
    assert.equal(row.status, 'completed')
    assert.equal(row.reviewedAt, null)
    assert.equal(isUnreviewedReportJob(row), true)
    assert.equal(normalizeReportJobRow(null), null)
})

test('a queue table without the review columns still reads as unopened', () => {
    // `SELECT *` on a table created before the marker existed returns no `reviewed_at`,
    // which has to mean "nobody has opened it" rather than throwing.
    const row = normalizeReportJobRow({
        id: 44,
        patient_id: 9,
        status: 'completed',
        created_at: '2026-10-14T01:00:00.000Z',
    })

    assert.equal(row.reviewedAt, null)
    assert.equal(isUnreviewedReportJob(row), true)
})

test('the review columns are added as an upgrade to the worker table', async () => {
    const connection = fakeConnection()
    await ensureReportReviewColumns(connection, 'patient_report_jobs')

    assert.deepEqual(connection.queries.map((query) => query.sql), [
        'ALTER TABLE patient_report_jobs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL',
        'ALTER TABLE patient_report_jobs ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(128)',
    ])
})

test('a review is written only onto a job that finished', async () => {
    const connection = fakeConnection([
        {
            id: 44,
            patient_id: 9,
            status: 'completed',
            reviewed_at: '2026-10-14T03:00:00.000Z',
            reviewed_by: 'mike',
        },
    ])

    const reviewed = await markReportJobReviewed(connection, {
        domain: 'domain-a',
        patientId: 9,
        reviewedBy: 'mike',
        table: 'patient_report_jobs',
    })

    const [statement] = connection.queries
    assert.match(statement.sql, /LOWER\(COALESCE\(status, ''\)\) = 'completed'/)
    assert.match(statement.sql, /reviewed_at IS NULL/)
    assert.match(statement.sql, /patient_id = \$3/)
    // The worker's bookkeeping must not be touched: the Reports list orders queued
    // jobs by `updated_at`, so a review must not look like a new run.
    assert.doesNotMatch(statement.sql, /updated_at/)
    assert.deepEqual(statement.values, ['domain-a', 'mike', 9])

    assert.equal(reviewed.id, 44)
    assert.equal(isUnreviewedReportJob(reviewed), false)
})

test('a named job is preferred over the patient newest one', async () => {
    const connection = fakeConnection()
    await markReportJobReviewed(connection, { domain: 'domain-a', jobId: 44, patientId: 9 })

    assert.match(connection.queries[0].sql, /id = \$3/)
    assert.equal(connection.queries.length, 1)
})

test('nothing is written without a job or a patient to write it to', async () => {
    const connection = fakeConnection()

    assert.equal(await markReportJobReviewed(connection, { domain: 'domain-a' }), null)
    assert.deepEqual(connection.queries, [])
})

test('the newest run is chosen in SQL, per patient', async () => {
    const connection = fakeConnection([{ id: 44, patient_id: 9, status: 'completed' }])

    await loadLatestReportJob(connection, { domain: 'domain-a', patientId: 9 })
    const [forPatient] = connection.queries
    assert.match(forPatient.sql, /patient_id = \$2/)
    assert.match(forPatient.sql, /ORDER BY COALESCE\(created_at, completed_at\) DESC NULLS LAST, id DESC/)
    assert.match(forPatient.sql, /LIMIT 1/)
    assert.deepEqual(forPatient.values, ['domain-a', 9])

    const domainConnection = fakeConnection([{ id: 44, patient_id: 9, status: 'completed' }])
    const rows = await loadLatestReportJobs(domainConnection, { domain: 'domain-a' })
    const [perPatient] = domainConnection.queries
    assert.match(perPatient.sql, /DISTINCT ON \(patient_id\)/)
    assert.deepEqual(perPatient.values, ['domain-a'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].patientId, 9)
})

test('a recycled job is not what the queue reads', async () => {
    const connection = fakeConnection()
    await loadLatestReportJobs(connection, { domain: 'domain-a' })

    assert.match(connection.queries[0].sql, /<> 'pending delete'/)
})

test('the queue table name is env-overridable and validated', () => {
    const previous = process.env.REPORT_QUEUE_TABLE

    try {
        delete process.env.REPORT_QUEUE_TABLE
        assert.equal(resolveReportQueueTableName(), 'patient_report_jobs')

        process.env.REPORT_QUEUE_TABLE = 'report_jobs_2026'
        assert.equal(resolveReportQueueTableName(), 'report_jobs_2026')

        process.env.REPORT_QUEUE_TABLE = 'jobs; DROP TABLE patients'
        assert.throws(() => resolveReportQueueTableName(), /safe SQL identifier/)
    } finally {
        if (previous === undefined) delete process.env.REPORT_QUEUE_TABLE
        else process.env.REPORT_QUEUE_TABLE = previous
    }
})
