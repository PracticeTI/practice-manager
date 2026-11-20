import { resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { getDomainSetting } from '@/lib/appSettings'
import { readAiProviderModelCatalog } from '@/lib/aiProviderModelCatalog'
import { resolveDomainAiFeaturePreset } from '@/lib/domainAiFeatures'
import {
    DEFAULT_AI_PROVIDER,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_KIND_OPENAI,
    AI_PROVIDER_KIND_OPENAI_COMPATIBLE,
    AI_PROVIDER_OPENAI,
    getAiProviderDefaultModel,
    normalizeAiProvider,
} from '@/lib/ai/providers'
import { resolveAiConfig } from '@/lib/ai/credentials'


// Kept as a named export because older modules import the OpenAI vendor id.
export const AI_VENDOR_OPENAI = AI_PROVIDER_OPENAI
export { AI_PROVIDER_DEEPSEEK }

function normalizeString(value) {
    return String(value || '').trim()
}

function normalizeDomainKey(value) {
    return normalizeString(value).toLowerCase()
}

function normalizeBaseUrl(value) {
    const raw = normalizeString(value)
    if (!raw) return ''

    try {
        const parsed = new URL(raw)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return ''
        }
        return parsed.href.replace(/\/+$/, '')
    } catch {
        return ''
    }
}

function joinUrl(baseUrl, path) {
    const normalizedBase = String(baseUrl || '').replace(/\/+$/, '')
    const normalizedPath = String(path || '').replace(/^\/+/, '')
    if (!normalizedBase) return ''
    return `${normalizedBase}/${normalizedPath}`
}

/**
 * Every configured vendor is accepted; an unknown value falls back to OpenAI
 * so a typo in stored settings cannot silently disable the domain's AI.
 */
export function normalizeAiVendor(value) {
    return normalizeAiProvider(value, DEFAULT_AI_PROVIDER)
}

export function normalizeAiModel(value, provider = DEFAULT_AI_PROVIDER) {
    return normalizeString(value) || getAiProviderDefaultModel(provider)
}

export function normalizeAiBaseUrl(value) {
    return normalizeBaseUrl(value)
}

export function maskApiKey(value) {
    const raw = normalizeString(value)
    if (!raw) return ''
    if (raw.length <= 8) return '********'
    return `${raw.slice(0, 4)}${'*'.repeat(Math.max(raw.length - 6, 4))}${raw.slice(-2)}`
}

export async function resolveDomainAiConfig({ headerStore = null, domainKey = '', feature = '' } = {}) {
    const explicitDomain = normalizeDomainKey(domainKey)
    const inferredDomain = explicitDomain || normalizeDomainKey(resolveDomainModeFromHeaders(headerStore))
    const domainSettings = (await getDomainSetting(inferredDomain, 'management')) || {}

    // A per-feature preset pins the provider and the catalog model. Without one
    // the feature keeps inheriting the domain's AI vendor/model fields.
    let featureSelection = null
    if (feature) {
        const preset = resolveDomainAiFeaturePreset(feature, domainSettings?.aiFeaturePresets)
        if (preset) {
            const catalog = await readAiProviderModelCatalog().catch(() => null)
            featureSelection = resolveDomainAiFeaturePreset(
                feature,
                domainSettings?.aiFeaturePresets,
                catalog?.models
            )
        }
    }

    const config = resolveAiConfig({
        provider: featureSelection?.provider,
        model: featureSelection?.model,
        domainSettings,
    })

    // Chat-completions URLs only exist for OpenAI-shaped APIs; native Anthropic
    // and Gemini are driven through the AI SDK adapters instead.
    const supportsChatCompletionsUrl = config.kind === AI_PROVIDER_KIND_OPENAI
        || config.kind === AI_PROVIDER_KIND_OPENAI_COMPATIBLE

    return {
        domainKey: inferredDomain,
        vendor: config.provider,
        provider: config.provider,
        providerLabel: config.providerLabel,
        kind: config.kind,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        hasApiKey: config.hasApiKey,
        capabilities: config.capabilities,
        hasDomainApiKey: normalizeString(domainSettings?.aiApiKey).length > 0,
        feature: featureSelection?.feature || '',
        modelTier: featureSelection?.tier || '',
        chatCompletionsUrl: supportsChatCompletionsUrl ? joinUrl(config.baseUrl, 'chat/completions') : '',
        modelsUrl: joinUrl(config.baseUrl, 'models'),
    }
}
