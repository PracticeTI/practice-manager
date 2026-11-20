import { NextResponse } from 'next/server'

/**
 * Dependency-free liveness probe for uptime checks and for telling several runtimes apart.
 *
 * Deliberately touches no database, queue or model vendor: an outage in any of those must
 * not make the runtime look dead.
 */
export async function GET() {
  return NextResponse.json(
    {
      service: 'practice-manager-backend',
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
