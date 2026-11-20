import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDatabaseEnvironment,
  checkDatabaseEnvironment,
  resolveDatabaseEnvironment,
} from '../src/lib/databaseEnvironmentGuard.js'

test('an undeclared database environment leaves the guard dormant', () => {
  for (const env of [
    {},
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'preview', DATABASE_ENVIRONMENT: '' },
    { VERCEL_ENV: 'preview', DATABASE_ENVIRONMENT: 'nonsense' },
  ]) {
    assert.equal(checkDatabaseEnvironment(env).allowed, true, JSON.stringify(env))
  }
})

test('a preview deployment using the production database is refused', () => {
  const result = checkDatabaseEnvironment({ VERCEL_ENV: 'preview', DATABASE_ENVIRONMENT: 'production' })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'preview-using-production-database')
  assert.match(result.message, /Point the preview environment at its own database/)
})

test('the one-off escape hatch is explicit and must be exactly 1', () => {
  const base = { VERCEL_ENV: 'preview', DATABASE_ENVIRONMENT: 'production' }

  assert.equal(checkDatabaseEnvironment({ ...base, ALLOW_PRODUCTION_DATABASE_IN_PREVIEW: '1' }).allowed, true)
  assert.equal(checkDatabaseEnvironment({ ...base, ALLOW_PRODUCTION_DATABASE_IN_PREVIEW: 'true' }).allowed, false)
  assert.equal(checkDatabaseEnvironment({ ...base, ALLOW_PRODUCTION_DATABASE_IN_PREVIEW: '0' }).allowed, false)
})

test('production must not serve from a non-production database', () => {
  const result = checkDatabaseEnvironment({ VERCEL_ENV: 'production', DATABASE_ENVIRONMENT: 'preview' })

  assert.equal(result.allowed, false)
  assert.equal(result.reason, 'production-using-non-production-database')
})

test('matching environments pass', () => {
  for (const value of ['production', 'preview', 'development', 'test']) {
    assert.equal(
      checkDatabaseEnvironment({ VERCEL_ENV: value, DATABASE_ENVIRONMENT: value }).allowed,
      true,
      value
    )
  }
})

test('the development environment is exempt from the deployment comparison', () => {
  const result = checkDatabaseEnvironment({ VERCEL_ENV: 'development', DATABASE_ENVIRONMENT: 'preview' })
  assert.equal(result.allowed, true)
})

test('the throwing form carries the reason so the failure is diagnosable', () => {
  assert.throws(
    () => assertDatabaseEnvironment({ VERCEL_ENV: 'preview', DATABASE_ENVIRONMENT: 'production' }),
    /\[database-guard\] Refusing to connect: this preview deployment has DATABASE_ENVIRONMENT=production/
  )
})

test('the declared environment is normalised and validated', () => {
  assert.equal(resolveDatabaseEnvironment({ DATABASE_ENVIRONMENT: '  PRODUCTION ' }), 'production')
  assert.equal(resolveDatabaseEnvironment({ DATABASE_ENVIRONMENT: 'staging' }), null)
})
