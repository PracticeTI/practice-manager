import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDeploymentRuntime } from '../src/lib/deploymentRuntime.js'

test('a Vercel preview deployment reports its environment and deployment id', () => {
  const runtime = resolveDeploymentRuntime({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'sample-deployment.vercel.app',
    VERCEL_DEPLOYMENT_ID: 'dpl_123',
    NODE_ENV: 'production',
  })

  assert.deepEqual(runtime, {
    provider: 'vercel',
    environment: 'preview',
    service: 'sample-deployment.vercel.app',
    revision: 'dpl_123',
  })
})

test('APP_ENV overrides the provider label but not the provider', () => {
  const runtime = resolveDeploymentRuntime({
    VERCEL_ENV: 'production',
    APP_ENV: 'staging',
    NODE_ENV: 'production',
  })

  assert.equal(runtime.provider, 'vercel')
  assert.equal(runtime.environment, 'staging')
})

test('an unknown APP_ENV falls back to no label rather than echoing the raw value', () => {
  assert.equal(resolveDeploymentRuntime({ APP_ENV: 'something-else' }).environment, null)
})

test('a Cloud Run worker reports its service and revision', () => {
  const runtime = resolveDeploymentRuntime({
    K_SERVICE: 'domain-backend',
    K_REVISION: 'domain-backend-00042-abc',
    NODE_ENV: 'production',
  })

  assert.deepEqual(runtime, {
    provider: 'cloud-run',
    environment: 'prod',
    service: 'domain-backend',
    revision: 'domain-backend-00042-abc',
  })
})

test('a local development server reports itself as local', () => {
  const runtime = resolveDeploymentRuntime({ NODE_ENV: 'development' })

  assert.equal(runtime.provider, 'local')
  assert.equal(runtime.environment, 'dev')
  assert.equal(runtime.service, null)
  assert.equal(runtime.revision, null)
})

test('an empty environment reports nothing instead of guessing', () => {
  assert.deepEqual(resolveDeploymentRuntime({}), {
    provider: null,
    environment: null,
    service: null,
    revision: null,
  })
})
