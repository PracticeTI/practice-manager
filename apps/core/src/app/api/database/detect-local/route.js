import { NextResponse } from 'next/server'
import { detectLocalPostgres, findPgPassEntry, tryPsqlConnect, isPostgreSQLInstalled } from '@/lib/localDatabase'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Detect a locally running PostgreSQL server (localhost on common ports)
 * POST /api/database/detect-local
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  try {
    const detection = await detectLocalPostgres()

    if (!detection.running) {
      return NextResponse.json({
        running: false,
        message: detection.message || 'No local PostgreSQL detected'
      })
    }

    // Try to find credentials via pgpass
    const pgpass = findPgPassEntry(detection.host, detection.port, 'postgres')

    if (pgpass) {
      const ok = await tryPsqlConnect({ host: detection.host, port: detection.port, user: pgpass.user, database: pgpass.database === '*' ? 'postgres' : pgpass.database, password: pgpass.password })
      if (ok) {
        const dbName = pgpass.database === '*' ? 'postgres' : pgpass.database
        const suggestedUrl = `postgresql://${pgpass.user}:${pgpass.password}@${detection.host}:${detection.port}/${dbName}`
        return NextResponse.json({
          running: true,
          host: detection.host,
          port: detection.port,
          suggestedUrl,
          authenticated: true,
          source: 'pgpass',
          note: 'Credentials loaded from pgpass. You can save this directly.'
        })
      }
    }

    // Check if psql is available to verify passwordless login
    const hasPsql = await isPostgreSQLInstalled()
    let noPwdOk = false
    if (hasPsql) {
      noPwdOk = await tryPsqlConnect({ host: detection.host, port: detection.port, user: 'postgres', database: 'postgres' })
    }
    
    if (noPwdOk) {
      const suggestedUrl = `postgresql://postgres@${detection.host}:${detection.port}/postgres`
      return NextResponse.json({
        running: true,
        host: detection.host,
        port: detection.port,
        suggestedUrl,
        authenticated: true,
        source: 'trust',
        note: 'Passwordless local auth detected. URL includes user without password.'
      })
    }

    // If psql not available, provide a no-password URL (unverified) as a better default
    if (!hasPsql) {
      const suggestedUrl = `postgresql://postgres@${detection.host}:${detection.port}/postgres`
      return NextResponse.json({
        running: true,
        host: detection.host,
        port: detection.port,
        suggestedUrl,
        authenticated: false,
        source: 'heuristic',
        note: 'psql not found to verify auth; provided no-password URL for local default.'
      })
    }

    // Fallback to template URL when credentials are unknown and psql is available but login failed
    const suggestedUrl = `postgresql://postgres:password@${detection.host}:${detection.port}/postgres`
    return NextResponse.json({
      running: true,
      host: detection.host,
      port: detection.port,
      suggestedUrl,
      authenticated: false,
      note: 'Detected PostgreSQL on localhost but no credentials found. Replace user/password/database.'
    })
  } catch (error) {
    console.error('Error detecting local PostgreSQL:', error)
    return NextResponse.json({
      running: false,
      error: 'Failed to detect local PostgreSQL',
      details: error.message
    }, { status: 500 })
  }
}
