import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePreferredModel } from '../src/lib/aiUsageModel.js'

test('prefers the model captured on report usage over the domain default', () => {
    const model = resolvePreferredModel({
        defaultModel: 'gpt-5.4',
        completedReportJobs: [{ usage_model: 'gpt-5.5' }],
        reports: [
            {
                source_metadata_json: JSON.stringify({ usage: { model: 'gpt-5.5' } }),
            },
        ],
    })

    assert.equal(model, 'gpt-5.5')
})

test('falls back to the configured domain model when no report usage is present', () => {
    const model = resolvePreferredModel({
        defaultModel: 'gpt-5.4',
        completedReportJobs: [],
        reports: [],
    })

    assert.equal(model, 'gpt-5.4')
})
