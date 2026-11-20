// Server-only resolution of provider credentials and models.
//
// Precedence is always: explicit argument -> per-domain setting -> environment
// -> provider default. Keeping this layer free of database access means CLI
// scripts can use it without opening a pool.

import {
    AI_PROVIDER_API_KEY_ENV_VARS,
    DEFAULT_AI_PROVIDER,
    getAiProviderMeta,
    inferAiProviderFromModel,
    isModelCompatibleWithProvider,
    normalizeAiProvider,
} from './providers.js'

const API_KEY_ENV_VARS = AI_PROVIDER_API_KEY_ENV_VARS

const BASE_URL_ENV_VARS = {
    openai: ['OPENAI_BASE_URL', 'OPENAI_API_BASE'],
    claude: ['CLAUDE_BASE_URL', 'ANTHROPIC_BASE_URL'],
    gemini: ['GEMINI_BASE_URL', 'GOOGLE_GENERATIVE_AI_BASE_URL'],
    deepseek: ['DEEPSEEK_BASE_URL'],
    openrouter: ['OPENROUTER_BASE_URL'],
}

const MODEL_ENV_VARS = {
    openai: ['OPENAI_MODEL'],
    claude: ['CLAUDE_MODEL', 'ANTHROPIC_MODEL'],
    gemini: ['GEMINI_MODEL', 'GOOGLE_GENERATIVE_AI_MODEL'],
    deepseek: ['DEEPSEEK_MODEL'],
    openrouter: ['OPENROUTER_MODEL'],
}

function normalizeString(value) {
    return String(value || '').trim()
}

function readEnv(name) {
    return normalizeString(process.env[name])
}

function firstEnv(names) {
    for (const name of names || []) {
        const value = readEnv(name)
        if (value) return value
    }
    return ''
}

function resolveProvider(value, { domainSettings } = {}) {
    return normalizeAiProvider(
        normalizeString(value)
        || normalizeString(domainSettings?.aiVendor)
        || readEnv('AI_PROVIDER'),
        DEFAULT_AI_PROVIDER
    )
}

/**
 * A domain-level key/base URL only applies to the vendor that domain is
 * configured for. Otherwise a stored OpenAI key would be sent to Anthropic.
 */
function domainProviderMatches(provider, domainSettings) {
    const configured = normalizeAiProvider(domainSettings?.aiVendor, '')
    return Boolean(configured) && configured === provider
}

export function resolveAiProviderApiKey(provider, { domainSettings } = {}) {
    const resolved = normalizeAiProvider(provider)
    if (domainProviderMatches(resolved, domainSettings)) {
        const domainKey = normalizeString(domainSettings?.aiApiKey)
        if (domainKey) return domainKey
    }
    return firstEnv(API_KEY_ENV_VARS[resolved])
}

export function resolveAiProviderBaseUrl(provider, { domainSettings, baseUrl } = {}) {
    const resolved = normalizeAiProvider(provider)
    const explicit = normalizeString(baseUrl)
    if (explicit) return explicit

    if (domainProviderMatches(resolved, domainSettings)) {
        const domainBaseUrl = normalizeString(domainSettings?.aiBaseUrl)
        if (domainBaseUrl) return domainBaseUrl
    }

    return firstEnv(BASE_URL_ENV_VARS[resolved]) || getAiProviderMeta(resolved).baseUrl
}

export function resolveAiProviderModel(provider, { domainSettings, model } = {}) {
    const resolved = normalizeAiProvider(provider)
    const explicit = normalizeString(model)
    if (explicit) return { model: explicit, modelSource: 'explicit' }

    if (domainProviderMatches(resolved, domainSettings)) {
        const domainModel = normalizeString(domainSettings?.aiModel)
        if (domainModel) return { model: domainModel, modelSource: 'domain' }
    }

    const envModel = firstEnv(MODEL_ENV_VARS[resolved]) || readEnv('AI_MODEL')
    if (envModel) return { model: envModel, modelSource: 'env' }

    return { model: getAiProviderMeta(resolved).defaultModel, modelSource: 'default' }
}

export function getAiProviderApiKeyAvailability() {
    return {
        openai: Boolean(resolveAiProviderApiKey('openai')),
        claude: Boolean(resolveAiProviderApiKey('claude')),
        gemini: Boolean(resolveAiProviderApiKey('gemini')),
        deepseek: Boolean(resolveAiProviderApiKey('deepseek')),
        openrouter: Boolean(resolveAiProviderApiKey('openrouter')),
    }
}

/**
 * Resolve everything one call needs: provider, model, credential and endpoint.
 *
 * `modelSource` lets the server-only resolver in `serverConfig.js` decide
 * whether the stored OpenAI model should override the table default.
 */
export function resolveAiConfig({ provider, model, baseUrl, domainSettings } = {}) {
    const resolvedProvider = resolveProvider(provider, { domainSettings })
    const meta = getAiProviderMeta(resolvedProvider)
    const { model: resolvedModel, modelSource } = resolveAiProviderModel(resolvedProvider, {
        domainSettings,
        model,
    })
    const apiKey = resolveAiProviderApiKey(resolvedProvider, { domainSettings })
    const resolvedBaseUrl = resolveAiProviderBaseUrl(resolvedProvider, {
        domainSettings,
        baseUrl,
    })
    const inferredProvider = inferAiProviderFromModel(resolvedModel)

    return {
        provider: resolvedProvider,
        providerLabel: meta.label,
        kind: meta.kind,
        model: resolvedModel,
        modelSource,
        apiKey,
        baseUrl: resolvedBaseUrl,
        hasApiKey: Boolean(apiKey),
        capabilities: meta.capabilities,
        modelProviderMismatch: Boolean(inferredProvider && inferredProvider !== resolvedProvider),
        isModelCompatible: isModelCompatibleWithProvider(resolvedProvider, resolvedModel),
    }
}
