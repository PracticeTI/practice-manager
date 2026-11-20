import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

/**
 * POST /api/database/productions/add-missing-columns
 * Add all missing columns to content_productions table
 */
export async function POST() {
  try {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
      return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const conn = await getDatabaseConnection()
    const results = []

    try {
      const columnsToAdd = [
        { name: 'language', type: 'VARCHAR(16)' },
        { name: 'country', type: 'VARCHAR(2)' },
        { name: 'released_on', type: 'DATE' },
        { name: 'published_at', type: dbType === 'postgresql' ? 'TIMESTAMP' : 'DATETIME' },
        { name: 'runtime_minutes', type: dbType === 'postgresql' ? 'INTEGER' : 'INT' },
        { name: 'rating', type: 'VARCHAR(50)' },
        { name: 'actor1', type: dbType === 'postgresql' ? 'TEXT' : 'VARCHAR(255)' },
        { name: 'actor2', type: dbType === 'postgresql' ? 'TEXT' : 'VARCHAR(255)' },
        { name: 'actor3', type: dbType === 'postgresql' ? 'TEXT' : 'VARCHAR(255)' },
        { name: 'company', type: dbType === 'postgresql' ? 'TEXT' : 'VARCHAR(255)' }
      ]

      if (dbType === 'postgresql') {
        for (const col of columnsToAdd) {
          try {
            await conn.query(`
              ALTER TABLE content_productions 
              ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
            `)
            results.push(`✓ ${col.name}`)
          } catch (e) {
            results.push(`✗ ${col.name}: ${e.message}`)
          }
        }
      }

      await conn.end()
      return NextResponse.json({
        success: true,
        message: 'Column check complete',
        results
      })

    } catch (err) {
      await conn.end()
      return NextResponse.json({
        success: false,
        error: err.message
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Error adding columns:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
