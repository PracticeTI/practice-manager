import { detectDomainFromHostname, DOMAIN_MODE_OVERRIDE_HEADER } from '../../lib/domainMode.js'
import { getPrivateDomainModes } from '../../lib/domainExtension.js'
import { resolveDeploymentRuntime } from '../../lib/deploymentRuntime.js'

function getRequestHostname(headers) {
  const rawHost = headers.get('x-forwarded-host') || headers.get('host') || ''
  return String(rawHost).split(',')[0].trim().toLowerCase()
}

export async function GET(request) {
  const privateDomainModes = getPrivateDomainModes()
  const hostname = getRequestHostname(request.headers)
  const hostnameDomain = detectDomainFromHostname(hostname)
  const middlewareDomain = request.headers.get(DOMAIN_MODE_OVERRIDE_HEADER)?.trim().toLowerCase() || null
  const url = new URL(request.url)

  const hasExpectedDomain = url.searchParams.has('domain')
  const expectedDomain = hasExpectedDomain ? url.searchParams.get('domain')?.trim().toLowerCase() : null

  if (hasExpectedDomain && !privateDomainModes.includes(expectedDomain)) {
    return Response.json(
      { status: 'error', error: 'The domain parameter must name a configured private domain.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const checks = {
    hostnameMappedToPrivateDomain: privateDomainModes.includes(hostnameDomain),
    middlewareDomainMatchesHostname: Boolean(hostnameDomain && middlewareDomain === hostnameDomain),
    expectedDomainMatches: hasExpectedDomain ? hostnameDomain === expectedDomain : null,
  }
  const healthy = checks.hostnameMappedToPrivateDomain
    && checks.middlewareDomainMatchesHostname
    && checks.expectedDomainMatches !== false

  return Response.json(
    {
      status: healthy ? 'ok' : 'error',
      host: hostname || null,
      domain: middlewareDomain || hostnameDomain,
      expectedDomain,
      checks,
      build: {
        version: process.env.NEXT_PUBLIC_APP_VERSION || null,
        commit: process.env.NEXT_PUBLIC_BUILD_COMMIT || null,
        ref: process.env.NEXT_PUBLIC_BUILD_REF || null,
        time: process.env.NEXT_PUBLIC_BUILD_TIME || null,
      },
      runtime: resolveDeploymentRuntime(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
