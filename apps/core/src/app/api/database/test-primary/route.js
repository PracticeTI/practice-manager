import { NextResponse } from 'next/server'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { buildPgClientConfig } from '@/lib/pgClientConfig'

/**
 * Test connection to primary database
 * GET /api/database/test-primary - tests current environment variable
 * POST /api/database/test-primary - tests connection string from request body
 */
export async function GET(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    const databaseUrl = process.env.DATABASE_URL

    if (!databaseUrl) {
      return NextResponse.json({
        configured: false,
        message: 'No primary database URL configured (DATABASE_URL)'
      }, { status: 200 })
    }

    // Detect database type
    const dbType = detectDatabaseType(databaseUrl)

    if (!dbType) {
      return NextResponse.json({
        configured: false,
        type: null,
        error: 'Unable to detect database type from URL'
      }, { status: 200 })
    }

    // Test the connection based on type
    let testResult = null

    switch (dbType) {
      case 'postgresql':
        testResult = await testPostgresConnection(databaseUrl)
        break
      case 'mongodb':
        testResult = await testMongoConnection(databaseUrl)
        break
      default:
        return NextResponse.json({
          configured: true,
          type: dbType,
          error: `Unsupported database type: ${dbType}`
        }, { status: 200 })
    }

    return NextResponse.json({
      configured: true,
      type: dbType,
      url: maskDatabaseUrl(databaseUrl),
      ...testResult
    })

  } catch (error) {
    console.error('Primary database test error:', error)
    return NextResponse.json({
      configured: false,
      error: error.message
    }, { status: 500 })
  }
}

/**
 * Test connection with provided database URL
 * POST /api/database/test-primary
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    const body = await request.json()
    const { envValues } = body

    if (!envValues) {
      return NextResponse.json({
        connected: false,
        error: 'No connection details provided'
      }, { status: 400 })
    }

    // Extract the connection URL from envValues
    // Primary database can be DATABASE_URL or MONGODB_URI
    const databaseUrl = envValues.DATABASE_URL || envValues.MONGODB_URI

    if (!databaseUrl) {
      return NextResponse.json({
        connected: false,
        error: 'No database connection URL provided'
      }, { status: 400 })
    }

    // Detect database type
    const dbType = detectDatabaseType(databaseUrl)

    if (!dbType) {
      return NextResponse.json({
        connected: false,
        error: 'Unable to detect database type from URL'
      }, { status: 400 })
    }

    // Test the connection based on type
    let testResult = null

    switch (dbType) {
      case 'postgresql':
        testResult = await testPostgresConnection(databaseUrl)
        break
      case 'mongodb':
        testResult = await testMongoConnection(databaseUrl)
        break
      default:
        return NextResponse.json({
          connected: false,
          error: `Unsupported database type: ${dbType}`
        }, { status: 400 })
    }

    return NextResponse.json({
      type: dbType,
      url: maskDatabaseUrl(databaseUrl),
      ...testResult
    })

  } catch (error) {
    console.error('Primary database test error:', error)
    return NextResponse.json({
      connected: false,
      error: error.message
    }, { status: 500 })
  }
}

/**
 * Detect database type from connection URL
 */
function detectDatabaseType(url) {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    const protocol = urlObj.protocol.replace(':', '')

    if (protocol === 'postgresql' || protocol === 'postgres') {
      return 'postgresql'
    } else if (protocol === 'mongodb' || protocol === 'mongodb+srv') {
      return 'mongodb'
    }
    return null
  } catch {
    return null
  }
}

/**
 * Test PostgreSQL connection
 */
async function testPostgresConnection(connectionString) {
  try {
    const { Client } = await import('pg')
    const client = new Client(buildPgClientConfig(connectionString, {
      statement_timeout: 5000,
      connectionTimeoutMillis: 5000
    }))

    await client.connect()
    const result = await client.query('SELECT NOW() as current_time, version() as version')
    await client.end()

    const row = result.rows[0]
    return {
      connected: true,
      tested: true,
      timestamp: row.current_time,
      version: row.version.split(',')[0]
    }
  } catch (error) {
    // Provide helpful error messages based on error code
    let errorMessage = error.message
    let suggestion = null

    if (error.code === '3D000') {
      // Database does not exist
      errorMessage = 'Database does not exist'
      suggestion = 'Create the database first using: CREATE DATABASE your_db_name;'
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - PostgreSQL server not running or wrong host/port'
      suggestion = 'Check that PostgreSQL is running and the host/port are correct'
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.message?.includes('timeout expired')) {
      errorMessage = 'Cannot reach database server - connection timeout'
      suggestion = 'Verify the hostname/port are correct and the server is accessible. For cloud databases, check firewall/IP whitelist settings.'
    } else if (error.code === '28P01') {
      errorMessage = 'Authentication failed - invalid username or password'
      suggestion = 'Check your database credentials'
    } else if (error.message?.includes('no pg_hba.conf entry')) {
      errorMessage = 'Connection rejected by PostgreSQL server'
      suggestion = 'The server is not configured to accept connections from your IP. Check pg_hba.conf settings.'
    }

    return {
      connected: false,
      tested: true,
      error: errorMessage,
      suggestion: suggestion,
      errorCode: error.code
    }
  }
}

/**
 * Test MongoDB connection
 */
async function testMongoConnection(connectionString) {
  try {
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    })

    await client.connect()
    const adminDb = client.db('admin')
    const result = await adminDb.command({ ping: 1 })
    await client.close()

    return {
      connected: true,
      tested: true,
      timestamp: new Date().toISOString(),
      message: 'MongoDB connection successful'
    }
  } catch (error) {
    let errorMessage = error.message
    let suggestion = null

    if (error.message && error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Connection refused - MongoDB server not running or wrong host/port'
      suggestion = 'Check that MongoDB is running and the host/port are correct'
    } else if (error.message && (error.message.includes('ETIMEDOUT') || error.message.includes('ENOTFOUND'))) {
      errorMessage = 'Cannot reach MongoDB server - check connection string'
      suggestion = 'Verify your MongoDB connection string and network access'
    } else if (error.name === 'MongoServerError' && error.code === 18) {
      errorMessage = 'Authentication failed - invalid username or password'
      suggestion = 'Check your MongoDB credentials'
    }

    return {
      connected: false,
      tested: true,
      error: errorMessage,
      suggestion: suggestion
    }
  }
}

/**
 * Mask sensitive parts of database URL
 */
function maskDatabaseUrl(url) {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    if (urlObj.password) {
      urlObj.password = '****'
    }
    return urlObj.toString()
  } catch {
    if (url.length > 20) {
      return url.substring(0, 10) + '****' + url.substring(url.length - 10)
    }
    return '****'
  }
}
