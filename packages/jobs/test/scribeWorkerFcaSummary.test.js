import test from 'node:test'
import assert from 'node:assert/strict'
import { __testOnly } from '../src/jobs/scribeWorker.js'

const FCA_STYLE = __testOnly.FCA_SCRIBE_SUMMARY_STYLE

const FCA_TRANSCRIPT = [
    'OT: How has showering been lately?',
    'Patient: Showering is harder if I stand too long and I need the shower chair set up before I start.',
    'Patient: I have had two near misses on the front step when rushing to appointments.',
    'Patient: Vacuuming and the laundry leave me needing a rest for the whole afternoon.',
    'Patient: I would like to get back to cooking meals for myself during the week.',
].join('\n')

const GENERIC_SUMMARY_KWARGS = {
    llmEvidenceFacts: null,
    llmFollowUps: null,
    llmTopics: null,
    llmBrief: '',
}

test('FCA evidence rules label findings with FCA report blueprint sections', () => {
    const allowed = new Set(Object.keys(__testOnly.FCA_SECTION_TITLES))
    const rules = __testOnly.resolveStructuredEvidenceRules(FCA_STYLE)

    // The ids double as the worker's keyword-scoring anchors, so a stray label silently drops
    // evidence out of every report section.
    for (const rule of rules) {
        assert.ok(allowed.has(rule.domain), `unexpected FCA evidence domain: ${rule.domain}`)
    }

    assert.ok(rules.length >= 8)
})

test('non-FCA styles keep the generic evidence rules', () => {
    const generic = __testOnly.resolveStructuredEvidenceRules('topic-bullets-third-person')
    const fca = __testOnly.resolveStructuredEvidenceRules(FCA_STYLE)

    assert.notEqual(generic, fca)
    // `adl-personal-care` is shared, `planning-follow-up` is generic-only.
    assert.ok(generic.some((rule) => rule.domain === 'planning-follow-up'))
    assert.ok(!fca.some((rule) => rule.domain === 'planning-follow-up'))
})

test('FCA facts are grouped under their section titles', () => {
    const facts = [
        {
            domain: 'adl-personal-care',
            observedIssue: 'Needs the shower chair set up before showering.',
            functionalImpact: 'Showering is unsafe when standing for long periods.',
            supportImplication: 'Personal care support is indicated.',
        },
        {
            domain: 'assistive-technology',
            observedIssue: 'Requests a rail at the front step.',
            functionalImpact: 'Misses appointments when steps feel unsafe.',
            supportImplication: 'Home modification funding is indicated.',
        },
    ]

    const blocks = facts.map((fact) => __testOnly.buildFcaEvidenceFact(fact))

    assert.match(blocks[0], /^- Personal Care and Activities of Daily Living/)
    assert.match(blocks[0], /Evidence: Needs the shower chair set up before showering\./)
    assert.match(blocks[0], /Functional impact: /)
    assert.match(blocks[0], /Support implication: /)
    assert.match(blocks[1], /^- Assistive Technology and Environmental Supports/)
})

test('FCA evidence formatting drops empty facts instead of emitting bare headings', () => {
    assert.equal(__testOnly.buildFcaEvidenceFact(null), '')
    assert.equal(__testOnly.buildFcaEvidenceFact({ domain: 'risk-safeguarding' }), '')
})

test('the FCA summary is section-labelled evidence with no generic topic bullets', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { id: 33, transcript_text: FCA_TRANSCRIPT },
        { scribeConfig: { summaryStyle: FCA_STYLE, includeActionItems: true } },
        GENERIC_SUMMARY_KWARGS
    )

    assert.equal(summary.style, FCA_STYLE)
    assert.match(summary.summaryText, /^- Personal Care and Activities of Daily Living/m)
    assert.match(summary.summaryText, /Evidence: /)
    // Multi-line blocks must survive; a whitespace-flattening de-dupe once collapsed them.
    assert.match(summary.summaryText, /\n  Evidence: /)
    assert.doesNotMatch(summary.summaryText, /OT and the patient discussed/)
    assert.equal(summary.structuredEvidenceFacts.length > 0, true)
})

