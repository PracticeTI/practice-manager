import test from 'node:test'
import assert from 'node:assert/strict'

import { getAnalysisJobStatus, getBillingJobStatus, getPatientReport, getReportJobStatus, getScribeJobStatus, savePatientReport } from '../src/read.js'
import { QueueError } from '../src/errors.js'

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
const WITH_DB = { ...NO_DB, POSTGRES_URL: 'postgresql://localhost:5432/test' }

test('every read validates the patient target before touching the database', async () => {
    for (const read of [getReportJobStatus, getAnalysisJobStatus, getScribeJobStatus, getBillingJobStatus, getPatientReport]) {
        await assert.rejects(
            () => withEnv(WITH_DB, () => read({ domain: 'default' })),
            (error) => error instanceof QueueError && error.status === 400 && /patientId is required/.test(error.message)
        )
        await assert.rejects(
            () => withEnv(WITH_DB, () => read({ patientId: 42 })),
            (error) => error instanceof QueueError && error.status === 400 && /domain is required/.test(error.message)
        )
    }

    await assert.rejects(
        () => withEnv(WITH_DB, () => savePatientReport({ domain: 'default' })),
        (error) => error instanceof QueueError && error.status === 400
    )
})

test('reads refuse to run without PostgreSQL', async () => {
    for (const read of [getReportJobStatus, getAnalysisJobStatus, getScribeJobStatus, getBillingJobStatus, getPatientReport, savePatientReport]) {
        await assert.rejects(
            () => withEnv(NO_DB, () => read({ domain: 'default', patientId: 42 })),
            (error) => error instanceof QueueError && error.status === 503 && error.code === 'unsupported_database'
        )
    }
})
