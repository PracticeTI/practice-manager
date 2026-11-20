import { NextResponse } from 'next/server'
import { getDatabaseConnection, detectDatabaseType } from '@/lib/database'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'

/**
 * Fetch a single record from a table.
 *
 * Reads whatever table the caller names with no domain filter, so it bypasses
 * tenant scoping entirely: superadmin only. The table name is interpolated into
 * the SQL, so it is restricted to an identifier-safe alphabet.
 */
export async function GET(request) {
  try {
    const user = await verifyAdminAuth(request)
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ success: false, error: 'Forbidden: superadmin required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const tableName = searchParams.get('table')

    if (!tableName) {
      return NextResponse.json(
        { success: false, error: 'Table name is required' },
        { status: 400 }
      )
    }

    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return NextResponse.json(
        { success: false, error: 'Invalid table name' },
        { status: 400 }
      )
    }

    const dbType = detectDatabaseType()
    const normalizedDbType = dbType?.toLowerCase()
    const connection = await getDatabaseConnection()

    if (!connection) {
      return NextResponse.json(
        { success: false, error: 'Could not connect to database' },
        { status: 500 }
      )
    }

    let record = null

    if (normalizedDbType === 'postgresql') {
      const result = await connection.query(`SELECT * FROM "${tableName}" LIMIT 1`)
      record = result.rows[0] || null
      await connection.end()
    }

    return NextResponse.json({
      success: true,
      record,
      table: tableName
    })

  } catch (error) {
    console.error('Error fetching table record:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
