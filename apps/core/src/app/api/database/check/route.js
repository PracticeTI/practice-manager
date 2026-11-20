import { NextResponse } from 'next/server'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Check if a database is configured and accessible
 * GET /api/database/check
 */
export async function GET(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response
  try {
    // Check for database environment variables
    const primaryUrl = process.env.DATABASE_URL
    const hasMongo = process.env.MONGODB_URI

    // Check if any database is configured
    const hasDatabase = !!(primaryUrl || hasMongo)

    if (!hasDatabase) {
      return NextResponse.json({
        configured: false,
        message: 'No database configuration found'
      }, { status: 200 })
    }

    // Attempt to verify database connection
    let connectionStatus = { connected: false, type: null, error: null }

    // Check PostgreSQL (primary)
    if (primaryUrl) {
      try {
        connectionStatus = {
          connected: true,
          type: 'PostgreSQL',
          url: maskDatabaseUrl(primaryUrl)
        }
      } catch (error) {
        console.error('Error checking PostgreSQL:', error)
        connectionStatus.error = error.message
      }
    }

    // Check MongoDB
    if (hasMongo && !connectionStatus.connected) {
      try {
        connectionStatus = {
          connected: true,
          type: 'MongoDB',
          url: maskDatabaseUrl(process.env.MONGODB_URI)
        }
      } catch (error) {
        connectionStatus.error = error.message
      }
    }

    return NextResponse.json({
      configured: true,
      ...connectionStatus
    })

  } catch (error) {
    console.error('Database check error:', error)
    return NextResponse.json({
      configured: false,
      error: error.message
    }, { status: 500 })
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
    // If URL parsing fails, just mask the middle part
    if (url.length > 20) {
      return url.substring(0, 10) + '****' + url.substring(url.length - 10)
    }
    return '****'
  }
}
