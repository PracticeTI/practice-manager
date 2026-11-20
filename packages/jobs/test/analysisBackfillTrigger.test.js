import test from 'node:test'
import assert from 'node:assert/strict'

import { runAnalysisBackfillTriggerCycle } from '../src/jobs/analysisBackfillTrigger.js'

const TRIGGER_ENV_KEYS = [
    'ANALYSIS_BACKFILL_TRIGGER_URL',
    'ANALYSIS_BACKFILL_TRIGGER_ENABLED',
    'ANALYSIS_BACKFILL_TRIGGER_TOKEN',
    'ANALYSIS_BACKFILL_TRIGGER_BATCH_SIZE',
]

function withEnv(values, run) {
    const previous = new Map(TRIGGER_ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of TRIGGER_ENV_KEYS) delete process.env[key]
    for (const [key, value] of Object.entries(values)) process.env[key] = value

    try {
        return run()
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test('the analyst backfill trigger is inert until it is configured', async () => {
    await withEnv({}, async () => {
        assert.deepEqual(await runAnalysisBackfillTriggerCycle(), { skipped: true, reason: 'not-configured' })
    })
})

test('the analyst backfill trigger stays off unless explicitly enabled', async () => {
    await withEnv({ ANALYSIS_BACKFILL_TRIGGER_URL: 'http://localhost:3000/api/backfill' }, async () => {
        assert.deepEqual(await runAnalysisBackfillTriggerCycle(), { skipped: true, reason: 'disabled' })
    })
})

test('the analyst backfill trigger posts to the app with the service secret', async () => {
    const originalFetch = globalThis.fetch
    let captured = null

    globalThis.fetch = async (url, options) => {
        captured = { url, options }
        return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, via: 'service', result: { candidates: 2, queued: 2, failed: 0 } }),
        }
    }

    try {
        await withEnv({
            ANALYSIS_BACKFILL_TRIGGER_URL: 'http://localhost:3000/api/database/patients/analysis/run-jobs',
            ANALYSIS_BACKFILL_TRIGGER_ENABLED: 'true',
            ANALYSIS_BACKFILL_TRIGGER_TOKEN: 'shared-secret',
            ANALYSIS_BACKFILL_TRIGGER_BATCH_SIZE: '3',
        }, async () => {
            const result = await runAnalysisBackfillTriggerCycle()

            assert.equal(result.ok, true)
            assert.deepEqual(result.result, { candidates: 2, queued: 2, failed: 0 })
        })

        assert.equal(captured.url, 'http://localhost:3000/api/database/patients/analysis/run-jobs')
        assert.equal(captured.options.method, 'POST')
        assert.equal(captured.options.headers.Authorization, 'Bearer shared-secret')
        // The batch size is the worker's only say in the backfill; the app resolves the AI selection.
        assert.deepEqual(JSON.parse(captured.options.body), { batch_size: 3 })
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('the analyst backfill trigger reports a failure without throwing', async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = async () => ({
        ok: false,
        status: 403,
        json: async () => ({ success: false, error: 'Superadmin access required' }),
    })

    try {
        await withEnv({
            ANALYSIS_BACKFILL_TRIGGER_URL: 'http://localhost:3000/api/database/patients/analysis/run-jobs',
            ANALYSIS_BACKFILL_TRIGGER_ENABLED: 'true',
        }, async () => {
            const result = await runAnalysisBackfillTriggerCycle()

            assert.equal(result.ok, false)
            assert.equal(result.status, 403)
            assert.match(result.error, /Superadmin access required/)
        })
    } finally {
        globalThis.fetch = originalFetch
    }
})
