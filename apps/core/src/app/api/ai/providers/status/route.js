import { NextResponse } from 'next/server'
import { isKnownAiProvider, normalizeAiProvider } from '@/lib/ai/providers'
import { getAiProviderStatuses, probeAiProvider } from '@/lib/ai/status'
import { readAiServiceSettings } from '@/lib/ai/serviceSettings'

/**
 * GET /api/ai/providers/status
 *
 * Reports every provider the app can dispatch to. `?validate=true` performs a
 * cheap `GET /models` call against each configured provider; `?provider=<id>`
 * limits the probe to one vendor.
 */
export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const shouldValidate = searchParams.get('validate') === 'true'
    const requestedProvider = String(searchParams.get('provider') || '').trim()

    const statuses = getAiProviderStatuses()
    const services = await readAiServiceSettings().catch(() => null)

    if (!shouldValidate) {
      return NextResponse.json({
        success: true,
        configured: statuses.some((status) => status.configured),
        providers: statuses,
        services,
      })
    }

    if (requestedProvider && !isKnownAiProvider(requestedProvider)) {
      return NextResponse.json(
        { error: `Unknown provider: ${requestedProvider}` },
        { status: 400 }
      )
    }

    const targets = requestedProvider
      ? [normalizeAiProvider(requestedProvider)]
      : statuses.filter((status) => status.configured).map((status) => status.provider)

    const probes = await Promise.all(targets.map((provider) => probeAiProvider(provider)))

    return NextResponse.json({
      success: true,
      configured: statuses.some((status) => status.configured),
      providers: statuses,
      services,
      probes,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'Failed to check AI providers' },
      { status: 500 }
    )
  }
}
