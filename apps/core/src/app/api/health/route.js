import { NextResponse } from 'next/server'
import { resolveDeploymentRuntime } from '@/lib/deploymentRuntime'

/**
 * Dependency-free liveness probe for uptime checks and for identifying which
 * deployment a tester is looking at when several preview URLs are live at once.
 *
 * Deliberately touches no database, worker, or model vendor: an outage in any of
 * those must not make the host look dead.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      build: {
        version: process.env.NEXT_PUBLIC_APP_VERSION || null,
        commit: process.env.NEXT_PUBLIC_BUILD_COMMIT || null,
        ref: process.env.NEXT_PUBLIC_BUILD_REF || null,
        time: process.env.NEXT_PUBLIC_BUILD_TIME || null,
      },
      runtime: resolveDeploymentRuntime(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
