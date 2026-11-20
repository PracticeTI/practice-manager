import { NextResponse } from 'next/server'
import { buildPgClientConfig } from '@/lib/pgClientConfig'
import { detectDatabaseType, getDatabaseConnectionString } from '@/lib/database'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Get database summary including tables, record counts, and most recent modifications
 * GET /api/database/summary
 */
export async function GET(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response
  try {
    const dbType = detectDatabaseType()

    if (!dbType) {
      return NextResponse.json({
        success: false,
        message: 'No database configured'
      }, { status: 400 })
    }

    const connectionString = getDatabaseConnectionString()

    let summary = null

    switch (dbType) {
      case 'postgresql':
        summary = await getPostgreSQLSummary(connectionString)
        break
      case 'mongodb':
        summary = await getMongoDBSummary(connectionString)
        break
      default:
        return NextResponse.json({
          success: false,
          message: `Unsupported database type: ${dbType}`
        }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      databaseType: dbType,
      ...summary
    })

  } catch (error) {
    console.error('Database summary error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

/**
 * Get PostgreSQL database summary
 */
async function getPostgreSQLSummary(connectionString) {
  const { Pool } = await import('pg')
  const pool = new Pool(buildPgClientConfig(connectionString))

  try {
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT 
        table_name,
        table_schema
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)

    if (tablesResult.rows.length === 0) {
      return {
        isEmpty: true,
        message: 'Database is empty - no tables found',
        tables: []
      }
    }

    const tables = []
    let totalRecords = 0

    // Get details for each table
    for (const table of tablesResult.rows) {
      const tableName = table.table_name

      // Get record count
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`)
      const recordCount = parseInt(countResult.rows[0].count)
      totalRecords += recordCount

      let mostRecentRecord = null
      let oldestRecord = null

      if (recordCount > 0) {
        // Try to find a timestamp column (common names)
        const columnsResult = await pool.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = $1
          AND table_schema = 'public'
          AND (
            column_name ILIKE '%updated%' OR 
            column_name ILIKE '%modified%' OR 
            column_name ILIKE '%created%' OR
            column_name ILIKE '%time%' OR
            column_name ILIKE '%date%'
          )
          AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date', 'datetime')
          ORDER BY 
            CASE 
              WHEN column_name ILIKE '%updated%' THEN 1
              WHEN column_name ILIKE '%modified%' THEN 2
              WHEN column_name ILIKE '%created%' THEN 3
              ELSE 4
            END
          LIMIT 1
        `, [tableName])

        if (columnsResult.rows.length > 0) {
          const timestampColumn = columnsResult.rows[0].column_name

          // Get the most recent record based on timestamp
          const recentResult = await pool.query(`
            SELECT * FROM "${tableName}"
            ORDER BY "${timestampColumn}" DESC
            LIMIT 1
          `)

          if (recentResult.rows.length > 0) {
            mostRecentRecord = {
              timestamp: recentResult.rows[0][timestampColumn],
              timestampColumn: timestampColumn,
              record: recentResult.rows[0]
            }
          }
        }
      }

      tables.push({
        name: tableName,
        recordCount,
        mostRecentRecord,
        oldestRecord
      })
    }

    return {
      isEmpty: totalRecords === 0,
      message: totalRecords === 0 ? 'Database has tables but no records' : null,
      totalTables: tables.length,
      totalRecords,
      tables
    }

  } finally {
    await pool.end()
  }
}

/**
 * Get MongoDB database summary
 */
async function getMongoDBSummary(connectionString) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(connectionString)

  try {
    await client.connect()

    // Get database name from connection string
    const dbMatch = connectionString.match(/\/([^/?]+)(\?|$)/)
    const databaseName = dbMatch ? dbMatch[1] : 'test'

    const db = client.db(databaseName)

    // Get all collections
    const collections = await db.listCollections().toArray()

    if (collections.length === 0) {
      return {
        isEmpty: true,
        message: 'Database is empty - no collections found',
        tables: []
      }
    }

    const tableSummaries = []
    let totalRecords = 0

    // Get details for each collection
    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name
      const collection = db.collection(collectionName)

      // Get record count
      const recordCount = await collection.countDocuments()
      totalRecords += recordCount

      let mostRecentRecord = null

      if (recordCount > 0) {
        // Try to find the most recent record by common timestamp fields
        const timestampFields = [
          'updatedAt', 'updated_at', 'modifiedAt', 'modified_at',
          'createdAt', 'created_at', 'timestamp', 'date'
        ]

        let recentDoc = null
        let usedField = null

        for (const field of timestampFields) {
          const doc = await collection.findOne(
            { [field]: { $exists: true } },
            { sort: { [field]: -1 } }
          )

          if (doc) {
            recentDoc = doc
            usedField = field
            break
          }
        }

        // If no timestamp field found, just get the last inserted document by _id
        if (!recentDoc) {
          recentDoc = await collection.findOne({}, { sort: { _id: -1 } })
          usedField = '_id'
        }

        if (recentDoc) {
          mostRecentRecord = {
            timestamp: recentDoc[usedField],
            timestampColumn: usedField,
            record: recentDoc
          }
        }
      }

      tableSummaries.push({
        name: collectionName,
        recordCount,
        mostRecentRecord
      })
    }

    return {
      isEmpty: totalRecords === 0,
      message: totalRecords === 0 ? 'Database has collections but no documents' : null,
      totalTables: tableSummaries.length,
      totalRecords,
      tables: tableSummaries
    }

  } finally {
    await client.close()
  }
}
