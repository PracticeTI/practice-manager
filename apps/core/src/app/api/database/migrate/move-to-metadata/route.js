import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/move-to-metadata
 * Move summary, body, image_url to metadata and drop external_id
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
    const results = { migrated: 0, errors: [] }

    try {
      if (dbType === 'postgresql') {
        const { rows: records } = await conn.query('SELECT id, summary, body, image_url, metadata FROM content')

        console.log(`Found ${records.length} records to migrate`)

        for (const record of records) {
          let metadata = record.metadata || {}

          // Move fields to metadata if they have values
          if (record.summary) metadata.summary = record.summary
          if (record.body) metadata.body = record.body
          if (record.image_url) metadata.image_url = record.image_url

          try {
            await conn.query(
              `UPDATE content SET metadata = $1 WHERE id = $2`,
              [JSON.stringify(metadata), record.id]
            )
            results.migrated++
          } catch (err) {
            results.errors.push({ id: record.id, error: err.message })
            console.error(`Error migrating record ${record.id}:`, err.message)
          }
        }
      }

      await conn.end()

      return NextResponse.json({
        success: results.errors.length === 0,
        message: `Migrated ${results.migrated} records to metadata`,
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
