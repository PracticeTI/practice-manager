import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

export async function GET() {
  try {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
      return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }
    const conn = await getDatabaseConnection()
    const res = await conn.query('SELECT id, slug, name, image_url, test, verified FROM content_companies ORDER BY id ASC')
    const rows = res.rows
    await conn.end()
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
