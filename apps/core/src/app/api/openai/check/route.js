import { NextResponse } from 'next/server'
import { normalizeOpenAiModels } from '@/lib/openaiModel'
import { normalizeAiProvider } from '@/lib/ai/providers'
import { resolveAiConfig, resolveAiProviderApiKey } from '@/lib/ai/credentials'
import { getAiProviderStatuses, probeAiProvider } from '@/lib/ai/status'

/**
 * Validate a provider API key by performing a minimal `/models` call.
 * GET /api/openai/check            (OpenAI, kept for existing callers)
 * GET /api/openai/check?provider=claude&validate=true
 */
export async function GET(request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const shouldValidate = searchParams.get('validate') === 'true'
    const testKeyParam = String(searchParams.get('key') || '').trim()
    const provider = normalizeAiProvider(searchParams.get('provider') || 'openai')

    const config = resolveAiConfig({ provider })
    const envApiKey = String(resolveAiProviderApiKey(provider) || '').trim()
    const apiKey = testKeyParam || envApiKey
    const configured = envApiKey.length > 0
    const isTesting = testKeyParam.length > 0

    const maskedApiKey = configured && !isTesting ? maskKey(envApiKey) : null

    if (!shouldValidate) {
      return NextResponse.json({
        provider,
        providerLabel: config.providerLabel,
        configured,
        valid: undefined,
        reason: configured ? 'Configured' : `${providerLabelReason(provider)} not set on backend`,
        apiKeyLength: configured ? envApiKey.length : 0,
        maskedApiKey,
        model: config.model,
        providers: getAiProviderStatuses(),
      })
    }

    if (!apiKey) {
      return NextResponse.json({
        provider,
        providerLabel: config.providerLabel,
        configured: false,
        valid: false,
        reason: 'No API key provided or configured',
        model: config.model,
      }, { status: 200 })
    }

    // A test key may belong to a provider other than the configured one.
    const probe = await probeAiProvider(provider, { apiKey })
    const availableModels = provider === 'openai' && Array.isArray(probe.models)
      ? normalizeOpenAiModels(probe.models.map((id) => ({ id })))
      : (probe.models || [])

    return NextResponse.json({
      provider,
      providerLabel: config.providerLabel,
      configured,
      valid: probe.valid,
      statusCode: probe.statusCode,
      error: probe.error,
      detail: probe.valid ? `Key validated via ${config.providerLabel} models API` : undefined,
      model: config.model,
      availableModels,
    }, { status: 200 })
  } catch (error) {
    console.error('Error checking AI provider configuration:', error)
    return NextResponse.json(
      { error: 'Failed to check AI provider configuration' },
      { status: 500 }
    )
  }
}

function providerLabelReason(provider) {
  if (provider === 'claude') return 'ANTHROPIC_API_KEY/CLAUDE_API_KEY'
  if (provider === 'gemini') return 'GEMINI_API_KEY'
  if (provider === 'deepseek') return 'DEEPSEEK_API_KEY'
  if (provider === 'openrouter') return 'OPENROUTER_API_KEY'
  return 'OPENAI_API_KEY'
}

function maskKey(value) {
  const raw = String(value || '').trim()
  if (raw.length <= 8) return '********'
  return `${raw.slice(0, 4)}${'*'.repeat(Math.max(raw.length - 6, 4))}${raw.slice(-2)}`
}
