import { NextResponse } from 'next/server'
import { normalizeOpenAiModels } from '@/lib/openaiModel'
import { getAiProviderMeta, normalizeAiProvider } from '@/lib/ai/providers'
import { resolveAiConfig } from '@/lib/ai/credentials'
import { probeAiProvider } from '@/lib/ai/status'

/**
 * List models available to the configured provider's API key.
 * GET /api/openai/models            (OpenAI, kept for existing callers)
 * GET /api/openai/models?provider=deepseek
 * GET /api/openai/models?provider=openrouter
 */
export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const testKey = searchParams.get('key')
    const provider = normalizeAiProvider(searchParams.get('provider') || 'openai')

    const config = resolveAiConfig({ provider })
    const apiKey = (typeof testKey === 'string' && testKey.trim()) || config.apiKey
    const curated = Array.isArray(getAiProviderMeta(provider).modelOptions)
      ? getAiProviderMeta(provider).modelOptions
      : []
    const fallback = Array.from(new Set([config.model, ...curated])).filter(Boolean)

    if (!apiKey) {
      return NextResponse.json({ provider, models: fallback, fallback: true })
    }

    const probe = await probeAiProvider(provider, { apiKey })
    if (!probe.valid) {
      return NextResponse.json({
        provider,
        models: fallback,
        fallback: true,
        error: probe.error,
      })
    }

    const normalized = provider === 'openai'
      ? normalizeOpenAiModels((probe.models || []).map((id) => ({ id })))
      : (probe.models || [])

    return NextResponse.json({
      provider,
      models: Array.from(new Set([config.model, ...normalized, ...curated].filter(Boolean))),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load provider models' },
      { status: 500 }
    )
  }
}
