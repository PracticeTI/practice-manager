import { NextResponse } from 'next/server'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { buildPgClientConfig as buildPgConfig } from '@/lib/pgClientConfig'

function inferDbType(connectionString) {
    const normalized = String(connectionString || '').toLowerCase()
    if (normalized.startsWith('postgres://') || normalized.startsWith('postgresql://')) return 'postgresql'
    throw new Error('Unsupported connection string protocol; expected postgres://')
}

async function copyPostgres(connectionString, label) {
    const { Client } = await import('pg')
    const client = new Client(buildPgConfig(connectionString))
    await client.connect()

    try {
        await client.query('BEGIN')

        const oldExists = await client.query(
            `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'billing_old'
       LIMIT 1`
        )

        if ((oldExists.rowCount || 0) === 0) {
            await client.query('COMMIT')
            return {
                ok: true,
                target: label,
                dbType: 'postgresql',
                copiedRows: 0,
                skipped: true,
                message: 'billing_old does not exist',
            }
        }

        const insertResult = await client.query(
            `INSERT INTO billing (id, domain, account_id, account_name, metadata)
       SELECT o.id, o.domain, o.billing_account_id, o.billing_account_name, o.metadata
       FROM billing_old o
       LEFT JOIN billing b ON b.id = o.id
       WHERE b.id IS NULL`
        )

        await client.query(
            `SELECT setval(
          pg_get_serial_sequence('billing', 'id'),
          COALESCE((SELECT MAX(id) FROM billing), 1),
          (SELECT COUNT(*) > 0 FROM billing)
      )`
        )

        await client.query('COMMIT')

        return {
            ok: true,
            target: label,
            dbType: 'postgresql',
            copiedRows: insertResult?.rowCount || 0,
        }
    } catch (error) {
        await client.query('ROLLBACK').catch(() => { })
        return {
            ok: false,
            target: label,
            dbType: 'postgresql',
            error: error.message,
        }
    } finally {
        await client.end().catch(() => { })
    }
}

async function copyOne(connectionString, label) {
    const dbType = inferDbType(connectionString)
    if (dbType === 'postgresql') {
        return copyPostgres(connectionString, label)
    }
}

/**
 * POST /api/database/migrate/billing-copy-old
 * Copies data from billing_old to billing with schema mapping:
 * billing_account_id -> account_id
 * billing_account_name -> account_name
 *
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
    try {
        const primaryUrl =
            process.env.SUPABASE_PRIMARY_URL ||
            process.env.DATABASE_URL ||
            process.env.DATABASE_URL_PRIMARY ||
            process.env.POSTGRES_URL

        if (!primaryUrl) {
            return NextResponse.json(
                { success: false, error: 'Primary database not configured in server environment' },
                { status: 400 }
            )
        }

        const primary = await copyOne(primaryUrl, 'primary')
        if (!primary.ok) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Billing copy failed',
                    primary,
                },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            message: 'Copied billing_old rows into billing',
            primary,
            totals: {
                copiedRows: Number(primary.copiedRows || 0),
            },
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Billing copy migration failed' },
            { status: 500 }
        )
    }
}
