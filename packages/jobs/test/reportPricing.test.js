import test from 'node:test'
import assert from 'node:assert/strict'
import { __testOnly } from '../src/jobs/reportWorker.js'

// `estimateTokensFromText` is chars/4, so 4,000 characters is exactly 1,000 tokens. Every case below
// therefore reads as "<input rate> per 1k in + <output rate> per 1k out".
const SOURCE_NOTES = 'a'.repeat(4000)
const REPORT = 'b'.repeat(4000)

function costFor(model) {
    return __testOnly.buildReportUsage({ sourceNotes: SOURCE_NOTES, reportMarkdown: REPORT, model }).estimatedCostUsd
}

test('prices Claude models at their published rates instead of the OpenAI fallback', () => {
    // Claude Opus 5.5: $4 in / $20 out per million -> $0.004 + $0.020
    assert.equal(costFor('claude-opus-5-5').toFixed(4), '0.0240')
    // Claude Sonnet 5.5: $2 / $10
    assert.equal(costFor('claude-sonnet-5-5').toFixed(4), '0.0120')
    // Claude Haiku 5.5: $0.10 / $0.50
    assert.equal(costFor('claude-haiku-5-5').toFixed(4), '0.0006')
})

test('prices the OpenAI flagship the worker actually queues', () => {
    // gpt-5.6-sol: $4 / $20
    assert.equal(costFor('gpt-5.6-sol').toFixed(4), '0.0240')
    // gpt-5.4-mini: $0.75 / $4.50
    assert.equal(costFor('gpt-5.4-mini').toFixed(4), '0.0053')
})

test('treats a dated model alias as the model it dates', () => {
    assert.equal(costFor('claude-sonnet-4-5-20250929'), costFor('claude-sonnet-4-5'))
    assert.equal(costFor('claude-haiku-4-5-20251001'), costFor('claude-haiku-4-5'))
})

test('an unknown model still resolves to a number rather than NaN', () => {
    const cost = costFor('some-future-model')
    assert.ok(Number.isFinite(cost))
    assert.ok(cost > 0)
})

test('prices every configured OpenRouter tier at the rates OpenRouter publishes', () => {
    // kimi-k3 (flagship): $0.20 / $16.00 per million
    assert.equal(costFor('moonshotai/kimi-k3').toFixed(6), '0.016200')
    // qwen3.8-2.4t-a95b (balanced): $2.00 / $6.00
    assert.equal(costFor('qwen/qwen3.8-2.4t-a95b').toFixed(6), '0.008000')
    // minimax-m3.1-flash (value): $0.15 / $0.60
    assert.equal(costFor('minimax/minimax-m3.1-flash').toFixed(6), '0.000750')
})

test('the OpenRouter ladder costs more as the tier gets stronger', () => {
    const value = costFor('minimax/minimax-m3.1-flash')
    const balanced = costFor('qwen/qwen3.8-2.4t-a95b')
    const flagship = costFor('moonshotai/kimi-k3')
    assert.ok(value < balanced, 'value must be cheaper than balanced')
    assert.ok(balanced < flagship, 'balanced must be cheaper than flagship')
})

test('prefers the provider-reported usage over a text-length estimate', () => {
    const usage = __testOnly.buildReportUsage({
        sourceNotes: SOURCE_NOTES,
        reportMarkdown: REPORT,
        model: 'moonshotai/kimi-k3',
        providerUsage: {
            inputTokens: 1200,
            outputTokens: 3400,
            totalTokens: 4600,
            costUsd: 0.0548,
            reasoningTokens: 2600,
        },
    })

    assert.equal(usage.source, 'provider-usage')
    assert.equal(usage.inputTokens, 1200)
    // Reasoning tokens never reach the markdown, so only the provider can report them.
    assert.equal(usage.reasoningTokens, 2600)
    assert.equal(usage.estimatedCostUsd, 0.0548)
})

test('prices provider tokens locally when the host reports no charge', () => {
    const usage = __testOnly.buildReportUsage({
        sourceNotes: SOURCE_NOTES,
        reportMarkdown: REPORT,
        model: 'gpt-5.6-sol',
        providerUsage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000, costUsd: null },
    })

    assert.equal(usage.source, 'provider-usage')
    // gpt-5.6-sol: $4 in / $20 out per million.
    assert.equal(usage.estimatedCostUsd.toFixed(4), '0.0240')
})
