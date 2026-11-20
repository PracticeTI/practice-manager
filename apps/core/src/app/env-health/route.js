import { getDatabaseConnection } from '@/lib/database'
import { evaluateEnvironmentHealth } from '@/lib/environmentHealth'

export async function GET(request) {
  const url = new URL(request.url)
  const environment = (url.searchParams.get('environment') || url.searchParams.get('domain') || '').trim()
  const headers = { 'Cache-Control': 'no-store' }

  if (!environment) {
    return Response.json(
      { status: 'error', error: 'The environment parameter is required.' },
      { status: 400, headers }
    )
  }

  let connection
  try {
    connection = await getDatabaseConnection()
    const result = await connection.query(
      'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
      [`env_health_${environment}`]
    )
    const health = evaluateEnvironmentHealth(result.rows?.[0]?.value)

    return Response.json(
      {
        status: health.healthy ? 'ok' : 'error',
        environment,
        timestamp: health.timestamp,
      },
      { status: health.healthy ? 200 : 503, headers }
    )
  } catch (error) {
    console.error('[env-health] Failed to read worker health record:', error)
    return Response.json(
      { status: 'error', environment, error: 'Unable to read the environment health record.' },
      { status: 503, headers }
    )
  } finally {
    if (connection?.end) {
      await connection.end().catch((error) => {
        console.error('[env-health] Failed to close database connection:', error)
      })
    }
  }
}
