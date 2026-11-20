// Per-service provider selection.
//
// "Provider-agnostic" for chat is one question; web search and transcription
// are separate capabilities that no single vendor covers completely. Each has
// its own configured provider so an installation can, for example, chat on
// DeepSeek while searching the web with Claude and transcribing with OpenAI.
//
// Client-safe: no process.env access, so the admin UI shares this logic.

import {
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_IDS,
    AI_PROVIDER_OPENAI,
    AI_PROVIDER_OPENROUTER,
    aiProviderSupports,
    getAiProviderMeta,
    normalizeAiProvider,
} from './providers.js'

export const AI_SERVICE_CHAT = 'chat'
export const AI_SERVICE_WEB_SEARCH = 'webSearch'
export const AI_SERVICE_TRANSCRIPTION = 'transcription'

export const AI_SERVICE_KEYS = [
    AI_SERVICE_CHAT,
    AI_SERVICE_WEB_SEARCH,
    AI_SERVICE_TRANSCRIPTION,
]

export const AI_SERVICE_META = {
    [AI_SERVICE_CHAT]: {
        label: 'Chat & completions',
        description: 'Report drafting, content summaries, classification and the admin assistant.',
        capability: 'chat',
    },
    [AI_SERVICE_WEB_SEARCH]: {
        label: 'Web search',
        description: 'Grounded research answers with citations.',
        capability: 'webSearch',
    },
    [AI_SERVICE_TRANSCRIPTION]: {
        label: 'Audio transcription',
        description: 'Patient session audio to text.',
        capability: 'transcription',
    },
}

// Order matters: it decides which capable vendor is used when a configured
// provider does not support the capability.
const SERVICE_PROVIDER_PREFERENCE = [
    AI_PROVIDER_OPENAI,
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_OPENROUTER,
]

export const DEFAULT_SERVICE_PROVIDERS = {
    [AI_SERVICE_CHAT]: AI_PROVIDER_OPENAI,
    [AI_SERVICE_WEB_SEARCH]: AI_PROVIDER_OPENAI,
    [AI_SERVICE_TRANSCRIPTION]: AI_PROVIDER_OPENAI,
}

function normalizeString(value) {
    return String(value || '').trim()
}

export function serviceSupportsProvider(service, provider) {
    const meta = AI_SERVICE_META[service]
    if (!meta) return false
    return aiProviderSupports(provider, meta.capability)
}

/** Every provider that can serve `service`, in preference order. */
export function listServiceProviders(service) {
    return SERVICE_PROVIDER_PREFERENCE.filter((provider) => serviceSupportsProvider(service, provider))
}

/**
 * Pick the provider a service should use. A configured provider that cannot
 * serve the service is replaced by the first capable one, so a stale setting
 * never breaks a feature.
 */
export function resolveServiceProvider(service, value) {
    const requested = normalizeAiProvider(value, '')
    if (requested && serviceSupportsProvider(service, requested)) {
        return requested
    }

    const fallback = DEFAULT_SERVICE_PROVIDERS[service]
    if (fallback && serviceSupportsProvider(service, fallback)) {
        return fallback
    }

    return listServiceProviders(service)[0] || ''
}

function resolveServiceModel(service, provider, model) {
    const explicit = normalizeString(model)
    if (explicit) return explicit

    const meta = getAiProviderMeta(provider)
    if (service === AI_SERVICE_TRANSCRIPTION) {
        return meta.transcriptionDefaultModel || ''
    }
    return meta.defaultModel || ''
}

/**
 * Normalize stored service settings into a complete, capability-correct shape.
 * `{ chat: 'openai' }` (legacy shorthand) and
 * `{ chat: { provider, model } }` are both accepted.
 */
export function normalizeAiServiceSettings(input) {
    const source = input && typeof input === 'object' ? input : {}
    const result = {}

    for (const service of AI_SERVICE_KEYS) {
        const raw = source[service]
        const rawProvider = typeof raw === 'string' ? raw : raw?.provider
        const rawModel = typeof raw === 'string' ? '' : raw?.model

        const provider = resolveServiceProvider(service, rawProvider)
        result[service] = {
            provider,
            model: resolveServiceModel(service, provider, rawModel),
        }
    }

    return result
}

/** Providers offered in the UI for one service, with their model choices. */
export function getServiceProviderOptions(service) {
    return listServiceProviders(service).map((provider) => {
        const meta = getAiProviderMeta(provider)
        return {
            id: provider,
            label: meta.label,
            defaultModel: service === AI_SERVICE_TRANSCRIPTION
                ? meta.transcriptionDefaultModel
                : meta.defaultModel,
            models: service === AI_SERVICE_TRANSCRIPTION
                ? (meta.transcriptionModels || [])
                : (meta.modelOptions || []),
        }
    })
}

export function getAiServiceProviderIds() {
    return AI_PROVIDER_IDS
}
