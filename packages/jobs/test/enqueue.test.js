import test from 'node:test'
import assert from 'node:assert/strict'

import { QueueError, enqueueAnalysisJob, enqueueEmailMessage, enqueueReportJob, enqueueScribeJob } from '../src/enqueue.js'

function withEnv(vars, fn) {
    const previous = {}
    for (const [key, value] of Object.entries(vars)) {
        previous[key] = process.env[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
        })
}

const NO_DB = { POSTGRES_URL: undefined, DATABASE_URL: undefined, MYSQL_URL: undefined, MYSQL_HOST: undefined, MONGODB_URI: undefined }

test('rejects a missing domain before touching the database', async () => {
    await assert.rejects(
        () => withEnv({ ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test' }, () => enqueueReportJob({})),
        (error) => error instanceof QueueError && error.status === 400 && /domain is required/.test(error.message)
    )
})

test('rejects a missing patient id', async () => {
    await assert.rejects(
        () => withEnv({ ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test' }, () => enqueueAnalysisJob({ domain: 'default' })),
        (error) => error instanceof QueueError && error.status === 400 && /patientId is required/.test(error.message)
    )
})

test('rejects a scribe job without a patient id', async () => {
    await assert.rejects(
        () => withEnv({ ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test' }, () => enqueueScribeJob({ domain: 'default' })),
        (error) => error instanceof QueueError && error.status === 400
    )
})

test('refuses to write a queue row without PostgreSQL', async () => {
    await assert.rejects(
        () => withEnv(NO_DB, () => enqueueReportJob({ domain: 'default', patientId: 1 })),
        (error) => error instanceof QueueError && error.status === 503 && error.code === 'unsupported_database'
    )
})

test('validates the email address before anything else', async () => {
    await assert.rejects(
        () => withEnv({ ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test' }, () => enqueueEmailMessage({ toEmail: 'not-an-email' })),
        (error) => error instanceof QueueError && error.status === 400 && /Valid toEmail/.test(error.message)
    )
})

test('supports the dry-run probe without a connection', async () => {
    const result = await withEnv(
        { ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test', EMAIL_QUEUE_TABLE: undefined },
        () => enqueueEmailMessage({ toEmail: 'avery.sample@example.com', dryRun: true })
    )

    assert.deepEqual(result, {
        success: true,
        dryRun: true,
        queueAvailable: true,
        dbType: 'postgresql',
        table: 'outbound_messages',
        toEmail: 'avery.sample@example.com',
    })
})

test('rejects an unsafe queue table name', async () => {
    await assert.rejects(
        () => withEnv(
            { ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test', EMAIL_QUEUE_TABLE: 'outbound_messages; DROP TABLE patients' },
            () => enqueueEmailMessage({ toEmail: 'avery.sample@example.com', dryRun: true })
        ),
        (error) => error instanceof QueueError && error.code === 'invalid_table'
    )
})
