import test from 'node:test'
import assert from 'node:assert/strict'
import { __testOnly } from '../src/jobs/scribeWorker.js'

test('structured evidence prefers patient/assertion lines and suppresses OT question lines', () => {
    const transcriptText = [
        'OT: How has showering and dressing been on higher-fatigue days?',
        'Patient: Showering is harder if I stand too long and I need seated setup.',
        'OT: Any falls since we last spoke?',
        'Patient: No full falls, but two near misses on the front step when I was rushing.',
    ].join('\n')

    const facts = __testOnly.buildStructuredEvidenceFacts(transcriptText, 'topic-bullets-third-person')
    const observed = facts.map((item) => String(item?.observedIssue || '').toLowerCase())

    assert.ok(observed.some((line) => line.includes('showering is harder if i stand too long')))
    assert.ok(observed.some((line) => line.includes('no full falls, but two near misses')))
    assert.ok(!observed.some((line) => line.includes('how has showering and dressing')))
    assert.ok(!observed.some((line) => line.includes('any falls since we last spoke')))
})

test('action items suppress low-value check-in questions', () => {
    const transcriptText = [
        'OT: I want to check in on how things have been at home and in the community over the last two weeks.',
        "OT: Let's agree on this week's plan: seated shower setup every day and split domestic tasks into short blocks.",
        "OT: I'll send today's summary with action steps.",
    ].join('\n')

    const actionItems = __testOnly.buildActionItems(transcriptText, 5)
    const combined = actionItems.join(' ').toLowerCase()

    assert.ok(!combined.includes('check in on how things have been'))
    assert.ok(combined.includes("let's agree on this week's plan"))
    assert.ok(combined.includes("i'll send today's summary"))
})

test('topic bullets vary wording instead of repeating the same template', () => {
    const transcriptText = [
        'Patient: My fatigue is worse after morning tasks and I need to pace myself.',
        'Patient: Pain spikes in my hands when I try to cook or write.',
        'Patient: I feel unsteady on stairs and I have had near misses on transfers.',
        'Patient: Showering and dressing take longer because of fatigue and balance issues.',
    ].join('\n')

    const topics = __testOnly.buildThirdPersonTopicBullets(transcriptText)
    const joined = topics.join('\n')

    assert.ok(!joined.includes('OT and the patient discussed'))
    assert.ok(topics.some((topic) => /fatigue|energy|endurance/i.test(topic)))
    assert.ok(topics.some((topic) => /pain|symptom|flare/i.test(topic)))
    assert.ok(topics.some((topic) => /mobility|transfer|falls|stairs/i.test(topic)))
    assert.ok(topics.some((topic) => /showers?|dressing|personal care|hygiene/i.test(topic)))
    assert.ok(topics.some((topic) => /review|assessment|exploration/i.test(topic)))
})

test('normalizes LLM evidence facts and drops entries without an observed issue', () => {
    const facts = __testOnly.normalizeLlmEvidenceFacts({
        facts: [
            {
                domain: 'ADL-Personal-Care',
                observedIssue: 'The patient reports difficulty washing and drying below the knee.',
                functionalImpact: 'Lower body hygiene cannot be completed independently.',
                supportImplication: 'Support worker assistance for lower limb washing is indicated.',
            },
            { domain: 'pain', functionalImpact: 'No observed issue supplied.' },
            'not an object',
        ],
    })

    assert.equal(facts.length, 1)
    assert.equal(facts[0].domain, 'adl-personal-care')
    assert.ok(facts[0].supportImplication.includes('lower limb washing'))
})

test('OTF10 summary uses LLM evidence facts instead of heuristic boilerplate', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: 'Patient: My back pain stops me vacuuming the bedroom.' },
        { scribeConfig: { summaryStyle: 'otf10-home-services', includeActionItems: false } },
        {
            llmEvidenceFacts: [
                {
                    domain: 'domestic-function',
                    observedIssue: 'The patient is unable to vacuum the bedroom due to spinal pain on bending.',
                    functionalImpact: 'Bedroom floor care cannot be completed without assistance.',
                    supportImplication: 'Domestic support for vacuuming and heavier bedroom cleaning is indicated.',
                },
            ],
            llmFollowUps: ['Podiatrist to provide a treatment plan for the right foot.'],
        }
    )

    assert.equal(summary.evidenceExtractor, 'openai')
    assert.ok(summary.summaryText.includes('- Area: domestic-function'))
    assert.ok(summary.summaryText.includes('unable to vacuum the bedroom'))
    assert.ok(!summary.summaryText.includes('Consider support planning that addresses reliability'))
})

