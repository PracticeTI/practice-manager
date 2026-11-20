import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOCALHOST_DEV_ADMIN_TOKEN,
  PREVIEW_DEPLOYMENT_ADMIN_TOKEN,
  isPreviewBypassEnabled,
  resolveBypassAdmin,
  resolvePreviewBypassDomain,
} from '../src/lib/adminBypassTokens.js'

const PREVIEW_SCOPED = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  ADMIN_PREVIEW_BYPASS: 'true',
  ADMIN_PREVIEW_DOMAIN: 'default',
}

test('the localhost bypass token is a superadmin only in development', () => {
  const dev = resolveBypassAdmin(LOCALHOST_DEV_ADMIN_TOKEN, { NODE_ENV: 'development' })
  assert.equal(dev?.role, 'superadmin')
  assert.equal(dev?.bypass, 'localhost')

  assert.equal(resolveBypassAdmin(LOCALHOST_DEV_ADMIN_TOKEN, { NODE_ENV: 'production' }), null)
  assert.equal(resolveBypassAdmin(LOCALHOST_DEV_ADMIN_TOKEN, {}), null)
})

test('the preview bypass token is a domain-scoped admin, never a superadmin', () => {
  const user = resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, PREVIEW_SCOPED)

  assert.equal(user?.bypass, 'preview')
  assert.equal(user?.domain, 'default')
  // A superadmin role here reads every tenant: routes take `domain` from the
  // query string and the RLS predicates short-circuit on the superadmin role.
  assert.notEqual(user?.role, 'superadmin')
  assert.equal(user?.role, 'admin')
})

test('the preview bypass token is rejected without the opt-in flag', () => {
  const user = resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, {
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
    ADMIN_PREVIEW_DOMAIN: 'default',
  })
  assert.equal(user, null)
})

test('the preview bypass token is rejected outside the preview environment', () => {
  for (const env of [
    { NODE_ENV: 'production', VERCEL_ENV: 'production', ADMIN_PREVIEW_BYPASS: 'true', ADMIN_PREVIEW_DOMAIN: 'default' },
    { NODE_ENV: 'production', ADMIN_PREVIEW_BYPASS: 'true', ADMIN_PREVIEW_DOMAIN: 'default' },
    { NODE_ENV: 'production', ADMIN_PREVIEW_DOMAIN: 'default' },
  ]) {
    assert.equal(resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, env), null)
  }
})

test('the preview bypass fails closed when no domain is configured', () => {
  const env = { ...PREVIEW_SCOPED, ADMIN_PREVIEW_DOMAIN: '' }

  assert.equal(resolvePreviewBypassDomain(env), null)
  assert.equal(resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, env), null)
})

test('an unconfigured or unknown domain never yields an unscoped principal', () => {
  for (const value of ['', '   ', 'not-a-domain', 'preview-domain; drop table', null, undefined]) {
    const env = { ...PREVIEW_SCOPED, ADMIN_PREVIEW_DOMAIN: value }
    assert.equal(resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, env), null)
  }
})

test('the domain is normalised before matching', () => {
  assert.equal(resolvePreviewBypassDomain({ ...PREVIEW_SCOPED, ADMIN_PREVIEW_DOMAIN: '  DEFAULT ' }), 'default')
})

test('preview enablement reports the effective state, not just the flag', () => {
  assert.equal(isPreviewBypassEnabled(PREVIEW_SCOPED), true)
  assert.equal(isPreviewBypassEnabled({ ...PREVIEW_SCOPED, ADMIN_PREVIEW_DOMAIN: '' }), false)
  assert.equal(isPreviewBypassEnabled({ ...PREVIEW_SCOPED, ADMIN_PREVIEW_BYPASS: 'false' }), false)
})

test('the preview username is configurable but defaults safely', () => {
  assert.equal(resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, PREVIEW_SCOPED)?.username, 'vercel-preview')
  assert.equal(
    resolveBypassAdmin(PREVIEW_DEPLOYMENT_ADMIN_TOKEN, { ...PREVIEW_SCOPED, ADMIN_PREVIEW_USERNAME: 'qa' })?.username,
    'qa'
  )
})

test('non-bypass tokens are left for JWT verification', () => {
  for (const token of ['not-a-token', '', null, undefined, 42]) {
    assert.equal(resolveBypassAdmin(token, { NODE_ENV: 'development' }), null)
  }
})
