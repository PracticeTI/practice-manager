// Per-feature AI provider/model presets for a domain.
//
// A feature stores `{ provider, tier }`, where `tier` is the same
// Flagship/Balanced/Value tier the Reporting Settings matrix uses. The model
// itself is resolved from the shared provider-model catalog so one catalog edit
// updates every feature. An empty preset means "use the domain default vendor
// and model" (the AI & Defaults fields), which keeps older domain records
// working unchanged.
//
// Client-safe: no process.env reads and no server-only imports.

import {
    getAiProviderLabel,
    normalizeAiProvider,
} from './ai/providers.js'
import {
    DEFAULT_REPORT_AI_PROVIDER_MODELS,
    REPORT_AI_PROVIDER_KEYS,
    REPORT_AI_TIER_KEYS,
    normalizeReportAiProviderModels,
} from './reportAiProviders.js'

export const DOMAIN_AI_FEATURE_INTAKE_ASSISTANT = 'intakeAssistant'
export const DOMAIN_AI_FEATURE_BOOKING_ASSISTANT = 'bookingAssistant'
export const DOMAIN_AI_FEATURE_QUOTE_WRITER = 'quoteWriter'
export const DOMAIN_AI_FEATURE_ADMIN_ASSISTANT = 'adminAssistant'

export const DOMAIN_AI_FEATURE_KEYS = [
    DOMAIN_AI_FEATURE_INTAKE_ASSISTANT,
    DOMAIN_AI_FEATURE_BOOKING_ASSISTANT,
    DOMAIN_AI_FEATURE_QUOTE_WRITER,
    DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
]

export const DOMAIN_AI_FEATURE_META = {
    [DOMAIN_AI_FEATURE_INTAKE_ASSISTANT]: {
        label: 'Intake assistant',
        description: 'Public intake form chat.',
    },
    [DOMAIN_AI_FEATURE_BOOKING_ASSISTANT]: {
        label: 'Booking assistant',
        description: 'Public booking page chat.',
    },
    [DOMAIN_AI_FEATURE_QUOTE_WRITER]: {
        label: 'Quote Writer',
        description: 'Patient overview quote drafting.',
    },
    [DOMAIN_AI_FEATURE_ADMIN_ASSISTANT]: {
        label: 'Admin AI Assistant',
        description: 'Admin assistant chat.',
    },
}

export const DOMAIN_AI_TIER_LABELS = {
    flagship: 'Flagship',
    balanced: 'Balanced',
    value: 'Value',
}

export const DEFAULT_DOMAIN_AI_FEATURE_PRESETS = Object.freeze(
    Object.fromEntries(DOMAIN_AI_FEATURE_KEYS.map((feature) => [feature, { provider: '', tier: '' }]))
)

function normalizeString(value) {
    return String(value || '').trim()
}

export function normalizeDomainAiFeatureKey(value) {
    const normalized = normalizeString(value)
    return DOMAIN_AI_FEATURE_KEYS.includes(normalized) ? normalized : ''
}

/**
 * A preset is all-or-nothing: a provider without a valid tier, or a tier
 * without a known provider, collapses to "use the domain default" so a
 * half-written setting can never dispatch to an unexpected model.
 */
function normalizeFeaturePreset(input) {
    const source = input && typeof input === 'object' ? input : {}
    const provider = normalizeAiProvider(source.provider, '')
    const tier = normalizeString(source.tier).toLowerCase()

    if (!provider || !REPORT_AI_TIER_KEYS.includes(tier)) {
        return { provider: '', tier: '' }
    }

    return { provider, tier }
}

export function normalizeDomainAiFeaturePresets(input) {
    const source = input && typeof input === 'object' ? input : {}
    const result = {}

    for (const feature of DOMAIN_AI_FEATURE_KEYS) {
        result[feature] = normalizeFeaturePreset(source[feature])
    }

    return result
}

export function getDomainAiPresetValue(provider, tier) {
    const normalizedProvider = normalizeAiProvider(provider, '')
    const normalizedTier = normalizeString(tier).toLowerCase()
    if (!normalizedProvider || !REPORT_AI_TIER_KEYS.includes(normalizedTier)) return ''
    return `${normalizedProvider}:${normalizedTier}`
}