test('OTF10 summary falls back to heuristic evidence when no LLM facts are available', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: 'Patient: Showering is harder if I stand too long and I need a seated setup.' },
        { scribeConfig: { summaryStyle: 'otf10-home-services' } },
        { llmEvidenceFacts: [] }
    )

    assert.equal(summary.evidenceExtractor, 'heuristic')
    assert.ok(summary.summaryText.length > 0)
})

test('follow-up normalization drops first-person speech, questions, and beliefs', () => {
    const followUps = __testOnly.normalizeLlmFollowUps({
        followUps: [
            'Podiatrist to provide a treatment plan for the right foot.',
            'I should use my right leg.',
            'Because that will make me more sick.',
            'Should the patient be referred for a review?',
            '   ',
            'Podiatrist to provide a treatment plan for the right foot.',
        ],
    })

    assert.deepEqual(followUps, ['Podiatrist to provide a treatment plan for the right foot.'])
})

test('OTF10 summary never derives follow-ups from raw transcript keyword matches', () => {
    const transcriptText = [
        'Patient: I should use my right leg.',
        'Patient: Because that will make me more sick.',
        'Patient: Someone told me last time that this time it will become cancer.',
    ].join('\n')

    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: transcriptText },
        { scribeConfig: { summaryStyle: 'otf10-home-services' } },
        { llmEvidenceFacts: null, llmFollowUps: null }
    )

    assert.deepEqual(summary.actionItems, [])
    assert.ok(!summary.summaryText.includes('- Follow-up:'))
    assert.ok(!summary.summaryText.includes('cancer'))
})

test('non-OTF10 styles keep heuristic action items', () => {
    const transcriptText = [
        "OT: Let's agree on this week's plan: seated shower setup every day.",
        'Patient: My fatigue is worse after morning tasks.',
    ].join('\n')

    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: transcriptText },
        { scribeConfig: { summaryStyle: 'detailed' } }
    )

    assert.ok(summary.actionItems.length > 0)
})

test('reasoning models do not receive a custom temperature', () => {
    assert.equal(__testOnly.supportsCustomTemperature('gpt-5.5'), false)
    assert.equal(__testOnly.supportsCustomTemperature('gpt-5-mini'), false)
    assert.equal(__testOnly.supportsCustomTemperature('o3'), false)
    assert.equal(__testOnly.supportsCustomTemperature('gpt-4.1-mini'), true)
})

test('general summary uses LLM topics carrying the actual finding', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: 'Patient: My back pain stops me bending to vacuum.' },
        { scribeConfig: { summaryStyle: 'topic-bullets-third-person' } },
        {
            llmTopics: ['- Reports right-sided back pain that prevents bending to vacuum.'],
            llmEvidenceFacts: [
                {
                    domain: 'domestic-function',
                    observedIssue: 'Unable to vacuum due to pain on bending.',
                    functionalImpact: 'Floor care requires assistance.',
                    supportImplication: 'Domestic support indicated.',
                },
            ],
        }
    )

    assert.ok(summary.summaryText.includes('prevents bending to vacuum'))
    assert.ok(!summary.summaryText.includes('Review of pain patterns'))
    assert.ok(!summary.summaryText.includes('Assessment of pain variability'))
})

test('general summary falls back to heuristic topics when the LLM returns none', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: 'Patient: My fatigue is worse after morning tasks and I need to pace myself.' },
        { scribeConfig: { summaryStyle: 'topic-bullets-third-person' } },
        { llmTopics: [], llmEvidenceFacts: null }
    )

    assert.equal(summary.evidenceExtractor, 'heuristic')
    assert.ok(summary.summaryText.length > 0)
})

