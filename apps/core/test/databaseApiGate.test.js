import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DATABASE_API_PUBLIC_PATHS,
  decideDatabaseApiAccess,
  isDatabaseApiPath,
  isPublicDatabaseApiPath,
  resolveGateMode,
} from '../src/lib/databaseApiGate.js'

test('only the database API prefix is in scope', () => {
  assert.equal(isDatabaseApiPath('/api/database/patients'), true)
  assert.equal(isDatabaseApiPath('/api/database/migrate/drop-old-tables'), true)

  for (const path of ['/api/content', '/api/email', '/admin/patients', '/api/database', '']) {
    assert.equal(isDatabaseApiPath(path), false, path)
  }
})

test('an unauthenticated request to an admin route is denied', () => {
  const decision = decideDatabaseApiAccess({ pathname: '/api/database/patients', method: 'GET' }, {})

  assert.equal(decision.action, 'deny')
  assert.equal(decision.status, 401)
})

test('a request with a verified admin principal is allowed', () => {
  const decision = decideDatabaseApiAccess(
    { pathname: '/api/database/patients', method: 'GET', authenticated: true },
    {}
  )

  assert.equal(decision.action, 'allow')
  assert.equal(decision.reason, 'admin')
})

test('the worker shared secret is allowed through', () => {
  const decision = decideDatabaseApiAccess(
    { pathname: '/api/database/patients', method: 'POST', isService: true },
    {}
  )

  assert.equal(decision.action, 'allow')
  assert.equal(decision.reason, 'service')
})

test('CORS preflight is never blocked', () => {
  const decision = decideDatabaseApiAccess({ pathname: '/api/database/patients', method: 'OPTIONS' }, {})

  assert.equal(decision.action, 'allow')
  assert.equal(decision.reason, 'preflight')
})

test('no database route is exempt from the gate', () => {
  assert.deepEqual(DATABASE_API_PUBLIC_PATHS, [])

  for (const path of ['/api/database/productions', '/api/database/productions/list', '/api/database/patients']) {
    assert.equal(isPublicDatabaseApiPath(path), false, path)
  }
})

test('non-database API paths stay out of the gate', () => {
  const decision = decideDatabaseApiAccess({ pathname: '/api/contact', method: 'POST' }, {})

  assert.equal(decision.action, 'allow')
  assert.equal(decision.reason, 'not-database-api')
})

test('report mode logs instead of denying, so an unverified surface can be adopted safely', () => {
  const decision = decideDatabaseApiAccess(
    { pathname: '/api/database/patients', method: 'GET' },
    { API_GATE: 'report' }
  )

  assert.equal(decision.action, 'log')
  assert.equal(decision.status, undefined)
})

test('the mode falls back to enforce for missing or unknown values', () => {
  assert.equal(resolveGateMode({}), 'enforce')
  assert.equal(resolveGateMode({ API_GATE: 'REPORT' }), 'report')
  assert.equal(resolveGateMode({ API_GATE: 'nonsense' }), 'enforce')
})
