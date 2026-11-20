import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

/**
 * GET /api/database/productions/diagnose
 * Diagnose the content_productions table structure and sample data
 */
export async function GET() {
  try {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
      return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const conn = await getDatabaseConnection()
    const diagnosis = {
      dbType,
      columns: [],
      sampleData: [],
      draftCount: 0
    }

    try {
      // Get column information
      if (dbType === 'postgresql') {
        const { rows: cols } = await conn.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = 'content_productions'
          ORDER BY ordinal_position
        `)
        diagnosis.columns = cols.map(c => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES'
        }))

        // Get sample draft data
        const { rows } = await conn.query(`
          SELECT id, slug, title, 
                 description, summary, body,
                 metadata,
                 status, created_at
          FROM content_productions 
          WHERE status = 'draft'
          LIMIT 5
        `)
        diagnosis.sampleData = rows

        const { rows: countRows } = await conn.query(`
          SELECT COUNT(*) as count FROM content_productions WHERE status = 'draft'
        `)
        diagnosis.draftCount = parseInt(countRows[0].count)

      }

      await conn.end()

      return NextResponse.json({ success: true, diagnosis })

    } catch (queryError) {
      console.error('Diagnosis error:', queryError)
      await conn.end()
      throw queryError
    }

  } catch (e) {
    console.error('Error in diagnosis:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