test('clinical-brief style uses the LLM brief when available', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { transcript_text: 'Patient: I get short of breath on the stairs.' },
        { scribeConfig: { summaryStyle: 'clinical-brief' } },
        { llmBrief: 'The patient reports exertional breathlessness limiting stair use at home.' }
    )

    assert.equal(summary.summaryText, 'The patient reports exertional breathlessness limiting stair use at home.')
})

test('topic and brief normalization reject first-person and questions', () => {
    assert.deepEqual(
        __testOnly.normalizeLlmTopics({ topics: ['Reports pain on bending.', 'I get pain.', 'Does the patient have pain?'] }),
        ['- Reports pain on bending.']
    )
    assert.equal(__testOnly.normalizeLlmBrief({ brief: 'My back hurts when I bend.' }), '')
    assert.equal(
        __testOnly.normalizeLlmBrief({ brief: 'The patient reports back pain on bending.' }),
        'The patient reports back pain on bending.'
    )
})

test('OTF10 instructions suppress topics and brief, other styles request them', () => {
    const otf10 = __testOnly.buildEvidenceUserInstructions('otf10-home-services')
    assert.ok(otf10.includes('Return an empty array for topics and an empty string for brief.'))
    assert.ok(!otf10.includes('Rules for topics:'))

    const general = __testOnly.buildEvidenceUserInstructions('topic-bullets-third-person')
    assert.ok(general.includes('Rules for topics:'))
    assert.ok(!general.includes('Rules for brief:'))

    const brief = __testOnly.buildEvidenceUserInstructions('clinical-brief')
    assert.ok(brief.includes('Rules for brief:'))
})

test('OTF10 jobs use the saved HSR Summariser prompt and settings', () => {
    const config = __testOnly.getScribeConfig(
        { scribeConfig: { summaryStyle: 'otf10-home-services' } },
        {
            patientAgents: {
                scribeConfig: { workerPrompt: 'General prompt', includeActionItems: true },
                hsrSummariserConfig: {
                    workerPrompt: 'Custom HSR prompt',
                    includeActionItems: false,
                    additionalInstructions: 'Emphasize domestic support.',
                },
            },
        }
    )

    assert.equal(config.summaryStyle, 'otf10-home-services')
    assert.equal(config.workerPrompt, 'Custom HSR prompt')
    assert.equal(config.includeActionItems, false)
    assert.equal(config.additionalInstructions, 'Emphasize domestic support.')
})

test('OTF10 jobs use the HSR Summariser enable flag with legacy HSR Creator fallback', () => {
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { hsrSummariser: true } }, 'otf10-home-services'), true)
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { hsrSummariser: false, hsrCreator: true } }, 'otf10-home-services'), true)
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { hsrCreator: true } }, 'otf10-home-services'), true)
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { scribe: true } }, 'topic-bullets-third-person'), true)
})

test('summary generation fingerprints distinguish transcript and HSR prompt changes', () => {
    const base = {
        transcriptText: 'Patient: Vacuuming increases lower back pain.',
        scribeConfig: {
            summaryStyle: 'otf10-home-services',
            includeActionItems: true,
            workerPrompt: 'Summarize home support evidence.',
            additionalInstructions: '',
        },
        aiUsage: { model: 'gpt-4.1-mini', provider: 'openai' },
    }

    const fingerprint = __testOnly.buildSummaryGenerationFingerprint(base)
    assert.equal(__testOnly.buildSummaryGenerationFingerprint(base), fingerprint)
    assert.notEqual(__testOnly.buildSummaryGenerationFingerprint({ ...base, transcriptText: `${base.transcriptText} Patient: Showering also requires assistance.` }), fingerprint)
    assert.notEqual(__testOnly.buildSummaryGenerationFingerprint({ ...base, scribeConfig: { ...base.scribeConfig, workerPrompt: 'Use a revised HSR prompt.' } }), fingerprint)
    assert.equal(__testOnly.buildSummaryGenerationLockKey('example', 17, 'otf10-home-services'), 'scribe:example:17:otf10-home-services')
})