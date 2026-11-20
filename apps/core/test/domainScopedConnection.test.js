import assert from 'node:assert/strict'
import test from 'node:test'

import { applySessionRlsContext, resolveActiveRlsRole } from '../src/lib/postgresRlsContext.js'

function fakeConnection() {
  const queries = []
  return {
    queries,
    ended: false,
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [] }
    },
    async end() {
      this.ended = true
    },
  }
}

function withEnv(overrides, run) {
  const previous = {}
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key]
    if (overrides[key] === undefined) delete process.env[key]
    else process.env[key] = overrides[key]
  }
  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('the session is bound to the domain before any other statement', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: undefined, NODE_ENV: 'development' }, () =>
    applySessionRlsContext(connection, { domain: 'preview-domain' })
  )

  const setRole = connection.queries[0]
  const setConfig = connection.queries[1]

  assert.match(setRole.sql, /^SET ROLE "practice_manager_app"$/)
  assert.match(setConfig.sql, /set_config\('app\.current_domain', \$1, false\)/)
  assert.deepEqual(setConfig.params, ['preview-domain', 'admin', ''])
})

test('a superadmin is still bound to the domain it is acting in', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: undefined, NODE_ENV: 'development' }, () =>
    applySessionRlsContext(connection, { domain: 'domain-b', role: 'superadmin' })
  )

  const setConfig = connection.queries.find((entry) => entry.sql.includes('set_config'))
  assert.deepEqual(setConfig.params, ['domain-b', 'admin', ''])
})

test('a username is bound for tables scoped to one admin', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: undefined, NODE_ENV: 'development' }, () =>
    applySessionRlsContext(connection, { domain: 'preview-domain', username: ' Practice.Owner ' })
  )

  const setConfig = connection.queries.find((entry) => entry.sql.includes('set_config'))
  assert.deepEqual(setConfig.params, ['preview-domain', 'admin', 'practice.owner'])
})

test('the configured runtime role wins over the development default', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: 'practice_prod', NODE_ENV: 'development' }, () =>
    applySessionRlsContext(connection, { domain: 'preview-domain' })
  )

  assert.match(connection.queries[0].sql, /SET ROLE "practice_prod"/)
})

test('no SET ROLE is issued when the connection already uses the constrained role', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: undefined, NODE_ENV: 'production' }, () =>
    applySessionRlsContext(connection, { domain: 'preview-domain' })
  )

  assert.equal(connection.queries.length, 1)
  assert.match(connection.queries[0].sql, /set_config/)
})

test('binding without a domain throws rather than running unscoped', async () => {
  const connection = fakeConnection()

  await withEnv({ POSTGRES_RLS_RUNTIME_ROLE: undefined, NODE_ENV: 'development' }, async () => {
    await assert.rejects(() => applySessionRlsContext(connection, {}), /domain is required/)
    await assert.rejects(() => applySessionRlsContext({}, { domain: 'preview-domain' }), /connection is required/)
  })

  assert.equal(connection.queries.length, 0)
})

test('the active role reports what will actually be assumed', () => {
  assert.equal(resolveActiveRlsRole({ NODE_ENV: 'development' }), 'practice_manager_app')
  assert.equal(resolveActiveRlsRole({ NODE_ENV: 'production' }), '')
  assert.equal(resolveActiveRlsRole({ NODE_ENV: 'production', POSTGRES_RLS_RUNTIME_ROLE: 'app' }), 'app')
})

test('the patient record tables are registered so the policy script covers them', async () => {
  const { RLS_POLICY_TABLES, PATIENT_RECORD_TABLES, buildPolicyStatements } = await import('../src/lib/rlsPolicies.js')

  for (const table of ['patients', 'patient_reports', 'patient_analysis', 'patient_transcriptions', 'billing', 'chats']) {
    assert.ok(PATIENT_RECORD_TABLES.includes(table), `${table} missing from PATIENT_RECORD_TABLES`)
    assert.ok(RLS_POLICY_TABLES.includes(table), `${table} missing from RLS_POLICY_TABLES`)
  }

  // The table with its own FORCEd policy stays out of the registry.
  assert.equal(RLS_POLICY_TABLES.includes('patient_files'), false, 'patient_files should not be in the registry')

  // Public content and admin identities are registered with their own access models.
  for (const table of ['content', 'admin_users']) {
    assert.ok(RLS_POLICY_TABLES.includes(table), `${table} missing from RLS_POLICY_TABLES`)
  }

  const statements = buildPolicyStatements().join('\n')
  assert.match(statements, /ALTER TABLE public\."patients" ENABLE ROW LEVEL SECURITY/)
  assert.match(statements, /CREATE POLICY "patients_domain_policy"/)
  assert.match(statements, /DROP POLICY IF EXISTS "dev_allow_all_patients"/)
})