test('the FCA summary never derives follow-ups from raw transcript keyword matches', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { id: 33, transcript_text: FCA_TRANSCRIPT },
        { scribeConfig: { summaryStyle: FCA_STYLE, includeActionItems: true } },
        GENERIC_SUMMARY_KWARGS
    )

    // Heuristic action items would surface patient beliefs as agreed clinical actions.
    assert.deepEqual(summary.actionItems, [])
    assert.doesNotMatch(summary.summaryText, /Follow-up:/)

    const withLlmFollowUps = __testOnly.buildTranscriptSummary(
        { id: 33, transcript_text: FCA_TRANSCRIPT },
        { scribeConfig: { summaryStyle: FCA_STYLE, includeActionItems: true } },
        { ...GENERIC_SUMMARY_KWARGS, llmFollowUps: ['Occupational therapist to arrange a home safety review.'] }
    )

    assert.match(withLlmFollowUps.summaryText, /Follow-up: Occupational therapist to arrange a home safety review\./)
})

test('a transcript with no FCA evidence produces an explicit empty-state summary', () => {
    const summary = __testOnly.buildTranscriptSummary(
        { id: 33, transcript_text: 'OT: Thanks for coming in today. Patient: No worries at all, see you next time then.' },
        { scribeConfig: { summaryStyle: FCA_STYLE, includeActionItems: true } },
        GENERIC_SUMMARY_KWARGS
    )

    assert.ok(summary.summaryText.length > 0)
    assert.equal(summary.summaryText.trim().length > 0, true)
})

test('FCA instructions request blueprint domains and suppress generic topics', () => {
    const instructions = __testOnly.buildEvidenceUserInstructions(FCA_STYLE)
    const genericInstructions = __testOnly.buildEvidenceUserInstructions('topic-bullets-third-person')

    assert.match(instructions, /adl-personal-care/)
    assert.match(instructions, /risk-safeguarding/)
    assert.match(instructions, /Return an empty array for topics/)
    // The generic style still asks for topic bullets.
    assert.match(genericInstructions, /Rules for topics:/)
    assert.doesNotMatch(instructions, /Rules for topics:/)
})

test('FCA jobs use the saved FCA Summariser config and its default prompt', () => {
    const metadata = {
        patientAgents: {
            scribeConfig: { summaryStyle: 'topic-bullets-third-person', includeActionItems: true },
            fcaSummariserConfig: { summaryStyle: FCA_STYLE, additionalInstructions: 'Prefer ADL evidence.' },
        },
    }

    const config = __testOnly.getScribeConfig({ scribeConfig: { summaryStyle: FCA_STYLE } }, metadata)

    assert.equal(config.summaryStyle, FCA_STYLE)
    assert.equal(config.additionalInstructions, 'Prefer ADL evidence.')
    assert.match(config.workerPrompt, /Functional Capacity Assessment/)

    // Without a saved FCA config the participant's generic scribe config still supplies settings,
    // but the FCA prompt must not be lost.
    const fallback = __testOnly.getScribeConfig(
        { scribeConfig: { summaryStyle: FCA_STYLE } },
        { patientAgents: { scribeConfig: { includeActionItems: false } } }
    )

    assert.equal(fallback.summaryStyle, FCA_STYLE)
    assert.equal(fallback.includeActionItems, false)
    assert.match(fallback.workerPrompt, /Functional Capacity Assessment/)
})

test('the explicit per-job style beats the participant saved default', () => {
    // Guards the deferral trap: a job that requests the FCA style must not regenerate the saved
    // default style, or the requesting report job waits forever for a summary it will never see.
    const metadata = {
        patientAgents: { scribeConfig: { summaryStyle: 'topic-bullets-third-person' } },
    }

    const config = __testOnly.getScribeConfig({ scribeConfig: { summaryStyle: FCA_STYLE } }, metadata)

    assert.equal(config.summaryStyle, FCA_STYLE)
})

test('the FCA style is gated by the scribe agent, not the HSR summariser', () => {
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { scribe: true } }, FCA_STYLE), true)
    assert.equal(__testOnly.isScribeAgentEnabled({ patientAgents: { hsrSummariser: true } }, FCA_STYLE), false)
})

test('the summary fingerprint separates the FCA style from the generic style', () => {
    const base = { transcriptText: FCA_TRANSCRIPT, aiUsage: { model: 'gpt-4.1-mini' } }

    const generic = __testOnly.buildSummaryGenerationFingerprint({
        ...base,
        scribeConfig: { summaryStyle: 'topic-bullets-third-person' },
    })
    const fca = __testOnly.buildSummaryGenerationFingerprint({
        ...base,
        scribeConfig: { summaryStyle: FCA_STYLE },
    })

    assert.notEqual(generic, fca)
})
