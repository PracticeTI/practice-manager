import assert from 'node:assert/strict'
import test from 'node:test'

import {
    AI_PROVIDER_API_KEY_ENV_VARS,
    AI_PROVIDER_IDS,
    AI_PROVIDER_META,
    DEFAULT_AI_PROVIDER,
    getAiProviderDefaultModel,
    getAiProviderLabel,
    inferAiProviderFromModel,
    isKnownAiProvider,
    isModelCompatibleWithProvider,
    normalizeAiProvider,
} from '../src/lib/ai/providers.js'
import {
    getAiProviderApiKeyAvailability,
    resolveAiConfig,
    resolveAiProviderApiKey,
    resolveAiProviderBaseUrl,
    resolveAiProviderModel,
} from '../src/lib/ai/credentials.js'
import { probeAiProvider } from '../src/lib/ai/status.js'
import {
    DEFAULT_REPORT_AI_PROVIDER_MODELS,
    REPORT_AI_PROVIDER_KEYS,
    normalizeReportAiProviderModels,
    resolveReportAiSelection,
} from '../src/lib/reportAiProviders.js'

// The provider env keys are global; isolate each test that touches them.
const PROVIDER_ENV_KEYS = [
    'AI_PROVIDER',
    'AI_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_BASE_URL',
    'CLAUDE_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_MODEL',
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GEMINI_MODEL',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODEL',
]

