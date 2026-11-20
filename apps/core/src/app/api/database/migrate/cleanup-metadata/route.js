import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/cleanup-metadata
 * Remove unnecessary fields from metadata JSON
 * Fields to remove: test, country, website, language, verified, attributes, nationality, date_primary, runtime_minutes
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
    const results = { cleaned: 0, errors: [] }
    const fieldsToRemove = ['test', 'country', 'website', 'language', 'verified', 'attributes', 'nationality', 'date_primary', 'runtime_minutes']

    try {
      if (dbType === 'postgresql') {
        const { rows: records } = await conn.query('SELECT id, metadata FROM content WHERE metadata IS NOT NULL')

        console.log(`Found ${records.length} records to clean`)

        for (const record of records) {
          let metadata = record.metadata || {}
          let modified = false

          // Remove unwanted fields
          for (const field of fieldsToRemove) {
            if (field in metadata) {
              delete metadata[field]
              modified = true
            }
          }

          if (modified) {
            try {
              await conn.query(
                `UPDATE content SET metadata = $1 WHERE id = $2`,
                [JSON.stringify(metadata), record.id]
              )
              results.cleaned++
            } catch (err) {
              results.errors.push({ id: record.id, error: err.message })
              console.error(`Error cleaning record ${record.id}:`, err.message)
            }
          }
        }
      }

      await conn.end()

      return NextResponse.json({
        success: results.errors.length === 0,
        message: `Cleaned ${results.cleaned} records`,
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
