import test from 'node:test'
import assert from 'node:assert/strict'

import { canReadRlsDiagnostics, isSimulatedAdminSession } from '../src/lib/rlsPanelAccess.js'

test('a superadmin may read RLS diagnostics', () => {
    assert.equal(canReadRlsDiagnostics({ role: 'superadmin' }, { superAdmin: true }), true)
})

test('a real admin login may not read RLS diagnostics', () => {
    const realAdmin = { username: 'front-desk', role: 'admin', domain: 'domain-a' }

    assert.equal(isSimulatedAdminSession(realAdmin), false)
    assert.equal(canReadRlsDiagnostics(realAdmin), false)
})

test('a simulated admin session may read RLS diagnostics', () => {
    const simulated = { username: 'front-desk', role: 'admin', domain: 'domain-a', simulated: true }

    assert.equal(isSimulatedAdminSession(simulated), true)
    assert.equal(canReadRlsDiagnostics(simulated), true)
})

test('the preview bypass principal is not a simulation', () => {
    const previewBypass = { username: 'vercel-preview', role: 'admin', domain: 'preview-domain', bypass: 'preview' }

    assert.equal(canReadRlsDiagnostics(previewBypass), false)
})

test('an empty or missing session is refused', () => {
    assert.equal(canReadRlsDiagnostics(null), false)
    assert.equal(canReadRlsDiagnostics(undefined), false)
    assert.equal(canReadRlsDiagnostics({}), false)
})
