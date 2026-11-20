import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { whenTablesMissing } from './pgOptionalDdl.js'

export async function ensureBillingTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Billing support requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        const existsResult = await connection.query(
            `SELECT 1
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
             LIMIT 1`,
            ['billing']
        )

        const hasBillingTable = (existsResult?.rowCount || 0) > 0
        if (hasBillingTable) {
            const oldSchemaColumnCheck = await connection.query(
                `SELECT 1
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'billing' AND column_name = 'billing_account_id'
                 LIMIT 1`
            )
            const isOldSchema = (oldSchemaColumnCheck?.rowCount || 0) > 0

            if (isOldSchema) {
                const oldTableExists = await connection.query(
                    `SELECT 1
                     FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'billing_old'
                     LIMIT 1`
                )
                if ((oldTableExists?.rowCount || 0) === 0) {
                    await connection.query('ALTER TABLE billing RENAME TO billing_old')
                }
            }
        }

        await whenTablesMissing(connection, ['billing'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS billing (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    account_id VARCHAR(255) NOT NULL,
                    account_name VARCHAR(255),
                    metadata JSONB
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS billing_account_idx ON billing(account_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS billing_domain_idx ON billing(domain)')
        })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}