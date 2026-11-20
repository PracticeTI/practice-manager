import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import {
    DEFAULT_REPORT_AI_PROVIDER_MODELS,
    REPORT_AI_PROVIDER_KEYS,
    REPORT_AI_TIER_BALANCED,
    REPORT_AI_TIER_KEYS,
    normalizeReportAiProviderModels,
} from '@/lib/reportAiProviders'
import { FALLBACK_OPENAI_MODEL } from '@/lib/openaiModel'

const AI_PROVIDER_MODEL_CATALOG_KEY = 'ai_provider_model_catalog_v1'

const LEGACY_PROVIDER_KEYS = {
    openai: 'openai_model',
    claude: 'claude_model',
    gemini: 'gemini_model',
    deepseek: 'deepseek_model',
    openrouter: 'openrouter_model',
}

const LEGACY_ANTHROPIC_MODEL_KEY = 'anthropic_model'

function normalizeModel(value) {
    return String(value || '').trim()
}

async function readLegacyBalancedModels() {
    const [openaiModelRaw, claudeModelRaw, anthropicLegacyRaw, geminiModelRaw, deepseekModelRaw, openrouterModelRaw] = await Promise.all([
        getSystemStateValue(LEGACY_PROVIDER_KEYS.openai),
        getSystemStateValue(LEGACY_PROVIDER_KEYS.claude),
        getSystemStateValue(LEGACY_ANTHROPIC_MODEL_KEY),
        getSystemStateValue(LEGACY_PROVIDER_KEYS.gemini),
        getSystemStateValue(LEGACY_PROVIDER_KEYS.deepseek),
        getSystemStateValue(LEGACY_PROVIDER_KEYS.openrouter),
    ])

    const openaiModel = normalizeModel(openaiModelRaw) || FALLBACK_OPENAI_MODEL
    const claudeModel = normalizeModel(claudeModelRaw) || normalizeModel(anthropicLegacyRaw)
    const geminiModel = normalizeModel(geminiModelRaw)
    const deepseekModel = normalizeModel(deepseekModelRaw)
    const openrouterModel = normalizeModel(openrouterModelRaw)

    return {
        openai: openaiModel,
        claude: claudeModel,
        gemini: geminiModel,
        deepseek: deepseekModel,
        openrouter: openrouterModel,
    }
}

function applyLegacyBalancedFallback(catalogModels, legacyBalanced) {
    const next = normalizeReportAiProviderModels(catalogModels)

    if (legacyBalanced?.openai) {
        next.openai.balanced = legacyBalanced.openai
    }
    if (legacyBalanced?.claude) {
        next.claude.balanced = legacyBalanced.claude
    }
    if (legacyBalanced?.gemini) {
        next.gemini.balanced = legacyBalanced.gemini
    }
    if (legacyBalanced?.deepseek) {
        next.deepseek.balanced = legacyBalanced.deepseek
    }
    if (legacyBalanced?.openrouter) {
        next.openrouter.balanced = legacyBalanced.openrouter
    }

    return next
}

export async function readAiProviderModelCatalog() {
    const stored = await getSystemStateValue(AI_PROVIDER_MODEL_CATALOG_KEY)
    const normalizedStored = stored && typeof stored === 'object' ? stored : {}
    const normalizedStoredModels = normalizeReportAiProviderModels(normalizedStored.models)
    const legacyBalanced = await readLegacyBalancedModels()
    const models = applyLegacyBalancedFallback(normalizedStoredModels, legacyBalanced)

    return {
        key: AI_PROVIDER_MODEL_CATALOG_KEY,
        models,
        source: {
            openai: normalizeModel(legacyBalanced.openai) ? 'legacy_or_default' : 'default',
            claude: normalizeModel(legacyBalanced.claude) ? 'legacy_or_default' : 'default',
            gemini: normalizeModel(legacyBalanced.gemini) ? 'legacy_or_default' : 'default',
            deepseek: normalizeModel(legacyBalanced.deepseek) ? 'legacy_or_default' : 'default',
            openrouter: normalizeModel(legacyBalanced.openrouter) ? 'legacy_or_default' : 'default',
        },
    }
}

export async function writeAiProviderModelCatalog(nextModels) {
    const models = normalizeReportAiProviderModels(nextModels)
    const saved = await setSystemStateValue(AI_PROVIDER_MODEL_CATALOG_KEY, {
        version: 1,
        models,
        updatedAt: new Date().toISOString(),
    })

    if (!saved) {
        return { success: false, models }
    }

    const balancedWrites = []
    for (const provider of REPORT_AI_PROVIDER_KEYS) {
        const balancedModel = normalizeModel(models?.[provider]?.[REPORT_AI_TIER_BALANCED])
        if (!balancedModel) continue
        const stateKey = LEGACY_PROVIDER_KEYS[provider]
        if (!stateKey) continue
        balancedWrites.push(setSystemStateValue(stateKey, balancedModel))
    }

    if (balancedWrites.length > 0) {
        await Promise.allSettled(balancedWrites)
    }

    return { success: true, models }
}

export function buildProviderTierOptions(models) {
    const normalized = normalizeReportAiProviderModels(models || DEFAULT_REPORT_AI_PROVIDER_MODELS)
    const options = []

    for (const provider of REPORT_AI_PROVIDER_KEYS) {
        for (const tier of REPORT_AI_TIER_KEYS) {
            const model = normalizeModel(normalized?.[provider]?.[tier])
            if (!model) continue
            options.push({ provider, tier, model })
        }
    }

    return options
}
