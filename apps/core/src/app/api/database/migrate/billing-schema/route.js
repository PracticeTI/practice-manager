import { NextResponse } from 'next/server'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { buildPgClientConfig as buildPgConfig } from '@/lib/pgClientConfig'

function inferDbType(connectionString) {
    const normalized = String(connectionString || '').toLowerCase()
    if (normalized.startsWith('postgres://') || normalized.startsWith('postgresql://')) return 'postgresql'
    throw new Error('Unsupported connection string protocol; expected postgres://')
}

async function migratePostgres(connectionString, label) {
    const { Client } = await import('pg')
    const client = new Client(buildPgConfig(connectionString))
    await client.connect()

    const details = {
        renamedToBillingOld: false,
        createdBillingTable: false,
        createdIndexes: false,
    }

    try {
        await client.query('BEGIN')

        const billingExists = await client.query(
            `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'billing'
       LIMIT 1`
        )

        if ((billingExists.rowCount || 0) > 0) {
            const oldSchemaColumn = await client.query(
                `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'billing' AND column_name = 'billing_account_id'
         LIMIT 1`
            )

            if ((oldSchemaColumn.rowCount || 0) > 0) {
                const oldBackupExists = await client.query(
                    `SELECT 1
           FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'billing_old'
           LIMIT 1`
                )

                if ((oldBackupExists.rowCount || 0) === 0) {
                    await client.query('ALTER TABLE billing RENAME TO billing_old')
                    details.renamedToBillingOld = true
                }
            }
        }

        await client.query(`
      CREATE TABLE IF NOT EXISTS billing (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        account_id VARCHAR(255) NOT NULL,
        account_name VARCHAR(255),
        metadata JSONB
      )
    `)
        details.createdBillingTable = true

        await client.query('CREATE INDEX IF NOT EXISTS billing_account_idx ON billing(account_id)')
        await client.query('CREATE INDEX IF NOT EXISTS billing_domain_idx ON billing(domain)')
        details.createdIndexes = true

        await client.query('COMMIT')
        return {
            ok: true,
            target: label,
            dbType: 'postgresql',
            details,
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

async function migrateOne(connectionString, label) {
    const dbType = inferDbType(connectionString)
    if (dbType === 'postgresql') {
        return migratePostgres(connectionString, label)
    }
}

/**
 * POST /api/database/migrate/billing-schema
 * Renames old billing table to billing_old and recreates billing with:
 * id, domain, account_id, account_name, metadata
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

        const primary = await migrateOne(primaryUrl, 'primary')
        if (!primary.ok) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Billing schema migration failed',
                    primary,
                },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            message: 'Billing schema migration completed',
            primary,
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Billing schema migration failed' },
            { status: 500 }
        )
    }
}
