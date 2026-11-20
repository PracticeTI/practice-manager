import { NextResponse } from 'next/server'
import { checkAndStartLocalDatabase } from '@/lib/localDatabase'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Check and start local database
 * POST /api/database/start-local
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    // Get database URL from environment
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL

    if (!databaseUrl) {
      return NextResponse.json({
        error: 'No database URL configured',
        message: 'Please configure a database first'
      }, { status: 400 })
    }

    // Check and start local database
    const result = await checkAndStartLocalDatabase(databaseUrl)

    return NextResponse.json(result)

  } catch (error) {
    console.error('Error starting local database:', error)
    return NextResponse.json({
      error: 'Failed to start local database',
      details: error.message
    }, { status: 500 })
  }
}
