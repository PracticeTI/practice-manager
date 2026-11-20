import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

/**
 * POST /api/database/productions/add-location-fields
 * Add borough, neighborhood, and area columns to content_productions table
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
        { name: 'borough', type: 'VARCHAR(50)' },
        { name: 'neighborhood', type: 'VARCHAR(100)' },
        { name: 'area', type: 'VARCHAR(255)' }
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

        // Drop old location column if it exists
        try {
          await conn.query(`
            ALTER TABLE content_productions 
            DROP COLUMN IF EXISTS location
          `)
          results.push('✓ Removed old location column')
        } catch (e) {
          results.push(`Note: Could not remove location column: ${e.message}`)
        }
      }

      await conn.end()
      return NextResponse.json({
        success: true,
        message: 'Location fields migration complete',
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
    console.error('Error adding location fields:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
