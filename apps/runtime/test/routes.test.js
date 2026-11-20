import assert from 'node:assert/strict'
import test from 'node:test'

import { GET as health } from '../src/app/api/health/route.js'
import { GET as healthAlias } from '../src/app/api/practice-manager/health/route.js'
import { POST as reportQueueAlias } from '../src/app/api/practice-manager/report/queue/route.js'
import { POST as reportQueue } from '../src/app/api/report/queue/route.js'
import { GET as reportStatus } from '../src/app/api/report/queue/status/route.js'
import { GET as reportWorkerRun, POST as reportWorkerRunPost } from '../src/app/api/report/worker/run/route.js'
import { GET as inboundEmailStatus, POST as inboundEmail } from '../src/app/api/email/inbound/route.js'

const BEARER = (token) => ({ Authorization: `Bearer ${token}` })

function post(path, body, headers = {}) {
  return new Request(`https://runtime.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function get(path, headers = {}) {
  return new Request(`https://runtime.test${path}`, { headers })
}

/**
 * Apply environment overrides for one test and restore afterwards.
 *
 * `undefined` removes the variable, which is what a test wants when the default would let
 * the route reach a real database or accept a request without a token.
 */
async function withEnv(overrides, run) {
  const previous = new Map()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('health reports a healthy runtime without touching a dependency', async () => {
  const response = await health()
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.status, 'healthy')
  assert.equal(body.service, 'practice-manager-backend')
})

test('the /api/practice-manager aliases serve the canonical handlers', () => {
  assert.equal(healthAlias, health)
  assert.equal(reportQueueAlias, reportQueue)
})

test('a queue write without the shared secret is rejected', async () => {
  await withEnv({ CORE_BACKEND_SECRET: 'secret' }, async () => {
    const response = await reportQueue(post('/api/report/queue', { domain: 'demo', patientId: 5 }))
    assert.equal(response.status, 401)
  })
})

test('a queue write accepts the secret in the body as well as the header', async () => {
  await withEnv({ CORE_BACKEND_SECRET: 'secret', DATABASE_URL: undefined }, async () => {
    const viaBody = await reportQueue(post('/api/report/queue', { adminToken: 'secret' }))
    const viaHeader = await reportQueue(
      post('/api/report/queue', {}, BEARER('secret'))
    )

    // Both authenticated, so the answer is the request's own validation, not a 401.
    assert.equal(viaBody.status, 400)
    assert.equal((await viaBody.json()).error, 'domain is required')
    assert.equal(viaHeader.status, 400)
    assert.equal((await viaHeader.json()).error, 'domain is required')
  })
})

test('a queue write names the missing patient', async () => {
  await withEnv({ CORE_BACKEND_SECRET: undefined, DATABASE_URL: undefined }, async () => {
    const response = await reportQueue(post('/api/report/queue', { domain: 'demo' }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'patientId is required')
  })
})

test('a queue status read requires patient_id and the shared secret', async () => {
  await withEnv({ CORE_BACKEND_SECRET: 'secret', DATABASE_URL: undefined }, async () => {
    const missingPatient = await reportStatus(
      get('/api/report/queue/status?domain=demo', BEARER('secret'))
    )
    const missingSecret = await reportStatus(get('/api/report/queue/status?domain=demo&patient_id=5'))

    assert.equal(missingPatient.status, 400)
    assert.equal((await missingPatient.json()).error, 'patient_id is required')
    assert.equal(missingSecret.status, 401)
  })
})

test('a worker trigger is a GET and a POST, and needs the run token', async () => {
  await withEnv({ WORKER_RUN_TOKEN: 'run-token' }, async () => {
    const unauthorized = await reportWorkerRun(get('/api/report/worker/run'))
    assert.equal(unauthorized.status, 401)

    const unauthorizedPost = await reportWorkerRunPost(get('/api/report/worker/run'))
    assert.equal(unauthorizedPost.status, 401)
  })
})

test('a worker trigger with the token answers with the worker it ran', async () => {
  // No database: the cycle reports that it skipped rather than trying to connect.
  await withEnv({ WORKER_RUN_TOKEN: 'run-token', DATABASE_URL: undefined }, async () => {
    const response = await reportWorkerRun(get('/api/report/worker/run', BEARER('run-token')))
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.worker, 'report')
  })
})

test('the inbound email webhook rejects a body that is not JSON', async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    const response = await inboundEmail(post('/api/email/inbound', 'not-json'))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'Invalid JSON payload')
  })
})

test('the inbound email route answers a status probe', async () => {
  const response = await inboundEmailStatus()
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.status, 'active')
})
