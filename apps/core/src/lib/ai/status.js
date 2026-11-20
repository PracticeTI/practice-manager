// Provider health checks shared by the status API and the admin dashboard.

import {
    AI_PROVIDER_KIND_ANTHROPIC,
    AI_PROVIDER_KIND_GOOGLE,
    AI_PROVIDER_IDS,
    getAiProviderMeta,
    inferAiProviderFromModel,
    normalizeAiProvider,
} from './providers.js'
import {
    resolveAiConfig,
    resolveAiProviderApiKey,
    resolveAiProviderBaseUrl,
} from './credentials.js'

export function getAiProviderStatuses({ domainSettings } = {}) {
    return AI_PROVIDER_IDS.map((provider) => {
        const config = resolveAiConfig({ provider, domainSettings })
        return {
            provider,
            label: config.providerLabel,
            kind: config.kind,
            configured: config.hasApiKey,
            model: config.model,
            baseUrl: config.baseUrl,
            capabilities: config.capabilities,
        }
    })
}

function buildAuthHeaders(provider, apiKey) {
    const meta = getAiProviderMeta(provider)
    if (meta.kind === AI_PROVIDER_KIND_ANTHROPIC) {
        return {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        }
    }
    if (meta.kind === AI_PROVIDER_KIND_GOOGLE) {
        return { 'x-goog-api-key': apiKey }
    }
    return { Authorization: `Bearer ${apiKey}` }
}

/**
 * Providers return model lists in two shapes: OpenAI-compatible APIs' `{ data: [{ id }] }`
 * and Gemini's `{ models: [{ name: 'models/...' }] }`.
 */
export function normalizeProviderModels(provider, payload) {
    const meta = getAiProviderMeta(provider)
    const raw = meta.kind === AI_PROVIDER_KIND_GOOGLE
        ? (Array.isArray(payload?.models) ? payload.models : [])
        : (Array.isArray(payload?.data) ? payload.data : [])

    const ids = raw
        .map((model) => {
            const id = typeof model === 'string' ? model : (model?.id || model?.name || '')
            return String(id).trim().replace(/^models\//, '')
        })
        .filter(Boolean)

    return Array.from(new Set(ids))
}

export async function probeAiProvider(provider, {
    apiKey,
    baseUrl,
    domainSettings,
    fetchImpl = fetch,
    timeoutMs = 5000,
} = {}) {
    const resolvedProvider = normalizeAiProvider(provider)
    const meta = getAiProviderMeta(resolvedProvider)
    const key = String(apiKey || resolveAiProviderApiKey(resolvedProvider, { domainSettings }) || '').trim()

    if (!key) {
        return {
            provider: resolvedProvider,
            configured: false,
            valid: false,
            reason: `${meta.label} API key is not configured`,
        }
    }

    const resolvedBaseUrl = resolveAiProviderBaseUrl(resolvedProvider, { domainSettings, baseUrl })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetchImpl(`${resolvedBaseUrl}/models`, {
            method: 'GET',
            signal: controller.signal,
            headers: buildAuthHeaders(resolvedProvider, key),
        })
        const text = await response.text()
        const payload = (() => {
            try {
                return JSON.parse(text || '{}')
            } catch {
                return {}
            }
        })()

        if (!response.ok) {
            return {
                provider: resolvedProvider,
                configured: true,
                valid: false,
                statusCode: response.status,
                error: payload?.error?.message || text.slice(0, 300) || `${meta.label} returned ${response.status}`,
            }
        }

        return {
            provider: resolvedProvider,
            configured: true,
            valid: true,
            statusCode: response.status,
            models: normalizeProviderModels(resolvedProvider, payload),
        }
    } catch (error) {
        const aborted = error?.name === 'AbortError'
        return {
            provider: resolvedProvider,
            configured: true,
            valid: false,
            statusCode: aborted ? 408 : 0,
            error: aborted ? `${meta.label} request timed out` : (error?.message || 'Unknown error'),
        }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Reject a configured model that clearly belongs to a different vendor.
 * Used by the status API so misconfiguration is visible in the UI.
 */
export function findModelProviderMismatch({ provider, model }) {
    const inferred = inferAiProviderFromModel(model)
    const resolved = normalizeAiProvider(provider)
    if (!inferred || inferred === resolved) return null
    return { expected: resolved, inferred }
}
