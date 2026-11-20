import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFcaEvidenceMap, resolveTranscriptSelection } from '../src/jobs/fcaReportGeneration.js'

const FCA_FACT = {
    domain: 'adl-personal-care',
    observedIssue: 'Needs seated setup to shower safely when fatigued.',
    functionalImpact: 'Showering becomes unsafe without supervision on high-fatigue days.',
    supportImplication: 'Personal care support is indicated for showering.',
}

const GENERIC_FACT = {
    domain: 'fatigue',
    observedIssue: 'Endurance drops after morning routines.',
    functionalImpact: 'Capacity fluctuates across the day.',
    supportImplication: 'Pacing supports are required.',
}

function transcript(id, overrides = {}) {
    return {
        id,
        transcript_text: 'Raw transcript text that must never be injected.',
        transcript_summary_text: '',
        transcript_fca_summary_text: '',
        transcript_summary_payload: {},
        transcript_fca_summary_payload: {},
        ...overrides,
    }
}

test('prefers the FCA-style summary over the generic one', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            transcript(33, {
                transcript_summary_text: 'GENERIC SUMMARY TEXT',
                transcript_fca_summary_text: 'FCA SUMMARY TEXT',
            }),
        ],
        additionalContext: '',
        builderFormData: null,
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'stored-transcript-summary')
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('uses FCA structured facts when the generic payload is the only other option', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            transcript(33, {
                transcript_fca_summary_payload: { structuredEvidenceFacts: [FCA_FACT] },
                transcript_summary_payload: { structuredEvidenceFacts: [GENERIC_FACT] },
            }),
        ],
        additionalContext: '',
        builderFormData: null,
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'stored-transcript-structured-evidence')
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('an excluded transcript contributes no evidence at all', () => {
    const included = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            transcript(33, {
                transcript_fca_summary_text: 'Kept evidence about toileting transfers.',
                transcript_fca_summary_payload: { structuredEvidenceFacts: [FCA_FACT] },
            }),
        ],
        additionalContext: '',
        builderFormData: null,
    })

    const excluded = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            transcript(33, {
                transcript_fca_summary_text: 'Kept evidence about toileting transfers.',
                // An exclusion must also suppress the structured facts, not just the summary text.
                transcript_fca_summary_payload: { structuredEvidenceFacts: [FCA_FACT] },
            }),
        ],
        additionalContext: '',
        builderFormData: { transcriptSelection: { excludedIds: [33], summaryOverrides: {} } },
    })

    assert.ok(included.sourceTextLength > 0)
    assert.equal(excluded.sourceTextLength, 0)
    assert.equal(excluded.transcriptEvidenceSource, 'none')
})

test('an exclusion matches whichever id type the builder used', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [transcript(33, { transcript_fca_summary_text: 'Kept evidence.' })],
        additionalContext: '',
        builderFormData: { transcriptSelection: { excludedIds: ['33'], summaryOverrides: {} } },
    })

    assert.equal(evidenceMap.sourceTextLength, 0)
})

test('a per-transcript override replaces only that transcript and keeps the others', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            transcript(33, { transcript_fca_summary_text: 'Summary for transcript 33.' }),
            transcript(34, { transcript_fca_summary_text: 'Summary for transcript 34.' }),
        ],
        additionalContext: '',
        builderFormData: {
            transcriptSelection: {
                excludedIds: [],
                summaryOverrides: { 34: 'Clinician rewrite for transcript 34.' },
            },
        },
    })

    // The unedited transcript still contributes, so the source is a combination rather than a
    // wholesale replacement (the previous behaviour dropped every other transcript).
    assert.equal(
        evidenceMap.transcriptEvidenceSource,
        'builder-edited-summary+stored-transcript-summary'
    )
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('resolveTranscriptSelection tolerates malformed input and blank overrides', () => {
    for (const input of [null, undefined, 'nope', 42, []]) {
        const selection = resolveTranscriptSelection(input)
        assert.equal(selection.excludedIds.size, 0)
        assert.equal(selection.summaryOverrides.size, 0)
    }

    const selection = resolveTranscriptSelection({
        transcriptSelection: {
            excludedIds: [33, '34', '', null],
            summaryOverrides: { 35: '  Text  ', 36: '   ' },
        },
    })

    assert.deepEqual([...selection.excludedIds], ['33', '34'])
    assert.deepEqual([...selection.summaryOverrides.keys()], ['35'])
    // The worker normalises evidence text, so surrounding whitespace does not survive.
    assert.equal(selection.summaryOverrides.get('35'), 'Text')
})
