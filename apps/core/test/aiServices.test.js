import assert from 'node:assert/strict'
import test from 'node:test'

import { AI_PROVIDER_IDS } from '../src/lib/ai/providers.js'
import {
    AI_SERVICE_CHAT,
    AI_SERVICE_KEYS,
    AI_SERVICE_TRANSCRIPTION,
    AI_SERVICE_WEB_SEARCH,
    DEFAULT_SERVICE_PROVIDERS,
    getServiceProviderOptions,
    listServiceProviders,
    normalizeAiServiceSettings,
    resolveServiceProvider,
    serviceSupportsProvider,
} from '../src/lib/ai/services.js'

test('each service only offers providers that support it', () => {
    assert.deepEqual(listServiceProviders(AI_SERVICE_CHAT), AI_PROVIDER_IDS)

    // Claude cannot transcribe; DeepSeek can neither search nor transcribe.
    assert.deepEqual(listServiceProviders(AI_SERVICE_WEB_SEARCH), ['openai', 'claude', 'gemini'])
    assert.deepEqual(listServiceProviders(AI_SERVICE_TRANSCRIPTION), ['openai', 'gemini'])

    assert.equal(serviceSupportsProvider(AI_SERVICE_TRANSCRIPTION, 'claude'), false)
    assert.equal(serviceSupportsProvider(AI_SERVICE_WEB_SEARCH, 'deepseek'), false)
    assert.equal(serviceSupportsProvider(AI_SERVICE_CHAT, 'openrouter'), true)
    assert.equal(serviceSupportsProvider(AI_SERVICE_WEB_SEARCH, 'openrouter'), false)
})

test('every service has a default provider that can serve it', () => {
    for (const service of AI_SERVICE_KEYS) {
        const provider = DEFAULT_SERVICE_PROVIDERS[service]
        assert.ok(provider, `${service} has no default`)
        assert.equal(serviceSupportsProvider(service, provider), true, `${service} default ${provider}`)
    }
})

test('a service keeps its own provider independently of chat', () => {
    const settings = normalizeAiServiceSettings({
        chat: { provider: 'deepseek' },
        webSearch: { provider: 'claude' },
        transcription: { provider: 'openai' },
    })

    assert.equal(settings.chat.provider, 'deepseek')
    assert.equal(settings.webSearch.provider, 'claude')
    assert.equal(settings.transcription.provider, 'openai')
})

test('an unsupported provider is replaced by a capable one', () => {
    // DeepSeek cannot search the web, so the setting cannot strand the feature.
    assert.equal(resolveServiceProvider(AI_SERVICE_WEB_SEARCH, 'deepseek'), 'openai')
    assert.equal(resolveServiceProvider(AI_SERVICE_TRANSCRIPTION, 'claude'), 'openai')
    // Supported choices are preserved.
    assert.equal(resolveServiceProvider(AI_SERVICE_TRANSCRIPTION, 'gemini'), 'gemini')
})

test('vendor aliases resolve inside service settings', () => {
    const settings = normalizeAiServiceSettings({ webSearch: 'anthropic' })
    assert.equal(settings.webSearch.provider, 'claude')
})

test('models default per service', () => {
    const settings = normalizeAiServiceSettings({})
    // Chat and search share the provider's chat default.
    assert.equal(settings.chat.model, settings.webSearch.model)
    // Transcription uses a transcription model, never a chat model.
    assert.notEqual(settings.transcription.model, '')
    assert.match(settings.transcription.model, /transcribe|whisper/)
})

test('an explicit model is kept', () => {
    const settings = normalizeAiServiceSettings({
        transcription: { provider: 'openai', model: 'whisper-1' },
        chat: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
    })
    assert.equal(settings.transcription.model, 'whisper-1')
    assert.equal(settings.chat.provider, 'openrouter')
    assert.equal(settings.chat.model, 'anthropic/claude-sonnet-4')
})

test('provider options expose only capable providers with models', () => {
    const transcriptionOptions = getServiceProviderOptions(AI_SERVICE_TRANSCRIPTION)
    assert.deepEqual(transcriptionOptions.map((option) => option.id), ['openai', 'gemini'])
    for (const option of transcriptionOptions) {
        assert.ok(option.models.length > 0, `${option.id} has no transcription models`)
    }

    const openRouter = getServiceProviderOptions(AI_SERVICE_CHAT).find((option) => option.id === 'openrouter')
    assert.equal(openRouter.defaultModel, 'minimax/minimax-m3.1-flash')
    assert.deepEqual(openRouter.models, [])
})
