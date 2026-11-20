import assert from 'node:assert/strict'
import test from 'node:test'

import { recordBypassUse, resetBypassAuditState } from '../src/lib/adminBypassAudit.js'

const PREVIEW_USER = { username: 'vercel-preview', role: 'admin', domain: 'preview-domain', bypass: 'preview' }

function captureWarnings(run) {
  const lines = []
  const original = console.warn
  console.warn = (message) => lines.push(String(message))
  try {
    const result = run()
    return { lines, result }
  } finally {
    console.warn = original
  }
}

test('a bypass request emits one structured audit line', () => {
  resetBypassAuditState()

  const { lines, result } = captureWarnings(() =>
    recordBypassUse(PREVIEW_USER, { path: '/api/database/patient-files', method: 'GET', host: 'dev.example.com' }, 1000)
  )

  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith('[admin-bypass] '))

  const entry = JSON.parse(lines[0].slice('[admin-bypass] '.length))
  assert.equal(entry.bypass, 'preview')
  assert.equal(entry.principal, 'vercel-preview')
  assert.equal(entry.role, 'admin')
  assert.equal(entry.domain, 'preview-domain')
  assert.equal(entry.method, 'GET')
  assert.equal(entry.path, '/api/database/patient-files')
  assert.equal(entry.host, 'dev.example.com')
  assert.equal(entry.at, new Date(1000).toISOString())
  assert.deepEqual(result, entry)
})

test('repeat hits on the same route are collapsed so polling cannot bury the signal', () => {
  resetBypassAuditState()

  const { lines } = captureWarnings(() => {
    recordBypassUse(PREVIEW_USER, { path: '/api/health' }, 1000)
    recordBypassUse(PREVIEW_USER, { path: '/api/health' }, 2000)
    recordBypassUse(PREVIEW_USER, { path: '/api/health' }, 3000)
  })

  assert.equal(lines.length, 1)
})

test('a new window logs the route again, and a different route logs independently', () => {
  resetBypassAuditState()

  const { lines } = captureWarnings(() => {
    recordBypassUse(PREVIEW_USER, { path: '/api/health' }, 1000)
    recordBypassUse(PREVIEW_USER, { path: '/api/health' }, 61_000)
    recordBypassUse(PREVIEW_USER, { path: '/api/database/patients' }, 61_000)
  })

  assert.equal(lines.length, 3)
})

test('ordinary JWT sessions are never audited as bypasses', () => {
  resetBypassAuditState()

  const { lines, result } = captureWarnings(() => recordBypassUse({ username: 'admin', role: 'admin', domain: 'x' }))

  assert.equal(lines.length, 0)
  assert.equal(result, null)
  assert.equal(recordBypassUse(null), null)
})
