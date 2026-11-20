import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * POST /api/database/migrate/consolidate-metadata
 * Move non-searchable fields to metadata JSON field
 * Fields to move: slug, source, date_primary, country, language, nationality, website, runtime_minutes, rating, author, tags, attributes, verified, test
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
        // Get all content records
        const { rows: records } = await conn.query('SELECT * FROM content')

        console.log(`Found ${records.length} records to migrate`)

        // For each record, consolidate metadata
        for (const record of records) {
          const metadata = record.metadata || {}

          // Move non-searchable fields to metadata
          metadata.slug = record.slug
          metadata.source = record.source
          metadata.date_primary = record.date_primary
          metadata.country = record.country
          metadata.language = record.language
          metadata.nationality = record.nationality
          metadata.website = record.website
          metadata.runtime_minutes = record.runtime_minutes
          metadata.rating = record.rating
          metadata.author = record.author
          metadata.tags = record.tags
          metadata.attributes = record.attributes
          metadata.verified = record.verified
          metadata.test = record.test

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
