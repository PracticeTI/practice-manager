import test from 'node:test'
import assert from 'node:assert/strict'

import { WORKERS, WORKER_KEYS, enabledWorkerKeys, isWorkerEnabled, runOnce, startWorkers } from '../src/driver.js'

test('registers every worker with a start and run entry point', () => {
    assert.deepEqual(WORKER_KEYS, [
        'analysis',
        'analysisBackfill',
        'billing',
        'email',
        'inboundEmail',
        'equipmentSourcer',
        'quoteWriter',
        'report',
        'schedulingReminder',
        'scribe',
        'systemInfo',
    ])

    for (const key of WORKER_KEYS) {
        assert.equal(typeof WORKERS[key].start, 'function', `${key} has a start function`)
        assert.equal(typeof WORKERS[key].run, 'function', `${key} has a run function`)
        assert.ok(WORKERS[key].enableEnv, `${key} names its enable flag`)
    }
})

test('is inert by default', () => {
    // A single-practitioner install must not start polling unless a flag is set, and the
    // environment-health worker defaults to on in the service, so it needs opt-in here.
    assert.deepEqual(enabledWorkerKeys({}), [])

    const stop = startWorkers({ env: {} })
    assert.doesNotThrow(() => stop())
    assert.doesNotThrow(() => stop())
})

test('follows each worker flag, including the inbound fallback', () => {
    assert.equal(isWorkerEnabled('report', { REPORT_WORKER_ENABLED: 'true' }), true)
    assert.equal(isWorkerEnabled('report', { REPORT_WORKER_ENABLED: 'TRUE' }), true)
    assert.equal(isWorkerEnabled('report', { REPORT_WORKER_ENABLED: 'false' }), false)
    // The workers accept only the literal `true`; the driver must not be more generous.
    assert.equal(isWorkerEnabled('report', { REPORT_WORKER_ENABLED: '1' }), false)

    // The inbound worker follows the outbound email flag unless it is set explicitly.
    assert.equal(isWorkerEnabled('inboundEmail', { EMAIL_WORKER_ENABLED: 'true' }), true)
    assert.equal(isWorkerEnabled('inboundEmail', { EMAIL_WORKER_ENABLED: 'true', INBOUND_EMAIL_WORKER_ENABLED: 'false' }), false)

    // Default-on in the service, opt-in inline.
    assert.equal(isWorkerEnabled('systemInfo', {}), false)
    assert.equal(isWorkerEnabled('systemInfo', { ENV_HEALTH_WORKER_ENABLED: 'true' }), true)
})

test('rejects an unknown worker instead of silently skipping it', () => {
    assert.throws(() => startWorkers({ workers: ['nope'], env: {} }), /Unknown worker "nope"/)
    assert.rejects(() => runOnce({ workers: ['nope'], env: {} }), /Unknown worker "nope"/)
})

test('runs no cycles when nothing is selected', async () => {
    assert.deepEqual(await runOnce({ env: {} }), [])
})
