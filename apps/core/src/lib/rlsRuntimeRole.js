/**
 * Role posture checks behind the admin RLS panel.
 *
 * A policy only filters rows when the role that finally runs the statement is
 * neither a superuser nor granted `BYPASSRLS`, *and* when the role a request
 * tries to assume can actually be assumed. Both the login role and the
 * `POSTGRES_RLS_RUNTIME_ROLE` role are examined here. Nothing reads tenant data:
 * the assumption is probed inside a transaction that is always rolled back.
 *
 * Dependency-free by design: the query runner is injected so the checks can be
 * unit tested without a database, matching lib/rlsDiagnostics.js.
 */

import { quoteIdentifier } from './rlsPolicies.js'

const ROLE_ATTRIBUTES_SQL = `
  SELECT current_user AS name, r.rolsuper, r.rolbypassrls
  FROM pg_roles r
  WHERE r.rolname = current_user
`

const LOGIN_ROLE_SQL = `
  SELECT session_user AS name,
         r.rolsuper,
         r.rolbypassrls,
         current_user AS effective_name,
         (
           SELECT count(*)::int
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND pg_get_userbyid(c.relowner) = session_user
         ) AS owned_tables
  FROM pg_roles r
  WHERE r.rolname = session_user
`

const RUNTIME_ROLE_SQL = `
  SELECT rolname, rolsuper, rolbypassrls
  FROM pg_roles
  WHERE rolname = $1
`

const ASSUMABLE_SQL = `SELECT pg_has_role(current_user, $1, 'MEMBER') AS allowed`

function bypassesRls(row) {
    return row?.rolsuper === true || row?.rolbypassrls === true
}

function joinReasons(reasons) {
    if (reasons.length <= 1) return reasons[0] || ''
    return `${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`
}

function attributes(row) {
    // `pg_roles` names the column `rolname`; the `current_user` queries alias it.
    const name = typeof row?.name === 'string' ? row.name : row?.rolname
    if (typeof name !== 'string') return 'attributes unavailable'
    return `superuser=${row.rolsuper === true}, bypassrls=${row.rolbypassrls === true}`
}

/**
 * Decide whether the login role's own posture is a finding.
 *
 * A table owner bypasses RLS as surely as a superuser does — `ENABLE ROW LEVEL
 * SECURITY` never applies to the owner, only `FORCE` does — so ownership counts
 * alongside `SUPERUSER` and `BYPASSRLS`.
 *
 * The same posture is normal in development, where one role owns the schema and
 * runs migrations, and a finding in production, where it means most routes read
 * across tenants. Reporting both identically trains people to ignore the warning.
 *
 * `row.name` is the *login* role (`session_user`), not `current_user`. On a pooled
 * connection the two differ whenever another client's session-level `SET ROLE` is
 * still in effect, and reading `current_user` then reports the borrowed role's
 * attributes — passing a login that is actually a BYPASSRLS role.
 *
 * @param {{ name?: string, rolsuper?: boolean, rolbypassrls?: boolean, owned_tables?: number, effective_name?: string }} [row]
 * @param {{ environment?: string }} [options]
 */
export function buildLoginRoleCheck(row, { environment = 'production' } = {}) {
    if (typeof row?.name !== 'string') {
        return {
            id: 'login-role-rls-enforced',
            label: 'Login role obeys RLS',
            status: 'warn',
            detail: 'Unable to read the login role attributes from pg_roles.',
        }
    }

    const assumedNote =
        typeof row.effective_name === 'string' && row.effective_name !== row.name
            ? ` This connection is currently running as ${row.effective_name} — a role it inherited from the pooler — so it reports that role's attributes, not the login credential's.`
            : ''

    const ownedTables = Number.isFinite(row.owned_tables) ? row.owned_tables : 0
    const reasons = [
        row.rolsuper === true ? 'is a superuser' : null,
        row.rolbypassrls === true ? 'holds BYPASSRLS' : null,
        ownedTables > 0 ? `owns ${ownedTables} public table${ownedTables === 1 ? '' : 's'}` : null,
    ].filter(Boolean)

    if (reasons.length === 0) {
        return {
            id: 'login-role-rls-enforced',
            label: 'Login role obeys RLS',
            status: 'pass',
            detail: `${row.name} is neither a superuser, nor holds BYPASSRLS, nor owns public tables (${attributes(row)}).${assumedNote}`,
        }
    }

    const summary = `${row.name} ${joinReasons(reasons)}`

    if (environment !== 'production') {
        return {
            id: 'login-role-rls-enforced',
            label: 'Login role obeys RLS',
            status: 'pass',
            detail: `${summary}. Expected in development, where this role owns the schema and runs migrations; enforcement is exercised by the domain-scoped harnesses (npm run test:rls, npm run rls:verify), not by the login role.${assumedNote}`,
        }
    }

    return {
        id: 'login-role-rls-enforced',
        label: 'Login role obeys RLS',
        status: 'warn',
        detail: `${summary}, so row-level security only applies to requests that assume the constrained runtime role. Every route that still opens a plain connection runs unconstrained.${assumedNote}`,
    }
}

