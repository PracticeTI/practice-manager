import {
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_OPENAI,
    AI_PROVIDER_OPENROUTER,
    AI_PROVIDER_IDS,
    DEFAULT_AI_PROVIDER,
    getAiProviderBaseUrl,
    getAiProviderLabel,
    normalizeAiProvider,
} from './ai/providers.js'

export const REPORT_AI_PROVIDER_OPENAI = AI_PROVIDER_OPENAI
export const REPORT_AI_PROVIDER_CLAUDE = AI_PROVIDER_CLAUDE
export const REPORT_AI_PROVIDER_GEMINI = AI_PROVIDER_GEMINI
export const REPORT_AI_PROVIDER_DEEPSEEK = AI_PROVIDER_DEEPSEEK
export const REPORT_AI_PROVIDER_OPENROUTER = AI_PROVIDER_OPENROUTER

export const REPORT_AI_PROVIDER_KEYS = AI_PROVIDER_IDS

export const REPORT_AI_TIER_FLAGSHIP = 'flagship'
export const REPORT_AI_TIER_BALANCED = 'balanced'
export const REPORT_AI_TIER_VALUE = 'value'

export const REPORT_AI_TIER_KEYS = [
    REPORT_AI_TIER_FLAGSHIP,
    REPORT_AI_TIER_BALANCED,
    REPORT_AI_TIER_VALUE,
]

export const DEFAULT_REPORT_AI_PROVIDER = DEFAULT_AI_PROVIDER
export const DEFAULT_REPORT_AI_TIER = REPORT_AI_TIER_BALANCED

export const REPORT_AI_PROVIDER_META = Object.fromEntries(
    AI_PROVIDER_IDS.map((provider) => [
        provider,
        {
            label: getAiProviderLabel(provider),
            baseUrl: getAiProviderBaseUrl(provider),
        },
    ])
)

// Verified against GET /v1/models and exercised with the FCA analyst's JSON-mode request on
// 2026-09-29. Two traps worth remembering:
//   * The `-pro` ids the API lists are NOT chat models - `gpt-5.5-pro` answers 404 on
//     `/v1/chat/completions`, so a `-pro` model must never be set here.
//   * The previous `balanced` value, `gpt-5.5-mini`, does not exist at all. It only went unnoticed
//     because the stored catalog in system_settings overrides this table.
// Claude was verified against GET /v1/models (14 chat models) on 2026-10-21. The Gemini and
// DeepSeek rows are unverified: no matching API key is set in this environment.
export const DEFAULT_REPORT_AI_PROVIDER_MODELS = {
    [REPORT_AI_PROVIDER_OPENAI]: {
        [REPORT_AI_TIER_FLAGSHIP]: 'gpt-5.6-sol',
        [REPORT_AI_TIER_BALANCED]: 'gpt-5.4-mini',
        [REPORT_AI_TIER_VALUE]: 'gpt-5.4-nano',
    },
    [REPORT_AI_PROVIDER_CLAUDE]: {
        [REPORT_AI_TIER_FLAGSHIP]: 'claude-opus-5-5',
        [REPORT_AI_TIER_BALANCED]: 'claude-sonnet-5-5',
        [REPORT_AI_TIER_VALUE]: 'claude-haiku-5-5',
    },
    [REPORT_AI_PROVIDER_GEMINI]: {
        [REPORT_AI_TIER_FLAGSHIP]: 'gemini-2.5-pro',
        [REPORT_AI_TIER_BALANCED]: 'gemini-2.5-flash',
        [REPORT_AI_TIER_VALUE]: 'gemini-2.0-flash-lite',
    },
    [REPORT_AI_PROVIDER_DEEPSEEK]: {
        [REPORT_AI_TIER_FLAGSHIP]: 'deepseek-reasoner',
        [REPORT_AI_TIER_BALANCED]: 'deepseek-chat',
        [REPORT_AI_TIER_VALUE]: 'deepseek-chat',
    },
    [REPORT_AI_PROVIDER_OPENROUTER]: {
        [REPORT_AI_TIER_FLAGSHIP]: 'moonshotai/kimi-k3',
        [REPORT_AI_TIER_BALANCED]: 'qwen/qwen3.8-2.4t-a95b',
        [REPORT_AI_TIER_VALUE]: 'minimax/minimax-m3.1-flash',
    },
}

function normalizeString(value) {
    return String(value || '').trim()
}

export function normalizeReportAiProvider(value) {
    // `normalizeAiProvider` maps anthropic -> claude and google -> gemini.
    return normalizeAiProvider(value)
}

export function normalizeReportAiTier(value) {
    const normalized = normalizeString(value).toLowerCase()
    if (REPORT_AI_TIER_KEYS.includes(normalized)) {
        return normalized
    }

    return DEFAULT_REPORT_AI_TIER
}

function cloneDefaultModels() {
    return Object.fromEntries(
        REPORT_AI_PROVIDER_KEYS.map((provider) => [
            provider,
            { ...DEFAULT_REPORT_AI_PROVIDER_MODELS[provider] },
        ])
    )
}

export function normalizeReportAiProviderModels(input) {
    const source = input && typeof input === 'object' ? input : {}
    const result = cloneDefaultModels()

    for (const provider of REPORT_AI_PROVIDER_KEYS) {
        const providerSource = source[provider]
        if (!providerSource || typeof providerSource !== 'object') continue

        for (const tier of REPORT_AI_TIER_KEYS) {
            const nextModel = normalizeString(providerSource[tier])
            if (nextModel) {
                result[provider][tier] = nextModel
            }
        }
    }

    return result
}

export function getReportAiProviderDisplayName(provider) {
    return getAiProviderLabel(normalizeReportAiProvider(provider))
}

export function getReportAiProviderBaseUrl(provider) {
    return getAiProviderBaseUrl(normalizeReportAiProvider(provider))
}

export function getReportAiProviderApiKeyAvailability() {
    // Static reads keep this module client-safe: the settings UI only needs a
    // boolean it receives from the API, never the key itself.
    return {
        [REPORT_AI_PROVIDER_OPENAI]: normalizeString(process.env.OPENAI_API_KEY).length > 0,
        [REPORT_AI_PROVIDER_CLAUDE]: normalizeString(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY).length > 0,
        [REPORT_AI_PROVIDER_GEMINI]: normalizeString(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY).length > 0,
        [REPORT_AI_PROVIDER_DEEPSEEK]: normalizeString(process.env.DEEPSEEK_API_KEY).length > 0,
        [REPORT_AI_PROVIDER_OPENROUTER]: normalizeString(process.env.OPENROUTER_API_KEY).length > 0,
    }
}

export function resolveReportAiSelection(config) {
    const candidate = config && typeof config === 'object' ? config : {}
    const provider = normalizeReportAiProvider(candidate.aiProvider)
    const tier = normalizeReportAiTier(candidate.aiModelTier)
    const providerModels = normalizeReportAiProviderModels(candidate.providerModels)
    const model = normalizeString(providerModels?.[provider]?.[tier])
        || DEFAULT_REPORT_AI_PROVIDER_MODELS[provider][tier]

    return {
        provider,
        providerLabel: getReportAiProviderDisplayName(provider),
        tier,
        model,
        baseUrl: getReportAiProviderBaseUrl(provider),
        providerModels,
    }
}
