import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/drop-moved-columns
 * Drop summary, body, image_url, external_id from content table after moving to metadata
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
    const columnsToRemove = ['summary', 'body', 'image_url', 'external_id']
    const results = {}

    try {
      if (dbType === 'postgresql') {
        for (const col of columnsToRemove) {
          try {
            await conn.query(`ALTER TABLE content DROP COLUMN IF EXISTS ${col}`)
            results[col] = { success: true, message: `Dropped column ${col}` }
            console.log(`✓ Dropped column: ${col}`)
          } catch (err) {
            results[col] = { success: false, error: err.message }
            console.error(`✗ Failed to drop column ${col}:`, err.message)
          }
        }
      }

      await conn.end()

      const allSuccess = Object.values(results).every(r => r.success)

      return NextResponse.json({
        success: allSuccess,
        message: allSuccess
          ? 'All columns dropped successfully'
          : 'Some columns failed to drop',
        results
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
