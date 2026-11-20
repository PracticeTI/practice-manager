import assert from 'node:assert/strict'
import test from 'node:test'

import { withPostgresRlsContext } from '../src/lib/postgresRlsContext.js'

function fakeConnection() {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [] }
    },
  }
}

test('a scoped preview principal binds the domain and never claims superadmin', async () => {
  const connection = fakeConnection()
  const previousRole = process.env.POSTGRES_RLS_RUNTIME_ROLE
  delete process.env.POSTGRES_RLS_RUNTIME_ROLE

  try {
    await withPostgresRlsContext(connection, { domain: 'preview-domain', role: 'admin' }, async () => ({ rows: [] }))
  } finally {
    if (previousRole !== undefined) process.env.POSTGRES_RLS_RUNTIME_ROLE = previousRole
  }

  const setConfig = connection.queries.find((entry) => entry.sql.includes('set_config'))
  assert.deepEqual(setConfig.params, ['preview-domain', 'admin', ''])
})

test('any role other than superadmin is coerced to admin, which keeps the domain predicate', async () => {
  const connection = fakeConnection()

  await withPostgresRlsContext(connection, { domain: 'preview-domain', role: 'preview' }, async () => ({ rows: [] }))

  const setConfig = connection.queries.find((entry) => entry.sql.includes('set_config'))
  assert.equal(setConfig.params[1], 'admin')
})

test('domain-scoped access is refused without a domain, so no query runs unscoped', async () => {
  const connection = fakeConnection()

  await assert.rejects(
    () => withPostgresRlsContext(connection, { domain: '', role: 'admin' }, async () => ({ rows: [] })),
    /domain is required/
  )

  assert.equal(connection.queries.length, 0)
})
