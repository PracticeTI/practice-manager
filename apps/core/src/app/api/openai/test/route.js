import { NextResponse } from 'next/server'
import { normalizeAiProvider } from '@/lib/ai/providers'
import { resolveAiConfig } from '@/lib/ai/credentials'
import { probeAiProvider } from '@/lib/ai/status'

/**
 * Test the configured provider API key with a lightweight /models call.
 * POST /api/openai/test
 * Body (optional): { provider: 'openai' | 'claude' | 'gemini' | 'deepseek' | 'openrouter' }
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const provider = normalizeAiProvider(body?.provider || 'openai')
    const config = resolveAiConfig({ provider })

    if (!config.apiKey) {
      return NextResponse.json(
        { error: `${config.providerLabel} API key not configured on backend` },
        { status: 400 }
      )
    }

    const probe = await probeAiProvider(provider)

    if (probe.valid) {
      return NextResponse.json({
        valid: true,
        provider,
        message: `${config.providerLabel} API key is valid and working`,
        modelsCount: Array.isArray(probe.models) ? probe.models.length : 0,
      })
    }

    return NextResponse.json({
      valid: false,
      provider,
      error: probe.error || `${config.providerLabel} API key is not valid`,
      statusCode: probe.statusCode,
    }, { status: 200 })
  } catch (error) {
    console.error('Error testing AI provider API key:', error)
    return NextResponse.json(
      { error: 'Failed to test AI provider API key' },
      { status: 500 }
    )
  }
}
