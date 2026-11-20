import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/drop-metadata-columns
 * Drop the non-searchable columns from content table after they've been moved to metadata JSON
 * Only run this AFTER consolidate-metadata has been executed
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
    const columnsToRemove = [
      'slug', 'source', 'date_primary', 'country', 'language', 'nationality',
      'website', 'runtime_minutes', 'rating', 'author', 'tags', 'attributes', 'verified', 'test'
    ]
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
