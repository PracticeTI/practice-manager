import { NextResponse } from 'next/server'

const TIMEOUT_MS = 8000

export async function GET() {
  const domainBackendUrl = process.env.DOMAIN_BACKEND_URL

  if (!domainBackendUrl) {
    return NextResponse.json({
      online: false,
      configured: false,
      configuredUrl: '',
      status: 'not_configured',
      message: 'DOMAIN_BACKEND_URL is not set'
    })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${domainBackendUrl}/api/health`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return NextResponse.json({
        online: false,
        configured: true,
        configuredUrl: domainBackendUrl,
        status: 'error',
        message: `HTTP ${response.status}`
      })
    }

    const data = await response.json()

    return NextResponse.json({
      online: true,
      configured: true,
      configuredUrl: domainBackendUrl,
      ...data
    })
  } catch (error) {
    clearTimeout(timeoutId)

    return NextResponse.json({
      online: false,
      configured: true,
      configuredUrl: domainBackendUrl,
      status: 'offline',
      message: error.message
    })
  }
}
