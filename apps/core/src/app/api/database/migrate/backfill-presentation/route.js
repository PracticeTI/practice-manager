import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { normalizeMetadata, safeJsonParse } from '@/lib/contentNode'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

function hasPresentationDefault(metadata) {
  const parsed = safeJsonParse(metadata, {})
  return !!parsed?.presentation?.default
}

/**
 * POST /api/database/migrate/backfill-presentation
 * Backfill metadata.presentation.default from legacy columns (non-breaking)
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  let connection
  try {
    const body = await request.json().catch(() => ({}))
    const { dryRun = false, limit = null } = body

    const dbType = detectDatabaseType()
    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDatabaseConnection()

    let query = 'SELECT id, title, name, summary, image_url, metadata FROM content'
    if (limit) {
      query += ` LIMIT ${Number(limit)}`
    }

    const result = await connection.query(query)
    const rows = result.rows

    let updated = 0
    for (const row of rows || []) {
      if (hasPresentationDefault(row.metadata)) continue

      const normalized = normalizeMetadata(row.metadata, row)
      const metadataValue = JSON.stringify(normalized)

      if (!dryRun) {
        await connection.query(
          'UPDATE content SET metadata = $1, updated_at = NOW() WHERE id = $2',
          [metadataValue, row.id]
        )
      }

      updated += 1
    }

    return NextResponse.json({
      success: true,
      dryRun,
      updated
    })
  } catch (error) {
    console.error('Error backfilling presentation metadata:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}