export function parseDomainAiPresetValue(value) {
    const [providerRaw, tierRaw] = normalizeString(value).split(':')
    const provider = normalizeAiProvider(providerRaw, '')
    const tier = normalizeString(tierRaw).toLowerCase()
    if (!provider || !REPORT_AI_TIER_KEYS.includes(tier)) {
        return { provider: '', tier: '' }
    }
    return { provider, tier }
}

/** The same provider × tier matrix offered in Reporting Settings. */
export function buildDomainAiPresetOptions(providerModels) {
    const models = normalizeReportAiProviderModels(providerModels || DEFAULT_REPORT_AI_PROVIDER_MODELS)
    const options = []

    for (const provider of REPORT_AI_PROVIDER_KEYS) {
        for (const tier of REPORT_AI_TIER_KEYS) {
            const model = normalizeString(models?.[provider]?.[tier])
            if (!model) continue

            const providerLabel = getAiProviderLabel(provider)
            const tierLabel = DOMAIN_AI_TIER_LABELS[tier] || tier
            options.push({
                value: `${provider}:${tier}`,
                provider,
                tier,
                model,
                providerLabel,
                tierLabel,
                label: `${providerLabel} · ${tierLabel} (${model})`,
            })
        }
    }

    return options
}

/** Find the tier whose model matches the domain's free-text AI model. */
export function findDomainAiPresetValue(providerModels, provider, model) {
    const normalizedProvider = normalizeAiProvider(provider, '')
    const normalizedModel = normalizeString(model)
    if (!normalizedProvider || !normalizedModel) return ''

    const models = normalizeReportAiProviderModels(providerModels || DEFAULT_REPORT_AI_PROVIDER_MODELS)
    for (const tier of REPORT_AI_TIER_KEYS) {
        if (normalizeString(models?.[normalizedProvider]?.[tier]) === normalizedModel) {
            return `${normalizedProvider}:${tier}`
        }
    }

    return ''
}

/**
 * Resolve one feature to the provider/model it will actually use.
 * `custom` is false when the feature inherits the domain default selection.
 */
export function resolveDomainAiFeatureSelection(feature, presets, {
    providerModels = null,
    fallbackProvider = '',
    fallbackModel = '',
} = {}) {
    const key = normalizeDomainAiFeatureKey(feature)
    if (!key) return null

    const preset = normalizeDomainAiFeaturePresets(presets)[key]
    if (preset.provider && preset.tier) {
        const models = normalizeReportAiProviderModels(providerModels || DEFAULT_REPORT_AI_PROVIDER_MODELS)
        return {
            feature: key,
            custom: true,
            provider: preset.provider,
            providerLabel: getAiProviderLabel(preset.provider),
            tier: preset.tier,
            tierLabel: DOMAIN_AI_TIER_LABELS[preset.tier] || preset.tier,
            model: normalizeString(models?.[preset.provider]?.[preset.tier]),
        }
    }

    const provider = normalizeAiProvider(fallbackProvider)
    return {
        feature: key,
        custom: false,
        provider,
        providerLabel: getAiProviderLabel(provider),
        tier: '',
        tierLabel: '',
        model: normalizeString(fallbackModel)
            || normalizeString(DEFAULT_REPORT_AI_PROVIDER_MODELS?.[provider]?.balanced),
    }
}

export function resolveDomainAiFeaturePreset(feature, presets, providerModels = null) {
    const selection = resolveDomainAiFeatureSelection(feature, presets, { providerModels })
    if (!selection?.custom) return null

    return {
        provider: selection.provider,
        providerLabel: selection.providerLabel,
        tier: selection.tier,
        tierLabel: selection.tierLabel,
        model: selection.model,
    }
}

/**
 * The assistant's own provider ids include two Google credential paths, while
 * the shared matrix only knows the `gemini` catalog provider.
 */
export function assistantProviderToAiProvider(value) {
    const provider = normalizeString(value).toLowerCase() || 'google-vertex'
    if (provider === 'google-vertex' || provider === 'google') return 'gemini'
    return normalizeAiProvider(provider, '')
}

/**
 * Applied when an `adminAssistant` preset is used: a catalog `gemini` preset
 * runs through the Gemini API key path, not Vertex.
 */
export function aiProviderToAssistantProvider(value) {
    const provider = normalizeAiProvider(value, '')
    if (!provider) return ''
    return provider === 'gemini' ? 'google' : provider
}
