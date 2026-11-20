import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateEnvironmentHealth } from '../src/lib/environmentHealth.js'

const now = Date.parse('2026-11-13T04:00:00.000Z')

test('considers a successful worker run healthy through the two-hour boundary', () => {
  const record = {
    timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    workersRan: true,
  }

  assert.deepEqual(evaluateEnvironmentHealth(JSON.stringify(record), now), {
    healthy: true,
    timestamp: record.timestamp,
  })
})

test('rejects stale, unsuccessful, future, and malformed health records', () => {
  assert.equal(
    evaluateEnvironmentHealth({ timestamp: new Date(now - 2 * 60 * 60 * 1000 - 1).toISOString(), workersRan: true }, now).healthy,
    false
  )
  assert.equal(
    evaluateEnvironmentHealth({ timestamp: new Date(now).toISOString(), workersRan: false }, now).healthy,
    false
  )
  assert.equal(
    evaluateEnvironmentHealth({ timestamp: new Date(now + 1).toISOString(), workersRan: true }, now).healthy,
    false
  )
  assert.equal(evaluateEnvironmentHealth('not-json', now).healthy, false)
  assert.equal(evaluateEnvironmentHealth(null, now).healthy, false)
})
