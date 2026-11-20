import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_DOMAIN_AI_FEATURE_PRESETS,
    DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
    DOMAIN_AI_FEATURE_BOOKING_ASSISTANT,
    DOMAIN_AI_FEATURE_INTAKE_ASSISTANT,
    DOMAIN_AI_FEATURE_KEYS,
    DOMAIN_AI_FEATURE_QUOTE_WRITER,
    aiProviderToAssistantProvider,
    assistantProviderToAiProvider,
    buildDomainAiPresetOptions,
    findDomainAiPresetValue,
    getDomainAiPresetValue,
    normalizeDomainAiFeaturePresets,
    parseDomainAiPresetValue,
    resolveDomainAiFeaturePreset,
    resolveDomainAiFeatureSelection,
} from '../src/lib/domainAiFeatures.js'
import { DEFAULT_REPORT_AI_PROVIDER_MODELS } from '../src/lib/reportAiProviders.js'

function presetInput(presets) {
    return normalizeDomainAiFeaturePresets(presets)
}

test('every domain AI feature starts on the domain default', () => {
    assert.deepEqual(DEFAULT_DOMAIN_AI_FEATURE_PRESETS, {
        [DOMAIN_AI_FEATURE_INTAKE_ASSISTANT]: { provider: '', tier: '' },
        [DOMAIN_AI_FEATURE_BOOKING_ASSISTANT]: { provider: '', tier: '' },
        [DOMAIN_AI_FEATURE_QUOTE_WRITER]: { provider: '', tier: '' },
        [DOMAIN_AI_FEATURE_ADMIN_ASSISTANT]: { provider: '', tier: '' },
    })
    assert.deepEqual(DOMAIN_AI_FEATURE_KEYS, Object.keys(DEFAULT_DOMAIN_AI_FEATURE_PRESETS))
})

test('normalizes presets and rejects half-written or unknown values', () => {
    const normalized = presetInput({
        intakeAssistant: { provider: 'anthropic', tier: 'FLAGSHIP' },
        bookingAssistant: { provider: 'openai' },
        quoteWriter: { provider: 'mystery', tier: 'balanced' },
        unknownFeature: { provider: 'openai', tier: 'value' },
    })

    assert.deepEqual(normalized.intakeAssistant, { provider: 'claude', tier: 'flagship' })
    assert.deepEqual(normalized.bookingAssistant, { provider: '', tier: '' })
    assert.deepEqual(normalized.quoteWriter, { provider: '', tier: '' })
    assert.equal('unknownFeature' in normalized, false)
})

test('the preset matrix mirrors the Reporting Settings tiers', () => {
    const options = buildDomainAiPresetOptions(DEFAULT_REPORT_AI_PROVIDER_MODELS)

    assert.equal(options.length, 5 * 3)
    const openAiFlagship = options.find((option) => option.value === 'openai:flagship')
    assert.equal(openAiFlagship.model, DEFAULT_REPORT_AI_PROVIDER_MODELS.openai.flagship)
    assert.match(openAiFlagship.label, /OpenAI · Flagship/)
    assert.deepEqual(options.find((option) => option.value === 'claude:value'), {
        value: 'claude:value',
        provider: 'claude',
        tier: 'value',
        model: DEFAULT_REPORT_AI_PROVIDER_MODELS.claude.value,
        providerLabel: 'Claude',
        tierLabel: 'Value',
        label: `Claude · Value (${DEFAULT_REPORT_AI_PROVIDER_MODELS.claude.value})`,
    })
})

test('preset values round-trip and match a stored model', () => {
    assert.equal(getDomainAiPresetValue('openai', 'balanced'), 'openai:balanced')
    assert.equal(getDomainAiPresetValue('unknown', 'balanced'), '')
    assert.equal(getDomainAiPresetValue('openai', 'max'), '')

    assert.deepEqual(parseDomainAiPresetValue('claude:value'), { provider: 'claude', tier: 'value' })
    assert.deepEqual(parseDomainAiPresetValue(''), { provider: '', tier: '' })
    assert.deepEqual(parseDomainAiPresetValue('claude:max'), { provider: '', tier: '' })

    assert.equal(
        findDomainAiPresetValue(DEFAULT_REPORT_AI_PROVIDER_MODELS, 'gemini', DEFAULT_REPORT_AI_PROVIDER_MODELS.gemini.value),
        'gemini:value'
    )
    assert.equal(findDomainAiPresetValue(DEFAULT_REPORT_AI_PROVIDER_MODELS, 'gemini', 'gemini-custom'), '')
})

test('a feature inherits the domain default when no preset is set', () => {
    const selection = resolveDomainAiFeatureSelection(DOMAIN_AI_FEATURE_INTAKE_ASSISTANT, {}, {
        providerModels: DEFAULT_REPORT_AI_PROVIDER_MODELS,
        fallbackProvider: 'deepseek',
        fallbackModel: 'deepseek-chat',
    })

    assert.deepEqual(selection, {
        feature: 'intakeAssistant',
        custom: false,
        provider: 'deepseek',
        providerLabel: 'DeepSeek',
        tier: '',
        tierLabel: '',
        model: 'deepseek-chat',
    })
    assert.equal(resolveDomainAiFeaturePreset(DOMAIN_AI_FEATURE_INTAKE_ASSISTANT, {}), null)
})

test('a preset resolves the provider and the catalog model for that tier', () => {
    const presets = presetInput({
        quoteWriter: { provider: 'openrouter', tier: 'value' },
    })
    const selection = resolveDomainAiFeatureSelection(DOMAIN_AI_FEATURE_QUOTE_WRITER, presets, {
        providerModels: DEFAULT_REPORT_AI_PROVIDER_MODELS,
        fallbackProvider: 'openai',
        fallbackModel: 'gpt-4.1-mini',
    })

    assert.equal(selection.custom, true)
    assert.equal(selection.provider, 'openrouter')
    assert.equal(selection.tier, 'value')
    assert.equal(selection.model, DEFAULT_REPORT_AI_PROVIDER_MODELS.openrouter.value)

    assert.deepEqual(resolveDomainAiFeaturePreset(DOMAIN_AI_FEATURE_QUOTE_WRITER, presets), {
        provider: 'openrouter',
        providerLabel: 'OpenRouter',
        tier: 'value',
        tierLabel: 'Value',
        model: DEFAULT_REPORT_AI_PROVIDER_MODELS.openrouter.value,
    })
})

test('assistant providers map onto the catalog provider ids', () => {
    assert.equal(assistantProviderToAiProvider('google-vertex'), 'gemini')
    assert.equal(assistantProviderToAiProvider('google'), 'gemini')
    assert.equal(assistantProviderToAiProvider('openai'), 'openai')
    assert.equal(assistantProviderToAiProvider('claude'), 'claude')

    assert.equal(aiProviderToAssistantProvider('gemini'), 'google')
    assert.equal(aiProviderToAssistantProvider('openrouter'), 'openrouter')
    assert.equal(aiProviderToAssistantProvider('mystery'), '')
})
