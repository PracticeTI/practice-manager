import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { isSuperAdmin, unauthorizedResponse, verifyAdminAuth } from '@/lib/auth'
import { readRlsDiagnostics } from '@/lib/rlsDiagnostics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Report whether row-level security is actually enforced on this deployment.
 *
 * Superadmin-only: the answer tells the caller whether tenant isolation is
 * backed by the database or only by route-level authorization, which is useful
 * reconnaissance for anyone who already has a token.
 *
 * Read-only. Reads pg_roles/pg_class/pg_policies and no tenant data, so it is
 * safe to hit from a preview deployment. See docs/postgres-rls-rollout.md.
 */
export async function GET(request) {
    const user = await verifyAdminAuth(request)
    if (!user) {
        return unauthorizedResponse('Invalid or missing auth token')
    }
    if (!isSuperAdmin(user)) {
        return NextResponse.json({ error: 'Forbidden: superadmin required' }, { status: 403, headers: NO_STORE })
    }

    const type = detectDatabaseType()
    if (type !== 'postgresql') {
        return NextResponse.json(
            { database: { type, rlsApplicable: false } },
            { headers: NO_STORE }
        )
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const { role, tables, missingTables, expectedTableCount } = await readRlsDiagnostics(
            (sql, params) => connection.query(sql, params)
        )

        return NextResponse.json(
            {
                database: {
                    type,
                    ...role,
                    runtimeRoleSetting: Boolean(String(process.env.POSTGRES_RLS_RUNTIME_ROLE || '').trim()),
                },
                tables,
                missingTables,
                expectedTableCount,
            },
            { headers: NO_STORE }
        )
    } catch (error) {
        console.error('RLS diagnostics failed:', error)
        return NextResponse.json(
            { error: 'Failed to read RLS diagnostics' },
            { status: 500, headers: NO_STORE }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
