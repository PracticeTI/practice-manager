import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLoginRoleCheck, readRolePostureChecks } from '../src/lib/rlsRuntimeRole.js'

const CONSTRAINED = { rolname: 'practice_manager_app', rolsuper: false, rolbypassrls: false }

function fakeRunner({
  login = { name: 'mike', rolsuper: true, rolbypassrls: true },
  runtime = CONSTRAINED,
  assumable = true,
  effective = null,
  setRoleError = null,
} = {}) {
  const calls = []
  let inTransaction = false

  const run = async (sql, params) => {
    calls.push({ sql, params })

    if (sql === 'BEGIN') {
      inTransaction = true
      return { rows: [] }
    }
    if (sql === 'ROLLBACK') {
      inTransaction = false
      return { rows: [] }
    }
    if (sql.startsWith('SET LOCAL ROLE')) {
      if (setRoleError) throw new Error(setRoleError)
      return { rows: [] }
    }
    if (sql.includes('pg_has_role')) {
      return { rows: [{ allowed: assumable }] }
    }
    if (sql.includes('WHERE rolname = $1')) {
      return { rows: runtime ? [runtime] : [] }
    }
    if (sql.includes('FROM pg_roles')) {
      const row = inTransaction ? (effective || { name: runtime?.rolname, rolsuper: runtime?.rolsuper, rolbypassrls: runtime?.rolbypassrls }) : login
      return { rows: row ? [row] : [] }
    }

    throw new Error(`unexpected sql: ${sql}`)
  }

  return { run, calls }
}

function byId(checks) {
  return Object.fromEntries(checks.map((check) => [check.id, check]))
}

test('an unset runtime role reports the login role as the effective runtime role', async () => {
  const { run } = fakeRunner()
  const checks = byId(await readRolePostureChecks(run, { activeRole: '' }))

  assert.equal(checks['rls-runtime-role'].status, 'pass')
  assert.ok(!('rls-runtime-role-effective' in checks))
  // A superuser login still warrants a warning: unwired routes bypass RLS.
  assert.equal(checks['login-role-rls-enforced'].status, 'warn')
})

test('a constrained, assignable runtime role passes every assumption check', async () => {
  const { run, calls } = fakeRunner()
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-exists'].status, 'pass')
  assert.match(checks['rls-runtime-role-exists'].detail, /superuser=false, bypassrls=false/)
  assert.equal(checks['rls-runtime-role-constrained'].status, 'pass')
  assert.equal(checks['rls-runtime-role-assumable'].status, 'pass')
  assert.equal(checks['rls-runtime-role-effective'].status, 'pass')
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'), 'the probe transaction is rolled back')
})

test('a missing runtime role fails without attempting to assume it', async () => {
  const { run, calls } = fakeRunner({ runtime: null })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-exists'].status, 'fail')
  assert.ok(!('rls-runtime-role-assumable' in checks))
  assert.ok(!calls.some((call) => call.sql.startsWith('SET LOCAL ROLE')))
})

test('a runtime role that bypasses RLS fails the constrained check', async () => {
  const { run } = fakeRunner({ runtime: { rolname: 'practice_manager_app', rolsuper: false, rolbypassrls: true } })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-exists'].status, 'pass')
  assert.equal(checks['rls-runtime-role-constrained'].status, 'fail')
})

test('a role the login cannot assume fails without running the probe', async () => {
  const { run, calls } = fakeRunner({ assumable: false })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-assumable'].status, 'fail')
  assert.ok(!('rls-runtime-role-effective' in checks))
  assert.ok(!calls.some((call) => call.sql.startsWith('SET LOCAL ROLE')))
})

test('SET ROLE failing at runtime is reported as a failed check', async () => {
  const { run } = fakeRunner({ setRoleError: 'permission denied to set role "practice_manager_app"' })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-effective'].status, 'fail')
  assert.match(checks['rls-runtime-role-effective'].detail, /permission denied/)
})

test('a session that does not switch role fails the effectiveness check', async () => {
  const { run } = fakeRunner({ effective: { name: 'mike', rolsuper: true, rolbypassrls: true } })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app' }))

  assert.equal(checks['rls-runtime-role-effective'].status, 'fail')
  assert.match(checks['rls-runtime-role-effective'].detail, /did not switch/)
})

test('unreadable login role attributes warn instead of passing', () => {
  assert.equal(buildLoginRoleCheck(undefined).status, 'warn')
  assert.equal(buildLoginRoleCheck({ name: 'app', rolsuper: false, rolbypassrls: false }).status, 'pass')
})

test('a bypassing login role stays a warning and names the residual exposure', () => {
  const check = buildLoginRoleCheck({ name: 'postgres', rolsuper: true, rolbypassrls: true })

  assert.equal(check.status, 'warn')
  assert.match(check.detail, /plain connection runs unconstrained/)
})

test('a pooled connection that inherited another role still reports the login credential', () => {
  // The login is BYPASSRLS postgres; the pooler handed this session over running as
  // the constrained runtime role. Reading current_user would pass the check.
  const check = buildLoginRoleCheck({
    name: 'postgres',
    rolsuper: false,
    rolbypassrls: true,
    owned_tables: 0,
    effective_name: 'practice_manager_app',
  })

  assert.equal(check.status, 'warn')
  assert.match(check.detail, /postgres holds BYPASSRLS/)
  assert.match(check.detail, /currently running as practice_manager_app/)
})

test('no inherited-role note is added when the session runs as its login role', () => {
  const check = buildLoginRoleCheck({
    name: 'practice_manager_app',
    rolsuper: false,
    rolbypassrls: false,
    owned_tables: 0,
    effective_name: 'practice_manager_app',
  })

  assert.equal(check.status, 'pass')
  assert.doesNotMatch(check.detail, /currently running as/)
})

test('the same privileged login role is expected in development', () => {
  const row = { name: 'mike', rolsuper: true, rolbypassrls: true, owned_tables: 63 }

  assert.equal(buildLoginRoleCheck(row, { environment: 'production' }).status, 'warn')

  const development = buildLoginRoleCheck(row, { environment: 'development' })
  assert.equal(development.status, 'pass')
  assert.match(development.detail, /Expected in development/)
})

test('ownership alone is a finding in production, because owners bypass RLS', () => {
  const check = buildLoginRoleCheck(
    { name: 'app_owner', rolsuper: false, rolbypassrls: false, owned_tables: 12 },
    { environment: 'production' }
  )

  assert.equal(check.status, 'warn')
  assert.match(check.detail, /owns 12 public tables/)
})

test('a fully constrained login role passes in production', () => {
  const check = buildLoginRoleCheck(
    { name: 'app', rolsuper: false, rolbypassrls: false, owned_tables: 0 },
    { environment: 'production' }
  )

  assert.equal(check.status, 'pass')
  assert.match(check.detail, /neither a superuser/)
})

test('development downgrades the login-role finding through the posture reader', async () => {
  const { run } = fakeRunner({ login: { name: 'mike', rolsuper: true, rolbypassrls: true, owned_tables: 63 } })
  const checks = byId(await readRolePostureChecks(run, { activeRole: 'practice_manager_app', environment: 'development' }))

  assert.equal(checks['login-role-rls-enforced'].status, 'pass')
})
