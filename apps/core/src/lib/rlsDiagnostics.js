/**
 * Read-only row-level-security diagnostics.
 *
 * Answers the one question that decides whether RLS is a real control on a
 * deployment: which role the application actually connects as. A superuser or
 * `BYPASSRLS` role ignores row-level security even on tables declared
 * `FORCE ROW LEVEL SECURITY`, so the policies in lib/rlsPolicies.js stay inert.
 *
 * Dependency-free by design: the query runner is injected so this module can be
 * unit tested without a database, and imported by the route without pulling in
 * Next.js.
 */

import { RLS_POLICY_TABLES } from './rlsPolicies.js'

/**
 * Tables whose policies are installed at runtime rather than by the policy
 * script. `patient_files` is currently the only FORCEd table in the app, and it
 * is absent from lib/rlsPolicies.js, so the registry alone under-reports what
 * RLS covers.
 */
export const RUNTIME_INSTALLED_RLS_TABLES = ['patient_files']

export const DIAGNOSTIC_TABLES = [
    ...new Set([...RLS_POLICY_TABLES, ...RUNTIME_INSTALLED_RLS_TABLES]),
]

export const ROLE_SQL = `
  SELECT current_user AS name, r.rolsuper, r.rolbypassrls
  FROM pg_roles r
  WHERE r.rolname = current_user
`

export const TABLE_SQL = `
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (
           SELECT count(*)::int
           FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname
         ) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  ORDER BY c.relname
`

/**
 * @param {{ name?: string, rolsuper?: boolean, rolbypassrls?: boolean }} [row]
 */
export function summarizeRole(row) {
    const isSuperuser = row?.rolsuper === true
    const bypassesRls = row?.rolbypassrls === true

    return {
        currentUser: typeof row?.name === 'string' ? row.name : null,
        isSuperuser,
        bypassesRls,
        // The database only enforces policies when the connecting role is
        // neither a superuser nor granted BYPASSRLS.
        rlsEnforcedByRole: !isSuperuser && !bypassesRls,
    }
}

/**
 * @param {Array<{ table_name?: string, rls_enabled?: boolean, rls_forced?: boolean, policy_count?: number|string }>} rows
 * @param {string[]} [expectedTables]
 */
export function summarizeTables(rows, expectedTables = DIAGNOSTIC_TABLES) {
    const list = Array.isArray(rows) ? rows : []
    const tables = list
        .filter((row) => typeof row?.table_name === 'string')
        .map((row) => ({
            table: row.table_name,
            rlsEnabled: row.rls_enabled === true,
            rlsForced: row.rls_forced === true,
            policyCount: Number(row.policy_count || 0),
        }))
        .sort((a, b) => a.table.localeCompare(b.table))

    const present = new Set(tables.map((entry) => entry.table))
    const missingTables = expectedTables.filter((table) => !present.has(table)).sort()

    return {
        tables,
        missingTables,
        expectedTableCount: expectedTables.length,
    }
}

/**
 * Read the role and per-table policy state through an injected query runner.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows?: unknown[] }>} query
 */
export async function readRlsDiagnostics(query) {
    if (typeof query !== 'function') {
        throw new Error('A query runner is required')
    }

    const roleResult = await query(ROLE_SQL)
    const role = summarizeRole(roleResult?.rows?.[0])

    const tableResult = await query(TABLE_SQL, [DIAGNOSTIC_TABLES])
    const tableState = summarizeTables(tableResult?.rows)

    return { role, ...tableState }
}
