import { NextResponse } from 'next/server'
import { getDatabaseConnection, detectDatabaseType } from '@/lib/database'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'

/**
 * Fetch multiple records from a table.
 *
 * Reads whatever table the caller names, with no domain filter, so it bypasses
 * tenant scoping entirely: superadmin only.
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
    const limit = Math.min(parseInt(searchParams.get('limit')) || 100, 1000)
    const offset = parseInt(searchParams.get('offset')) || 0

    if (!tableName) {
      return NextResponse.json(
        { success: false, error: 'Table name is required' },
        { status: 400 }
      )
    }

    // Validate table name to prevent SQL injection
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

    let records = []
    let totalCount = 0

    try {
      if (normalizedDbType === 'postgresql') {
        // Get total count
        const countResult = await connection.query(`SELECT COUNT(*) as count FROM "${tableName}"`)
        totalCount = parseInt(countResult.rows[0].count)

        // Get paginated records
        const result = await connection.query(
          `SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`,
          [limit, offset]
        )
        records = result.rows
        await connection.end()
      }
    } catch (queryError) {
      console.error(`Error querying table ${tableName}:`, queryError)
      if (normalizedDbType === 'postgresql') {
        await connection.end()
      }
      throw queryError
    }

    return NextResponse.json({
      success: true,
      table: tableName,
      records,
      totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount
    })

  } catch (error) {
    console.error('Error fetching table records:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
