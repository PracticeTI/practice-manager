import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAdminDomainScope } from '../src/lib/adminDomainScopePolicy.js'

test('uses the assigned domain for a scoped admin', () => {
    const adminUser = { role: 'admin', domain: 'domain-b', username: 'domain-b-admin' }
    const result = selectAdminDomainScope(adminUser, 'domain-b', false)

    assert.equal(result.domain, 'domain-b')
    assert.equal(result.error, undefined)
})

test('rejects a cross-domain request from a scoped admin', () => {
    const adminUser = { role: 'admin', domain: 'domain-b', username: 'domain-b-admin' }

    assert.deepEqual(selectAdminDomainScope(adminUser, 'preview-domain', false), {
        error: 'Forbidden: domain scope mismatch',
        status: 403,
    })
})

test('allows a superadmin to select a domain', () => {
    const adminUser = { role: 'superadmin', username: 'root' }
    const result = selectAdminDomainScope(adminUser, 'preview-domain', true)

    assert.equal(result.domain, 'preview-domain')
})

test('a domain admin is scoped even when the caller claims global access', () => {
    const adminUser = { role: 'domain_admin', domain: 'domain-b', username: 'domain-b-admin' }

    assert.deepEqual(selectAdminDomainScope(adminUser, 'preview-domain', false), {
        error: 'Forbidden: domain scope mismatch',
        status: 403,
    })
})

test('a domain admin keeps the assigned domain when none is requested', () => {
    const adminUser = { role: 'domain_admin', domain: 'Domain-B', username: 'domain-b-admin' }
    const result = selectAdminDomainScope(adminUser, null, false)

    assert.equal(result.domain, 'domain-b')
})