function withCleanEnv(fn) {
    const saved = new Map(PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of PROVIDER_ENV_KEYS) delete process.env[key]
    try {
        return fn()
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test('the registry covers every promised vendor', () => {
    assert.deepEqual(AI_PROVIDER_IDS, ['openai', 'claude', 'gemini', 'deepseek', 'openrouter'])
    for (const provider of AI_PROVIDER_IDS) {
        assert.ok(AI_PROVIDER_META[provider].label)
        assert.ok(AI_PROVIDER_META[provider].baseUrl.startsWith('https://'))
        assert.ok(getAiProviderDefaultModel(provider))
    }
})

test('every provider advertises at least one API key environment variable', () => {
    for (const provider of AI_PROVIDER_IDS) {
        const envVars = AI_PROVIDER_API_KEY_ENV_VARS[provider]
        assert.ok(Array.isArray(envVars) && envVars.length > 0, `${provider} has no key env var`)
        assert.ok(envVars.every((name) => typeof name === 'string' && name.endsWith('_API_KEY')))
    }
})

test('vendor-name aliases resolve to canonical ids', () => {
    assert.equal(normalizeAiProvider('anthropic'), 'claude')
    assert.equal(normalizeAiProvider('ANTHROPIC'), 'claude')
    assert.equal(normalizeAiProvider('google'), 'gemini')
    assert.equal(normalizeAiProvider('deepseek'), 'deepseek')
    assert.equal(normalizeAiProvider('deep-seek'), 'deepseek')
    assert.equal(normalizeAiProvider('open-router'), 'openrouter')
    assert.equal(normalizeAiProvider(''), DEFAULT_AI_PROVIDER)
})

test('an unknown provider is not silently coerced when a fallback is not allowed', () => {
    assert.equal(normalizeAiProvider('mystery-vendor', ''), '')
    assert.equal(isKnownAiProvider('mystery-vendor'), false)
    assert.equal(isKnownAiProvider('claude'), true)
})

test('model ids are mapped back to their vendor', () => {
    assert.equal(inferAiProviderFromModel('claude-sonnet-4-20250514'), 'claude')
    assert.equal(inferAiProviderFromModel('gemini-2.5-flash'), 'gemini')
    assert.equal(inferAiProviderFromModel('deepseek-chat'), 'deepseek')
    assert.equal(inferAiProviderFromModel('gpt-5.4-mini'), 'openai')
    assert.equal(inferAiProviderFromModel('custom-fine-tune-7b'), '')
})

test('a model from another vendor is rejected', () => {
    assert.equal(isModelCompatibleWithProvider('openai', 'claude-sonnet-4-20250514'), false)
    assert.equal(isModelCompatibleWithProvider('openai', 'gpt-5.4-mini'), true)
    assert.equal(isModelCompatibleWithProvider('deepseek', 'deepseek-reasoner'), true)
    // Unknown ids are allowed so custom deployments still work.
    assert.equal(isModelCompatibleWithProvider('openai', 'my-deployment-01'), true)
    assert.equal(isModelCompatibleWithProvider('openrouter', 'anthropic/claude-sonnet-4'), true)
})

test('credentials resolve from env and default to the provider base URL', () => {
    withCleanEnv(() => {
        process.env.DEEPSEEK_API_KEY = 'ds-key'
        const config = resolveAiConfig({ provider: 'deepseek' })

        assert.equal(config.provider, 'deepseek')
        assert.equal(config.providerLabel, 'DeepSeek')
        assert.equal(config.kind, 'openai-compatible')
        assert.equal(config.apiKey, 'ds-key')
        assert.equal(config.baseUrl, 'https://api.deepseek.com/v1')
        assert.equal(config.model, 'deepseek-chat')
        assert.equal(config.hasApiKey, true)
        assert.equal(config.modelProviderMismatch, false)
    })
})

test('OpenRouter resolves its key, model and OpenAI-compatible endpoint', () => {
    withCleanEnv(() => {
        assert.equal(getAiProviderDefaultModel('openrouter'), 'minimax/minimax-m3.1-flash')
        process.env.OPENROUTER_API_KEY = 'or-key'
        process.env.OPENROUTER_MODEL = 'anthropic/claude-sonnet-4'
        const config = resolveAiConfig({ provider: 'openrouter' })

        assert.equal(config.providerLabel, 'OpenRouter')
        assert.equal(config.kind, 'openai-compatible')
        assert.equal(config.apiKey, 'or-key')
        assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1')
        assert.equal(config.model, 'anthropic/claude-sonnet-4')
        assert.equal(config.modelProviderMismatch, false)
        assert.equal(config.capabilities.webSearch, false)
    })
})

test('OpenRouter model discovery keeps provider/model ids intact', async () => {
    const probe = await probeAiProvider('openrouter', {
        apiKey: 'or-key',
        fetchImpl: async (url, options) => {
            assert.equal(url, 'https://openrouter.ai/api/v1/models')
            assert.equal(options.headers.Authorization, 'Bearer or-key')
            return new Response(JSON.stringify({
                data: [{ id: 'anthropic/claude-sonnet-4' }],
            }), { status: 200 })
        },
    })

    assert.equal(probe.valid, true)
    assert.deepEqual(probe.models, ['anthropic/claude-sonnet-4'])
})

test('explicit config beats domain settings, which beat env, which beat the default', () => {
    withCleanEnv(() => {
        process.env.DEEPSEEK_MODEL = 'deepseek-reasoner'
        const domainSettings = { aiVendor: 'deepseek', aiModel: 'deepseek-chat' }

        assert.equal(resolveAiProviderModel('deepseek', { model: 'explicit-model' }).model, 'explicit-model')
        assert.equal(resolveAiProviderModel('deepseek', { domainSettings }).model, 'deepseek-chat')
        assert.equal(resolveAiProviderModel('deepseek', {}).model, 'deepseek-reasoner')
        assert.equal(resolveAiProviderModel('claude', {}).model, getAiProviderDefaultModel('claude'))
    })
})

test('a domain key never leaks to a different provider', () => {
    withCleanEnv(() => {
        const domainSettings = { aiVendor: 'openai', aiApiKey: 'sk-domain-openai' }

        assert.equal(resolveAiProviderApiKey('openai', { domainSettings }), 'sk-domain-openai')
        assert.equal(resolveAiProviderApiKey('claude', { domainSettings }), '')
    })
})

test('provider key aliases are accepted', () => {
    withCleanEnv(() => {
        process.env.ANTHROPIC_API_KEY = 'anthropic-key'
        assert.equal(resolveAiProviderApiKey('claude'), 'anthropic-key')

        delete process.env.ANTHROPIC_API_KEY
        process.env.CLAUDE_API_KEY = 'claude-key'
        assert.equal(resolveAiProviderApiKey('claude'), 'claude-key')
    })
})

test('base URL env overrides the default endpoint', () => {
    withCleanEnv(() => {
        process.env.OPENAI_BASE_URL = 'https://gateway.example.test/v1'
        assert.equal(resolveAiProviderBaseUrl('openai'), 'https://gateway.example.test/v1')
        assert.equal(resolveAiProviderBaseUrl('gemini'), AI_PROVIDER_META.gemini.baseUrl)
    })
})

test('key availability reports every provider independently', () => {
    withCleanEnv(() => {
        process.env.GEMINI_API_KEY = 'gemini-key'
        const availability = getAiProviderApiKeyAvailability()

        assert.deepEqual(availability, {
            openai: false,
            claude: false,
            gemini: true,
            deepseek: false,
            openrouter: false,
        })
    })
})

test('report provider catalog includes DeepSeek with a full tier set', () => {
    assert.ok(REPORT_AI_PROVIDER_KEYS.includes('deepseek'))
    assert.ok(REPORT_AI_PROVIDER_KEYS.includes('claude'))
    assert.ok(REPORT_AI_PROVIDER_KEYS.includes('gemini'))
    assert.ok(REPORT_AI_PROVIDER_KEYS.includes('openrouter'))
    assert.deepEqual(DEFAULT_REPORT_AI_PROVIDER_MODELS.openrouter, {
        flagship: 'moonshotai/kimi-k3',
        balanced: 'qwen/qwen3.8-2.4t-a95b',
        value: 'minimax/minimax-m3.1-flash',
    })

    for (const provider of REPORT_AI_PROVIDER_KEYS) {
        for (const tier of ['flagship', 'balanced', 'value']) {
            assert.ok(DEFAULT_REPORT_AI_PROVIDER_MODELS[provider][tier], `${provider}/${tier}`)
        }
    }
})

test('stored report models normalise without dropping other providers', () => {
    const models = normalizeReportAiProviderModels({
        deepseek: { balanced: 'deepseek-reasoner' },
    })

    assert.equal(models.deepseek.balanced, 'deepseek-reasoner')
    assert.equal(models.openai.balanced, DEFAULT_REPORT_AI_PROVIDER_MODELS.openai.balanced)

    const selection = resolveReportAiSelection({
        aiProvider: 'deepseek',
        aiModelTier: 'balanced',
        providerModels: models,
    })
    assert.equal(selection.provider, 'deepseek')
    assert.equal(selection.model, 'deepseek-reasoner')
    assert.equal(selection.providerLabel, getAiProviderLabel('deepseek'))
})
