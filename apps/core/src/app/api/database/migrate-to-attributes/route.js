import { NextResponse } from 'next/server'
import { getDatabaseConnection, detectDatabaseType } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Migrate location data from columns to attributes
 * POST /api/database/migrate-to-attributes
 * 
 * This migration:
 * 1. Drops borough, neighborhood, area columns from content table
 * 2. Deletes all production records (testing phase)
 * 
 * Location data will now be stored in attributes.location:
 * {
 *   "location": {
 *     "borough": "Brooklyn",
 *     "neighborhood": "Williamsburg",
 *     "area": "East Williamsburg"
 *   }
 * }
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  let connection
  try {
    const dbType = detectDatabaseType()

    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this migration' },
        { status: 400 }
      )
    }

    connection = await getDatabaseConnection()

    const steps = []

    // Step 1: Delete all production records
    console.log('Deleting all production records...')

    await connection.query("DELETE FROM content WHERE type = 'production'")

    steps.push('Deleted all production records')

    // Step 2: Drop the location columns
    console.log('Dropping location columns...')

    const dropColumnsSQL = [
      'ALTER TABLE content DROP COLUMN IF EXISTS borough',
      'ALTER TABLE content DROP COLUMN IF EXISTS neighborhood',
      'ALTER TABLE content DROP COLUMN IF EXISTS area'
    ]

    for (const sql of dropColumnsSQL) {
      try {
        await connection.query(sql)
        steps.push(`Executed: ${sql}`)
      } catch (error) {
        // Column might not exist - continue
        if (!error.message.includes('does not exist')) {
          throw error
        }
        steps.push(`Skipped: ${sql} (column doesn't exist)`)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      steps
    })

  } catch (error) {
    console.error('Migration error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        details: error.stack
      },
      { status: 500 }
    )
  } finally {
    if (connection) {
      try {
        await connection.end()
      } catch (error) {
        console.error('Error closing connection:', error)
      }
    }
  }
}
