// Single source of truth for the AI vendors this app can talk to.
//
// This module is deliberately client-safe: no process.env reads and no
// server-only imports, so the admin UI can render provider options from the
// same list the server uses to dispatch requests.

export const AI_PROVIDER_OPENAI = 'openai'
export const AI_PROVIDER_CLAUDE = 'claude'
export const AI_PROVIDER_GEMINI = 'gemini'
export const AI_PROVIDER_DEEPSEEK = 'deepseek'
export const AI_PROVIDER_OPENROUTER = 'openrouter'

export const DEFAULT_AI_PROVIDER = AI_PROVIDER_OPENAI

export const AI_PROVIDER_IDS = [
    AI_PROVIDER_OPENAI,
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_OPENROUTER,
]

// Canonical ids are the short vendor names the admin UI already stores. The
// vendor's own product name is accepted as an alias so external callers and
// older settings keep working.
const AI_PROVIDER_ALIASES = {
    openai: AI_PROVIDER_OPENAI,
    'open-ai': AI_PROVIDER_OPENAI,
    claude: AI_PROVIDER_CLAUDE,
    anthropic: AI_PROVIDER_CLAUDE,
    gemini: AI_PROVIDER_GEMINI,
    google: AI_PROVIDER_GEMINI,
    'google-gemini': AI_PROVIDER_GEMINI,
    deepseek: AI_PROVIDER_DEEPSEEK,
    'deep-seek': AI_PROVIDER_DEEPSEEK,
    openrouter: AI_PROVIDER_OPENROUTER,
    'open-router': AI_PROVIDER_OPENROUTER,
}

/**
 * Environment variables that can hold each provider's API key, in resolution
 * order. Client-safe so setup screens can show the variable to set without
 * duplicating the mapping the server resolves.
 */
export const AI_PROVIDER_API_KEY_ENV_VARS = {
    [AI_PROVIDER_OPENAI]: ['OPENAI_API_KEY'],
    [AI_PROVIDER_CLAUDE]: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'],
    [AI_PROVIDER_GEMINI]: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    [AI_PROVIDER_DEEPSEEK]: ['DEEPSEEK_API_KEY'],
    [AI_PROVIDER_OPENROUTER]: ['OPENROUTER_API_KEY'],
}

export const AI_PROVIDER_KIND_OPENAI = 'openai'
export const AI_PROVIDER_KIND_ANTHROPIC = 'anthropic'
export const AI_PROVIDER_KIND_GOOGLE = 'google'
export const AI_PROVIDER_KIND_OPENAI_COMPATIBLE = 'openai-compatible'

/**
 * Provider metadata. `kind` selects the request adapter in `src/lib/ai/chat.js`;
 * `modelPrefix` is used to reject a model id that belongs to another vendor.
 */
export const AI_PROVIDER_META = {
    [AI_PROVIDER_OPENAI]: {
        id: AI_PROVIDER_OPENAI,
        label: 'OpenAI',
        kind: AI_PROVIDER_KIND_OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4.1-mini',
        modelOptions: [
            'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4',
            'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2', 'gpt-5.1', 'gpt-5',
            'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
        ],
        modelPrefix: /^(gpt-|o[1-9])/i,
        transcriptionDefaultModel: 'gpt-4o-mini-transcribe',
        transcriptionModels: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
        capabilities: {
            chat: true,
            streaming: true,
            json: true,
            webSearch: true,
            transcription: true,
        },
    },
    [AI_PROVIDER_CLAUDE]: {
        id: AI_PROVIDER_CLAUDE,
        label: 'Claude',
        kind: AI_PROVIDER_KIND_ANTHROPIC,
        baseUrl: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-5-5',
        modelOptions: [
            'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
            'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5',
            'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-opus-4-6',
            'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001',
        ],
        modelPrefix: /^claude/i,
        capabilities: {
            chat: true,
            streaming: true,
            json: true,
            webSearch: true,
            transcription: false,
        },
    },
    [AI_PROVIDER_GEMINI]: {
        id: AI_PROVIDER_GEMINI,
        label: 'Gemini',
        kind: AI_PROVIDER_KIND_GOOGLE,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-flash',
        modelOptions: [
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
        ],
        modelPrefix: /^gemini/i,
        transcriptionDefaultModel: 'gemini-3.5-transcribe',
        transcriptionModels: ['gemini-3.5-transcribe'],
        capabilities: {
            chat: true,
            streaming: true,
            json: true,
            webSearch: true,
            transcription: true,
        },
    },
    [AI_PROVIDER_DEEPSEEK]: {
        id: AI_PROVIDER_DEEPSEEK,
        label: 'DeepSeek',
        kind: AI_PROVIDER_KIND_OPENAI_COMPATIBLE,
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        modelOptions: ['deepseek-chat', 'deepseek-reasoner'],
        modelPrefix: /^deepseek/i,
        capabilities: {
            chat: true,
            streaming: true,
            json: true,
            webSearch: false,
            transcription: false,
        },
    },
    [AI_PROVIDER_OPENROUTER]: {
        id: AI_PROVIDER_OPENROUTER,
        label: 'OpenRouter',
        kind: AI_PROVIDER_KIND_OPENAI_COMPATIBLE,
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'minimax/minimax-m3.1-flash',
        modelOptions: [],
        capabilities: {
            chat: true,
            streaming: true,
            json: true,
            webSearch: false,
            transcription: false,
        },
    },
}

