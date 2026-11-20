import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/consolidate-title
 * Move title to name where name is null, then drop title column
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    const dbType = detectDatabaseType()

    if (dbType !== 'postgresql') {
      return NextResponse.json(
        { success: false, error: 'Relational database required' },
        { status: 400 }
      )
    }

    const conn = await getDatabaseConnection()
    let consolidated = 0

    try {
      // Update records where name is null but title has a value
      if (dbType === 'postgresql') {
        const result = await conn.query(
          `UPDATE content SET name = title WHERE (name IS NULL OR name = '') AND title IS NOT NULL AND title != ''`
        )
        consolidated = result.rowCount || 0

        // Drop the title column
        await conn.query(`ALTER TABLE content DROP COLUMN IF EXISTS title`)
        console.log(`✓ Consolidated ${consolidated} records and dropped title column`)
      }

      await conn.end()

      return NextResponse.json({
        success: true,
        message: `Consolidated ${consolidated} records and dropped title column`,
        consolidated
      })
    } catch (queryError) {
      console.error('Query error:', queryError)
      await conn.end()
      throw queryError
    }
  } catch (error) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
