import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROLE_SQL,
  TABLE_SQL,
  readRlsDiagnostics,
  summarizeRole,
  summarizeTables,
} from '../src/lib/rlsDiagnostics.js'

test('a superuser connection never enforces row-level security', () => {
  const summary = summarizeRole({ name: 'postgres', rolsuper: true, rolbypassrls: false })

  assert.equal(summary.currentUser, 'postgres')
  assert.equal(summary.isSuperuser, true)
  assert.equal(summary.rlsEnforcedByRole, false)
})

test('a BYPASSRLS connection never enforces row-level security', () => {
  const summary = summarizeRole({ name: 'app', rolsuper: false, rolbypassrls: true })

  assert.equal(summary.bypassesRls, true)
  assert.equal(summary.rlsEnforcedByRole, false)
})

test('a plain role enforces row-level security', () => {
  assert.equal(summarizeRole({ name: 'practice_manager_app', rolsuper: false, rolbypassrls: false }).rlsEnforcedByRole, true)
})

test('an unreadable role row fails closed', () => {
  const summary = summarizeRole(undefined)

  assert.equal(summary.currentUser, null)
  assert.equal(summary.isSuperuser, false)
  assert.equal(summary.rlsEnforcedByRole, true)
})

test('table state is normalised, sorted, and reports tables that do not exist', () => {
  const summary = summarizeTables(
    [
      { table_name: 'patient_files', rls_enabled: true, rls_forced: true, policy_count: '1' },
      { table_name: 'activities', rls_enabled: true, rls_forced: false, policy_count: '2' },
      { table_name: null },
    ],
    ['activities', 'patient_files', 'notes']
  )

  assert.deepEqual(summary.tables, [
    { table: 'activities', rlsEnabled: true, rlsForced: false, policyCount: 2 },
    { table: 'patient_files', rlsEnabled: true, rlsForced: true, policyCount: 1 },
  ])
  assert.deepEqual(summary.missingTables, ['notes'])
  assert.equal(summary.expectedTableCount, 3)
})

test('diagnostics read the connection role then the policy state for every known table', async () => {
  const calls = []
  const query = async (sql, params) => {
    calls.push({ sql, params })
    if (sql === ROLE_SQL) {
      return { rows: [{ name: 'practice_manager_app', rolsuper: false, rolbypassrls: false }] }
    }
    return { rows: [{ table_name: 'patient_files', rls_enabled: true, rls_forced: true, policy_count: 1 }] }
  }

  const result = await readRlsDiagnostics(query)

  assert.equal(calls.length, 2)
  assert.equal(calls[1].sql, TABLE_SQL)
  assert.ok(Array.isArray(calls[1].params[0]))
  assert.ok(calls[1].params[0].includes('patient_files'))
  assert.equal(result.role.rlsEnforcedByRole, true)
  assert.deepEqual(result.tables, [
    { table: 'patient_files', rlsEnabled: true, rlsForced: true, policyCount: 1 },
  ])
})

test('diagnostics refuse to run without a query runner', async () => {
  await assert.rejects(() => readRlsDiagnostics(undefined), /query runner is required/)
})
