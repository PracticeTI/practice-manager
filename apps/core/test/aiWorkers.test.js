import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_WORKER_VISIBILITY,
    LEGACY_WORKER_VISIBILITY_KEY,
    WORKER_VISIBILITY_KEY,
    readWorkerVisibility,
} from '../src/lib/aiWorkers.js'

test('every worker is visible by default', () => {
    assert.equal(Object.values(DEFAULT_WORKER_VISIBILITY).every(Boolean), true)
    assert.deepEqual(readWorkerVisibility({}), DEFAULT_WORKER_VISIBILITY)
})

test('reads the current settings key', () => {
    const visibility = readWorkerVisibility({ [WORKER_VISIBILITY_KEY]: { reporting: false } })
    assert.equal(visibility.reporting, false)
    assert.equal(visibility.billing, true)
})

test('reads a record saved under the retired key', () => {
    const visibility = readWorkerVisibility({ [LEGACY_WORKER_VISIBILITY_KEY]: { reporting: false } })
    assert.equal(visibility.reporting, false)
})

test('prefers the current key over the retired one', () => {
    const visibility = readWorkerVisibility({
        [WORKER_VISIBILITY_KEY]: { reporting: true },
        [LEGACY_WORKER_VISIBILITY_KEY]: { reporting: false },
    })
    assert.equal(visibility.reporting, true)
})

test('falls back to stored settings when the request omits the field', () => {
    const visibility = readWorkerVisibility(
        { patientsEnabled: true },
        { [LEGACY_WORKER_VISIBILITY_KEY]: { billing: false } }
    )
    assert.equal(visibility.billing, false)
})
