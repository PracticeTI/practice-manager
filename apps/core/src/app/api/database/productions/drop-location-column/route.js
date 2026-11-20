import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

/**
 * POST /api/database/productions/drop-location-column
 * Drop ambiguous location column from content_productions table
 * (Replaced by more specific fields: borough, neighborhood, area)
 */
export async function POST() {
  try {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
      return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const conn = await getDatabaseConnection()

    try {
      if (dbType === 'postgresql') {
        // Drop location column if it exists
        await conn.query(`
          ALTER TABLE content_productions 
          DROP COLUMN IF EXISTS location
        `)
        await conn.end()
        return NextResponse.json({
          success: true,
          message: 'Location column dropped successfully (PostgreSQL)'
        })
      }
    } catch (err) {
      await conn.end()
      return NextResponse.json({
        success: false,
        error: err.message
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Error dropping location column:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
