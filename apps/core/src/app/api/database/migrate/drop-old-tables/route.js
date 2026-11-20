import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/drop-old-tables
 * Drop legacy content_productions, content_actors, content_companies, content_posts, curated_images tables
 * These have been replaced by the unified content table with content_relationships
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
    const tablesToDrop = ['content_productions', 'content_actors', 'content_companies', 'content_posts', 'curated_images']
    const results = {}

    try {
      if (dbType === 'postgresql') {
        for (const table of tablesToDrop) {
          try {
            await conn.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
            results[table] = { success: true, message: `Dropped ${table}` }
            console.log(`✓ Dropped table: ${table}`)
          } catch (err) {
            results[table] = { success: false, error: err.message }
            console.error(`✗ Failed to drop ${table}:`, err.message)
          }
        }
      }
    } finally {
      await conn.end()
    }

    const allSuccess = Object.values(results).every(r => r.success)

    return NextResponse.json({
      success: allSuccess,
      message: allSuccess
        ? 'All legacy tables dropped successfully'
        : 'Some tables failed to drop',
      results
    })
  } catch (error) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
