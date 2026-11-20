import test from 'node:test'
import assert from 'node:assert/strict'

import { ensureLocalBillingQueueTable, ensureLocalReportQueueTable } from '../src/lib/patientQueueFallbacks.js'

function refused(message = 'must be owner of table patient_report_jobs') {
    const error = new Error(message)
    error.code = '42501'
    return error
}

// The table-existence probe issues this statement; anything else is DDL.
function isProbe(sql) {
    return String(sql).includes('to_regclass')
}

function provisionedConnection(refusal = refused()) {
    const queries = []
    return {
        queries,
        async query(sql) {
            queries.push(sql)
            if (isProbe(sql)) return { rows: [] }
            throw refusal
        },
    }
}

test('a provisioned queue table is never created again by the runtime', async () => {
    const connection = provisionedConnection()

    await ensureLocalReportQueueTable(connection, 'patient_report_jobs')

    const ddl = connection.queries.filter((sql) => !isProbe(sql))
    assert.deepEqual(
        ddl.filter((sql) => /CREATE\s+TABLE/i.test(sql)),
        [],
        'CREATE TABLE IF NOT EXISTS needs CREATE on the schema, which the runtime role does not hold'
    )
})

test('the queue survives a role that cannot create its indexes', async () => {
    const connection = provisionedConnection()

    await ensureLocalBillingQueueTable(connection, 'patient_billing_jobs')

    // The indexes were still attempted, and each refusal was tolerated rather than
    // failing the job write that follows.
    assert.ok(connection.queries.some((sql) => sql.includes('patient_billing_jobs_status_next_attempt_idx')))
})

test('a missing queue table is still created', async () => {
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
            if (isProbe(sql)) return { rows: [{ name: 'patient_report_jobs' }] }
            return { rows: [] }
        },
    }

    await ensureLocalReportQueueTable(connection, 'patient_report_jobs')

    assert.ok(queries.some((sql) => /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+patient_report_jobs/i.test(sql)))
})

test('a failure that is not a privilege refusal still reaches the caller', async () => {
    const connection = provisionedConnection(new Error('syntax error at or near "INDEX"'))

    await assert.rejects(
        () => ensureLocalReportQueueTable(connection, 'patient_report_jobs'),
        /syntax error/
    )
})
