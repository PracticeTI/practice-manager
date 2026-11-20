import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PUBLIC_API_ROUTES,
  decideApiAccess,
  isApiPath,
  isPublicApiRequest,
  normalizeApiPath,
  resolveApiGateMode,
} from '../src/lib/apiGate.js'
import { getPrivatePublicApiRoutes } from '../src/lib/domainExtension.js'

test('the whole api prefix is in scope, and nothing else', () => {
  assert.equal(isApiPath('/api/content'), true)
  assert.equal(isApiPath('/api/database/patients'), true)
  assert.equal(isApiPath('/api'), false)

  for (const path of ['/admin/patients', '/apiary', '', undefined]) {
    assert.equal(isApiPath(path), false, String(path))
  }
})

test('trailing slashes and query strings do not change the match', () => {
  assert.equal(normalizeApiPath('/api/content/'), '/api/content')
  assert.equal(normalizeApiPath('/api/content?type=post'), '/api/content')
  assert.equal(normalizeApiPath('/'), '/')
  assert.equal(isPublicApiRequest('/api/content/', 'GET'), true)
})

test('an anonymous read of public content is allowed', () => {
  const decision = decideApiAccess({ pathname: '/api/content', method: 'GET' }, {})

  assert.equal(decision.action, 'allow')
  assert.equal(decision.reason, 'public-allowlist')
})

test('an anonymous write to public content is denied', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const decision = decideApiAccess({ pathname: '/api/content', method }, {})
    assert.equal(decision.action, 'deny', method)
    assert.equal(decision.status, 401)
  }
})

test('the public content reader is open per item, not for the collection', () => {
  assert.equal(decideApiAccess({ pathname: '/api/content/42', method: 'GET' }, {}).action, 'allow')
  assert.equal(decideApiAccess({ pathname: '/api/content/42', method: 'DELETE' }, {}).action, 'deny')
})

test('intake autosave is writable but its submission dump is not', () => {
  assert.equal(decideApiAccess({ pathname: '/api/intake/save', method: 'POST' }, {}).action, 'allow')
  assert.equal(decideApiAccess({ pathname: '/api/intake/save', method: 'GET' }, {}).action, 'deny')
})

test('routes that used to be open to anyone are now denied', () => {
  const blocked = [
    { pathname: '/api/relationships', method: 'POST' },
    { pathname: '/api/relationships', method: 'GET' },
    { pathname: '/api/openai/models', method: 'GET' },
    { pathname: '/api/transcription/chunk', method: 'POST' },
    { pathname: '/api/domain-a/import', method: 'POST' },
    { pathname: '/api/equipment/review', method: 'PATCH' },
    { pathname: '/api/providers/favorites', method: 'POST' },
    { pathname: '/api/admin/tasks', method: 'GET' },
  ]

  for (const request of blocked) {
    const decision = decideApiAccess(request, {})
    assert.equal(decision.action, 'deny', `${request.method} ${request.pathname}`)
  }
})

test('an extension-layer route is public only when the overlay declares it', () => {
  // The review copy reader ships with the extension layer, which declares it in
  // `PRIVATE_PUBLIC_API_ROUTES`. The core itself must not name an operator route, so
  // this asserts the gate follows the overlay rather than a hardcoded entry.
  const declared = getPrivatePublicApiRoutes().some((route) => route.path === '/api/fca-review/reports')
  const decision = decideApiAccess({ pathname: '/api/fca-review/reports', method: 'GET' }, {})
  assert.equal(decision.action, declared ? 'allow' : 'deny')
  if (declared) assert.equal(decision.reason, 'public-allowlist')

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(decideApiAccess({ pathname: '/api/fca-review/reports', method }, {}).action, 'deny', method)
  }
})

test('a dynamic segment matches exactly one path segment', () => {
  assert.equal(
    isPublicApiRequest('/api/scheduling/calendar/oauth/google/callback', 'GET'),
    true
  )
  assert.equal(
    isPublicApiRequest('/api/scheduling/calendar/oauth/google/callback/extra', 'GET'),
    false
  )
  assert.equal(isPublicApiRequest('/api/scheduling/calendar/oauth/google/start', 'POST'), false)
})

test('a verified principal and the worker secret are allowed', () => {
  assert.equal(
    decideApiAccess({ pathname: '/api/relationships', method: 'POST', authenticated: true }, {}).reason,
    'admin'
  )
  assert.equal(
    decideApiAccess({ pathname: '/api/relationships', method: 'POST', isService: true }, {}).reason,
    'service'
  )
})

test('CORS preflight and non-api paths are never blocked', () => {
  assert.equal(decideApiAccess({ pathname: '/api/patients', method: 'OPTIONS' }, {}).reason, 'preflight')
  assert.equal(decideApiAccess({ pathname: '/admin', method: 'GET' }, {}).reason, 'not-api')
})

test('a HEAD is treated as the GET it serves', () => {
  assert.equal(decideApiAccess({ pathname: '/api/health', method: 'HEAD' }, {}).action, 'allow')
})

test('the database routes keep their own decision', () => {
  assert.equal(decideApiAccess({ pathname: '/api/database/patients', method: 'GET' }, {}).action, 'deny')
  assert.equal(
    decideApiAccess({ pathname: '/api/database/content', method: 'GET' }, {}).reason,
    'unauthenticated'
  )
})

test('the bare database prefix does not slip past the database decision', () => {
  assert.equal(decideApiAccess({ pathname: '/api/database', method: 'GET' }, {}).action, 'deny')
  assert.equal(decideApiAccess({ pathname: '/api/database/', method: 'POST' }, {}).action, 'deny')
})

test('presentation reads that plain <img> tags and public pages need stay open', () => {
  for (const pathname of ['/api/settings/domains/cache-config', '/api/settings/domain-artwork']) {
    assert.equal(decideApiAccess({ pathname, method: 'GET' }, {}).action, 'allow', pathname)
    assert.equal(decideApiAccess({ pathname, method: 'POST' }, {}).action, 'deny', pathname)
  }
})

test('report mode logs instead of denying, so an unverified surface can be adopted safely', () => {
  const decision = decideApiAccess({ pathname: '/api/relationships', method: 'POST' }, { API_GATE: 'report' })

  assert.equal(decision.action, 'log')
  assert.equal(decision.status, undefined)
})

test('report mode reaches the database gate too', () => {
  const decision = decideApiAccess(
    { pathname: '/api/database/patients', method: 'GET' },
    { API_GATE: 'report' }
  )

  assert.equal(decision.action, 'log')
})

test('one knob governs the whole surface', () => {
  assert.equal(resolveApiGateMode({}), 'enforce')
  assert.equal(resolveApiGateMode({ API_GATE: 'REPORT' }), 'report')
  assert.equal(resolveApiGateMode({ API_GATE: 'nonsense' }), 'enforce')
})

test('the retired DATABASE_API_GATE name no longer opens the gate', () => {
  const decision = decideApiAccess(
    { pathname: '/api/database/patients', method: 'GET' },
    { DATABASE_API_GATE: 'report' }
  )

  assert.equal(decision.action, 'deny')
})

test('every allowlisted route names at least one method', () => {
  for (const route of PUBLIC_API_ROUTES) {
    assert.ok(route.path.startsWith('/api/'), route.path)
    assert.ok(Array.isArray(route.methods) && route.methods.length > 0, route.path)
    for (const method of route.methods) {
      assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method), `${route.path} ${method}`)
    }
  }
})
