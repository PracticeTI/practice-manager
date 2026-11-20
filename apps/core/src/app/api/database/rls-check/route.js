import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/auth'
import { isSupabaseConnectionString } from '@/lib/supabaseRls'
import { requireAdminAuth } from '@/lib/operatorRouteAuth'
import { resolveActiveRlsRole } from '@/lib/postgresRlsContext'
import { readRolePostureChecks } from '@/lib/rlsRuntimeRole'
import { buildRouteCoverageCheck, parseRouteCoverage } from '@/lib/rlsRouteCoverage'
import { buildPgClientConfig as buildPgConfig } from '@/lib/pgClientConfig'
import { canReadRlsDiagnostics } from '@/lib/rlsPanelAccess'

function resolvePrimaryDatabaseUrl() {
    return process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
}

/**
 * Check RLS posture for the primary PostgreSQL database.
 * GET /api/database/rls-check
 *
 * Superadmins only, plus simulated admin sessions, which exist so the operator can
 * confirm what a domain admin's session is allowed to do. See lib/rlsPanelAccess.js.
 */
export async function GET(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response

    if (!canReadRlsDiagnostics(auth.user, { superAdmin: isSuperAdmin(auth.user) })) {
        return NextResponse.json(
            { success: false, error: 'Forbidden: superadmin or simulated admin required' },
            { status: 403 }
        )
    }
    const connectionString = resolvePrimaryDatabaseUrl()
    const checks = []
    const errors = []

    if (!connectionString) {
        checks.push({
            id: 'primary-db-configured',
            label: 'Primary database configured',
            status: 'fail',
            detail: 'DATABASE_URL is not set for the primary database.',
        })

        return NextResponse.json({
            success: false,
            supported: false,
            databaseType: 'none',
            checks,
            errors,
            summary: {
                totalChecks: checks.length,
                passedChecks: 0,
                warningChecks: 0,
                failedChecks: 1,
            },
        })
    }

    if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) {
        checks.push({
            id: 'primary-db-is-postgres',
            label: 'Primary database is PostgreSQL',
            status: 'fail',
            detail: 'RLS checks are available only for PostgreSQL primary databases.',
        })

        return NextResponse.json({
            success: false,
            supported: false,
            databaseType: 'non-postgres',
            checks,
            errors,
            summary: {
                totalChecks: checks.length,
                passedChecks: 0,
                warningChecks: 0,
                failedChecks: 1,
            },
        })
    }

    const { Pool } = await import('pg')
    const pool = new Pool(buildPgConfig(connectionString))

    try {
        checks.push({
            id: 'primary-db-configured',
            label: 'Primary database configured',
            status: 'pass',
            detail: 'Primary PostgreSQL connection string is present.',
        })

        const connectResult = await pool.query('SELECT current_database() AS database_name, current_user AS current_user')
        const connectionMeta = connectResult?.rows?.[0] || {}

        checks.push({
            id: 'primary-db-connection',
            label: 'Primary database connection',
            status: 'pass',
            detail: `Connected as ${connectionMeta.current_user || 'unknown user'} to ${connectionMeta.database_name || 'unknown database'}.`,
        })

        const supabaseConnection = isSupabaseConnectionString(connectionString)
        checks.push({
            id: 'supabase-connection',
            label: 'Supabase-hosted primary database',
            status: 'pass',
            detail: supabaseConnection
                ? 'Primary database host matches Supabase.'
                : 'Primary database is not hosted on Supabase. RLS is still supported on PostgreSQL.',
        })

        // Role posture decides whether the policies below can ever filter a row.
        // Runs on one client because the assumption probe needs a transaction.
        const postureClient = await pool.connect()
        try {
            checks.push(...await readRolePostureChecks(
                (sql, params) => postureClient.query(sql, params),
                { activeRole: resolveActiveRlsRole(), environment: process.env.NODE_ENV }
            ))
        } catch (error) {
            errors.push(`Role posture checks failed: ${error?.message || 'unknown error'}`)
            checks.push({
                id: 'rls-runtime-role',
                label: 'RLS runtime role',
                status: 'fail',
                detail: 'Unable to read role posture checks.',
            })
        } finally {
            postureClient.release()
        }

        // The login-role check warns that routes opening a plain connection run
        // unconstrained; this is the list of those routes, captured at build time.
        const routeCoverage = parseRouteCoverage(process.env.PRACTICE_RLS_ROUTE_COVERAGE)
        checks.push(buildRouteCoverageCheck(routeCoverage))

        const tablesResult = await pool.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
      ORDER BY c.relname
    `)

        const policyResult = await pool.query(`
      SELECT tablename, COUNT(*)::int AS policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
    `)

        const policyCountByTable = new Map(
            (policyResult.rows || []).map((row) => [row.tablename, Number(row.policy_count || 0)])
        )

        const tableRows = tablesResult.rows || []
        const rlsDisabledTables = tableRows
            .filter((row) => row.rls_enabled !== true)
            .map((row) => row.table_name)

        const missingPolicyTables = tableRows
            .filter((row) => row.rls_enabled === true && Number(policyCountByTable.get(row.table_name) || 0) === 0)
            .map((row) => row.table_name)

        checks.push({
            id: 'public-tables-discovered',
            label: 'Public tables discovered',
            status: 'pass',
            detail: `Found ${tableRows.length} public table(s).`,
        })

        checks.push({
            id: 'rls-enabled-public-tables',
            label: 'RLS enabled on public tables',
            status: rlsDisabledTables.length === 0 ? 'pass' : 'fail',
            detail: rlsDisabledTables.length === 0
                ? 'RLS is enabled on all public tables.'
                : `RLS is disabled on ${rlsDisabledTables.length} table(s): ${rlsDisabledTables.join(', ')}.`,
        })

        checks.push({
            id: 'rls-policies-present',
            label: 'RLS policies present',
            status: missingPolicyTables.length === 0 ? 'pass' : 'warn',
            detail: missingPolicyTables.length === 0
                ? 'All RLS-enabled public tables have at least one policy.'
                : `${missingPolicyTables.length} RLS-enabled table(s) have no policies: ${missingPolicyTables.join(', ')}.`,
        })

        const tableChecks = tableRows.map((row) => {
            const policyCount = Number(policyCountByTable.get(row.table_name) || 0)
            const status = row.rls_enabled === true
                ? (policyCount > 0 ? 'pass' : 'warn')
                : 'fail'

            let detail = 'RLS disabled.'
            if (row.rls_enabled === true && policyCount > 0) {
                detail = `${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} configured.`
            } else if (row.rls_enabled === true) {
                detail = 'RLS enabled, but no policies configured.'
            }

            return {
                tableName: row.table_name,
                rlsEnabled: row.rls_enabled === true,
                rlsForced: row.rls_forced === true,
                policyCount,
                status,
                detail,
            }
        })

        const summary = {
            totalChecks: checks.length,
            passedChecks: checks.filter((check) => check.status === 'pass').length,
            warningChecks: checks.filter((check) => check.status === 'warn').length,
            failedChecks: checks.filter((check) => check.status === 'fail').length,
        }

        return NextResponse.json({
            success: summary.failedChecks === 0,
            supported: true,
            databaseType: 'postgresql',
            checkedAt: new Date().toISOString(),
            checks,
            errors,
            summary,
            details: {
                tableChecks,
                routeCoverage,
            },
        })
    } catch (error) {
        errors.push(error?.message || 'Unknown error during RLS check')

        checks.push({
            id: 'primary-db-connection',
            label: 'Primary database connection',
            status: 'fail',
            detail: 'Unable to run RLS checks against the primary database.',
        })

        return NextResponse.json({
            success: false,
            supported: true,
            databaseType: 'postgresql',
            checkedAt: new Date().toISOString(),
            checks,
            errors,
            summary: {
                totalChecks: checks.length,
                passedChecks: checks.filter((check) => check.status === 'pass').length,
                warningChecks: checks.filter((check) => check.status === 'warn').length,
                failedChecks: checks.filter((check) => check.status === 'fail').length,
            },
            details: {
                tableChecks: [],
                routeCoverage: null,
            },
        }, { status: 500 })
    } finally {
        await pool.end().catch(() => { })
    }
}