/**
 * Prove the assumption the way a request performs it, then roll back.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows?: unknown[] }>} run
 * @param {string} activeRole
 * @param {string} loginName
 */
async function readEffectiveRoleCheck(run, activeRole, loginName) {
    try {
        await run('BEGIN')
        await run(`SET LOCAL ROLE ${quoteIdentifier(activeRole)}`)
        const row = (await run(ROLE_ATTRIBUTES_SQL)).rows?.[0]
        await run('ROLLBACK')

        const switched = row?.name === activeRole
        const constrained = !bypassesRls(row)

        return {
            id: 'rls-runtime-role-effective',
            label: 'RLS runtime role takes effect',
            status: switched && constrained ? 'pass' : 'fail',
            detail: switched
                ? `${loginName} switched to "${row.name}" (${attributes(row)}) in a probe transaction that was rolled back.`
                : `SET ROLE did not switch the session: current_user is ${row?.name || 'unknown'}.`,
        }
    } catch (error) {
        try {
            await run('ROLLBACK')
        } catch {
            // The transaction may already be gone; the failed check is enough.
        }

        return {
            id: 'rls-runtime-role-effective',
            label: 'RLS runtime role takes effect',
            status: 'fail',
            detail: `SET ROLE "${activeRole}" failed: ${error?.message || 'unknown error'}`,
        }
    }
}

/**
 * Read the role posture through an injected single-connection query runner.
 *
 * `run` must stay on one connection: the assumption probe opens a transaction.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows?: unknown[] }>} run
 * @param {{ activeRole?: string, environment?: string }} [options]
 *   `activeRole` is the role `resolveActiveRlsRole()` reports; `environment` is
 *   `NODE_ENV`, which decides whether the login role's posture is reported as a
 *   finding or as the expected development setup.
 */
export async function readRolePostureChecks(run, { activeRole = '', environment = 'production' } = {}) {
    if (typeof run !== 'function') throw new Error('A query runner is required')

    const login = (await run(LOGIN_ROLE_SQL)).rows?.[0]
    const loginName = typeof login?.name === 'string' ? login.name : 'the login role'
    const checks = [buildLoginRoleCheck(login, { environment })]

    if (!activeRole) {
        checks.push({
            id: 'rls-runtime-role',
            label: 'RLS runtime role',
            status: 'pass',
            detail: 'POSTGRES_RLS_RUNTIME_ROLE is not set, so domain-scoped connections keep the login role. That is only right when DATABASE_URL already logs in as the constrained role.',
        })
        return checks
    }

    checks.push({
        id: 'rls-runtime-role-configured',
        label: 'RLS runtime role configured',
        status: 'pass',
        detail: `Domain-scoped connections run SET ROLE ${quoteIdentifier(activeRole)}.`,
    })

    const roleRow = (await run(RUNTIME_ROLE_SQL, [activeRole])).rows?.[0]
    if (!roleRow) {
        checks.push({
            id: 'rls-runtime-role-exists',
            label: 'RLS runtime role exists',
            status: 'fail',
            detail: `Role "${activeRole}" does not exist, so every domain-scoped query fails. Create it with npm run rls:setup:local.`,
        })
        return checks
    }

    checks.push({
        id: 'rls-runtime-role-exists',
        label: 'RLS runtime role exists',
        status: 'pass',
        detail: `Role "${activeRole}" exists (${attributes(roleRow)}).`,
    })

    const constrained = !bypassesRls(roleRow)
    checks.push({
        id: 'rls-runtime-role-constrained',
        label: 'RLS runtime role is constrained',
        status: constrained ? 'pass' : 'fail',
        detail: constrained
            ? `Role "${activeRole}" is neither a superuser nor holds BYPASSRLS.`
            : `Role "${activeRole}" is a superuser or holds BYPASSRLS, so assuming it leaves policies inert.`,
    })

    const assumable = (await run(ASSUMABLE_SQL, [activeRole])).rows?.[0]?.allowed === true
    checks.push({
        id: 'rls-runtime-role-assumable',
        label: 'RLS runtime role assignable',
        status: assumable ? 'pass' : 'fail',
        detail: assumable
            ? `${loginName} may SET ROLE "${activeRole}".`
            : `${loginName} is not a member of "${activeRole}", so SET ROLE fails and domain-scoped routes error. Grant it with npm run rls:setup:local.`,
    })

    if (assumable) {
        checks.push(await readEffectiveRoleCheck(run, activeRole, loginName))
    }

    return checks
}
