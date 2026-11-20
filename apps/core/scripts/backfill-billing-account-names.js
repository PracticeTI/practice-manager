#!/usr/bin/env node

/**
 * Backfill billing_account_name by looking up patient names via account ID
 * Runs against DATABASE_URL (or DATABASE_URL_PRIMARY when set)
 */

import pkg from 'pg'
const { Pool } = pkg

// Helper to detect database type from connection string
function detectDatabaseType(connectionString) {
    if (!connectionString) return null
    if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) return 'postgresql'
    return null
}

// Create connection pool
async function createConnection(dbType, connectionString) {
    if (dbType === 'postgresql') {
        return new Pool({ connectionString })
    }
    throw new Error(`Unsupported database type: ${dbType}`)
}

// Backfill for a single database
async function backfillDatabase(label, connectionString) {
    if (!connectionString) {
        console.log(`⏭️  Skipping ${label} (no connection string)`)
        return
    }

    const dbType = detectDatabaseType(connectionString)
    if (!dbType) {
        console.log(`⏭️  Skipping ${label} (unable to detect database type)`)
        return
    }

    console.log(`\n📊 Backfilling ${label} (${dbType})...`)

    let connection = null
    try {
        connection = await createConnection(dbType, connectionString)

        // Get billing records with NULL account names
        const billingResult = await connection.query(
            'SELECT id, billing_account_id, domain FROM billing WHERE billing_account_name IS NULL ORDER BY id'
        )
        const billingRecords = billingResult.rows || []

        if (billingRecords.length === 0) {
            console.log(`✓ No billing records to backfill in ${label}`)
            return
        }

        console.log(`Found ${billingRecords.length} billing record(s) needing backfill`)

        let updatedCount = 0
        let skippedCount = 0

        // Process each billing record
        for (const record of billingRecords) {
            const accountId = String(record.billing_account_id).trim()
            const domain = String(record.domain).trim()

            // Look up patient by ID
            let patientName = null
            try {
                const result = await connection.query(
                    'SELECT patient_name FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
                    [accountId, domain]
                )
                patientName = result.rows?.[0]?.patient_name || null
            } catch (err) {
                console.error(`  ⚠ Error looking up patient for account "${accountId}":`, err.message)
                skippedCount++
                continue
            }

            if (!patientName) {
                console.log(`  ⊘ No patient found for account ID "${accountId}" in domain "${domain}"`)
                skippedCount++
                continue
            }

            // Update billing record
            try {
                await connection.query(
                    'UPDATE billing SET billing_account_name = $1, updated_at = NOW() WHERE id = $2',
                    [patientName, record.id]
                )
                updatedCount++
                console.log(`  ✓ Updated billing ID ${record.id} → "${patientName}"`)
            } catch (err) {
                console.error(`  ✗ Failed to update billing ID ${record.id}:`, err.message)
                skippedCount++
            }
        }

        console.log(`\n📈 ${label} Summary:`)
        console.log(`   Updated: ${updatedCount}`)
        console.log(`   Skipped: ${skippedCount}`)
    } catch (error) {
        console.error(`✗ Error backfilling ${label}:`, error.message)
    } finally {
        if (connection) {
            await connection.end()
        }
    }
}

async function main() {
    console.log('🔄 Backfilling billing account names from patient records...\n')

    const primaryDb = process.env.DATABASE_URL || process.env.DATABASE_URL_PRIMARY

    await backfillDatabase('Database', primaryDb)

    console.log('\n✅ Backfill complete!')
}

main().catch((error) => {
    console.error('Fatal error:', error.message)
    process.exit(1)
})
