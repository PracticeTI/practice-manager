import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'

/**
 * Get current database configuration.
 *
 * Returns unmasked connection strings, so it is superadmin-only and refuses to
 * answer without a verified token. The token is read from the Authorization
 * header only — a `?token=` query parameter would put a credential in request
 * logs, browser history and Referer headers.
 */
export async function GET(request) {
  try {
    const user = await verifyAdminAuth(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden: superadmin required' }, { status: 403 })
    }

    // Collect current database configuration from environment variables
    // Return unmasked values since this is an authenticated superadmin-only endpoint
    const config = {}

    // Primary Database Connection
    if (process.env.DATABASE_URL) {
      config.DATABASE_URL = process.env.DATABASE_URL
    }

    // Check for MongoDB
    if (process.env.MONGODB_URI) {
      config.MONGODB_URI = process.env.MONGODB_URI
    }


    return NextResponse.json(config)
  } catch (error) {
    console.error('Error fetching current config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}
