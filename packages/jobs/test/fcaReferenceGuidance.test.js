import test from 'node:test'
import assert from 'node:assert/strict'
import { generateFcaReportDraft } from '../src/jobs/fcaReportGeneration.js'
import {
    FCA_REFERENCE_FUNCTIONAL_AREAS,
    FCA_REFERENCE_GUIDANCE_TEXT,
    FCA_REFERENCE_SOURCE_URL,
    resolveFcaReferenceGuidance,
} from '../src/jobs/fcaReferenceGuidance.js'

test('builds NDIS reference guidance covering the published source and the six areas', () => {
    const guidance = resolveFcaReferenceGuidance()

    assert.equal(guidance, FCA_REFERENCE_GUIDANCE_TEXT)
    assert.match(guidance, new RegExp(FCA_REFERENCE_SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(guidance, /National Disability Insurance Agency/)
    for (const area of FCA_REFERENCE_FUNCTIONAL_AREAS) {
        assert.match(guidance, new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    // Framing, not evidence: the writer must never quote it as participant detail.
    assert.match(guidance, /never be quoted as evidence/)
})

test('honours an explicit override and an explicit opt-out', () => {
    assert.equal(resolveFcaReferenceGuidance('Custom framing only.'), 'Custom framing only.')
    assert.equal(resolveFcaReferenceGuidance(''), '')
    assert.equal(resolveFcaReferenceGuidance(false), '')
    assert.equal(resolveFcaReferenceGuidance(null), '')
})

test('sends the NDIS reference as framing on every section prompt', async () => {
    const originalFetch = globalThis.fetch
    const requestBodies = []

    globalThis.fetch = async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body || '{}')))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Section body.' } }] }),
        }
    }

    try {
        const draft = await generateFcaReportDraft({
            patientName: 'Test Participant',
            domain: 'example',
            notes: 'Participant reports reduced endurance for community outings.',
            transcripts: [],
            additionalContext: '',
            builderFormData: null,
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 1,
        })

        assert.equal(draft.meta.adapter, 'openai-with-heuristic-fallback')
        assert.ok(requestBodies.length > 1, 'expected one request per blueprint section')

        for (const body of requestBodies) {
            const userMessage = body.messages?.find((message) => message.role === 'user')?.content || ''
            assert.match(userMessage, /Official NDIS reference \(framing only, not participant evidence\):/)
            assert.match(userMessage, /self-management/)
        }

        assert.deepEqual(draft.meta.referenceGuidance, {
            sources: [FCA_REFERENCE_SOURCE_URL],
            characters: FCA_REFERENCE_GUIDANCE_TEXT.length,
            isDefaultNdisGuidance: true,
        })
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('omits the reference block when the report type turns it off', async () => {
    const originalFetch = globalThis.fetch
    let userMessage = ''

    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        userMessage = body.messages?.find((message) => message.role === 'user')?.content || ''
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Section body.' } }] }),
        }
    }

    try {
        const draft = await generateFcaReportDraft({
            patientName: 'Test Participant',
            domain: 'example',
            notes: 'Participant reports reduced endurance for community outings.',
            transcripts: [],
            additionalContext: '',
            builderFormData: null,
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 1,
            reportTypeConfig: { fcaPromptConfig: { referenceGuidance: false } },
        })

        assert.doesNotMatch(userMessage, /Official NDIS reference/)
        assert.deepEqual(draft.meta.referenceGuidance.sources, [])
        assert.equal(draft.meta.referenceGuidance.characters, 0)
    } finally {
        globalThis.fetch = originalFetch
    }
})
