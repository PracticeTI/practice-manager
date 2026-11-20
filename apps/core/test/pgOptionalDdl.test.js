import test from 'node:test'
import assert from 'node:assert/strict'

import { isDdlPermissionError, runOptionalDdl } from '../src/lib/pgOptionalDdl.js'

function refusedError(message = 'must be owner of table patient_report_jobs') {
    const error = new Error(message)
    error.code = '42501'
    return error
}

test('an owner check is recognised as a privilege refusal, not a bad statement', () => {
    assert.equal(isDdlPermissionError(refusedError()), true)
    // The message alone is enough: pg maps every "must be owner" answer to 42501,
    // but a driver that drops the code must not turn it into a failed request.
    assert.equal(isDdlPermissionError(new Error('must be owner of relation patient_report_jobs')), true)
    assert.equal(isDdlPermissionError(new Error('permission denied for table patient_report_jobs')), true)

    assert.equal(isDdlPermissionError(new Error('column "patient_id" does not exist')), false)
    assert.equal(isDdlPermissionError(null), false)
})

test('an upgrade a constrained role cannot apply is skipped', async () => {
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
            throw refusedError()
        },
    }

    const applied = await runOptionalDdl(connection, 'ALTER TABLE patient_report_jobs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL')

    assert.equal(applied, false)
    assert.deepEqual(queries, ['ALTER TABLE patient_report_jobs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL'])
})

test('any other failure still reaches the caller', async () => {
    const connection = {
        async query() {
            throw new Error('syntax error at or near "ADD"')
        },
    }

    await assert.rejects(
        () => runOptionalDdl(connection, 'ALTER TABLE patient_report_jobs ADD reviewed_at TIMESTAMP'),
        /syntax error/
    )
})

test('an upgrade the runtime is allowed to apply runs once', async () => {
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
            return { rows: [] }
        },
    }

    const applied = await runOptionalDdl(connection, 'ALTER TABLE patient_report_jobs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL')

    assert.equal(applied, true)
    assert.equal(queries.length, 1)
})
