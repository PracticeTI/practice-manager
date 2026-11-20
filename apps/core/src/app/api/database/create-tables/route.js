import { NextResponse } from 'next/server'
import { getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { coreSchemaStatements } from '@/lib/coreSchema'

/**
 * Create database tables
 * POST /api/database/create-tables
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    const { dbType } = await request.json()

    if (!dbType) {
      return NextResponse.json(
        { success: false, error: 'Database type is required' },
        { status: 400 }
      )
    }

    // Normalize database type to lowercase
    const normalizedDbType = dbType.toLowerCase()

    const connection = await getDatabaseConnection()

    if (!connection) {
      return NextResponse.json(
        { success: false, error: 'Could not connect to database' },
        { status: 500 }
      )
    }

    console.log('Database type:', dbType, '-> normalized:', normalizedDbType)
    console.log('Connection established')

    // Shared with the schema bootstrap so a fresh install and this route cannot drift.
    const sqlStatements = coreSchemaStatements()

    // Execute table creation
    for (const sql of sqlStatements) {
      console.log('Executing SQL:', sql.substring(0, 100) + '...')
      await connection.query(sql)
    }

    // Verify tables were created
    let verificationResult = null
    try {
      if (normalizedDbType === 'postgresql') {
        const result = await connection.query(`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `)
        verificationResult = { tablesFound: result.rows.length, tables: result.rows.map(r => r.table_name) }
        console.log('Tables after creation:', verificationResult)
      }
    } catch (verifyError) {
      console.error('Error verifying tables:', verifyError)
    }

    // Close connection
    await connection.end()

    return NextResponse.json({
      success: true,
      message: 'Tables created successfully',
      tables: ['system_settings', 'domain_settings', 'content', 'content_relationships', 'billing'],
      verification: verificationResult
    })

  } catch (error) {
    console.error('Error creating tables:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