function normalizeString(value) {
    return String(value || '').trim()
}

export function isKnownAiProvider(value) {
    return Boolean(AI_PROVIDER_ALIASES[normalizeString(value).toLowerCase()])
}

/**
 * Map an id or alias to a canonical provider id. Unknown values fall back
 * instead of being silently coerced to OpenAI, so callers can detect a bad
 * value when they pass `fallback: ''`.
 */
export function normalizeAiProvider(value, fallback = DEFAULT_AI_PROVIDER) {
    const normalized = normalizeString(value).toLowerCase()
    const resolved = AI_PROVIDER_ALIASES[normalized]
    if (resolved) return resolved
    if (fallback === '') return ''
    return AI_PROVIDER_ALIASES[normalizeString(fallback).toLowerCase()] || DEFAULT_AI_PROVIDER
}

export function getAiProviderMeta(value) {
    const provider = normalizeAiProvider(value)
    return AI_PROVIDER_META[provider] || AI_PROVIDER_META[DEFAULT_AI_PROVIDER]
}

export function getAiProviderLabel(value) {
    return getAiProviderMeta(value).label
}

export function getAiProviderBaseUrl(value) {
    return getAiProviderMeta(value).baseUrl
}

export function getAiProviderDefaultModel(value) {
    return getAiProviderMeta(value).defaultModel
}

export function getAiProviderKind(value) {
    return getAiProviderMeta(value).kind
}

export function aiProviderSupports(value, capability) {
    const capabilities = getAiProviderMeta(value).capabilities || {}
    return capabilities[capability] === true
}

/**
 * Which vendor a model id clearly belongs to, or '' when the id is unfamiliar
 * (fine-tunes and custom deployments intentionally return '').
 */
export function inferAiProviderFromModel(model) {
    const normalized = normalizeString(model)
    if (!normalized) return ''

    for (const provider of AI_PROVIDER_IDS) {
        const meta = AI_PROVIDER_META[provider]
        if (meta.modelPrefix && meta.modelPrefix.test(normalized)) {
            return provider
        }
    }

    return ''
}

/**
 * True when the model id does not belong to a different vendor. Unknown ids are
 * accepted because a provider may expose custom or fine-tuned model names.
 */
export function isModelCompatibleWithProvider(provider, model) {
    if (normalizeAiProvider(provider) === AI_PROVIDER_OPENROUTER) return true
    const inferred = inferAiProviderFromModel(model)
    if (!inferred) return true
    return inferred === normalizeAiProvider(provider)
}

export const AI_PROVIDER_OPTIONS = AI_PROVIDER_IDS.map((id) => {
    const meta = AI_PROVIDER_META[id]
    return {
        id,
        label: meta.label,
        kind: meta.kind,
        defaultModel: meta.defaultModel,
        modelOptions: meta.modelOptions,
        capabilities: meta.capabilities,
    }
})
