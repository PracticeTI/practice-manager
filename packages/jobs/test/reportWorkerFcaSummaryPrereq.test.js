import test from 'node:test'
import assert from 'node:assert/strict'
import { __testOnly } from '../src/jobs/reportWorker.js'

const FCA_STYLE = 'fca-functional-capacity'

function transcript(id, overrides = {}) {
    return {
        id,
        transcript_text: 'Transcript body.',
        transcript_summary_text: '',
        transcript_otf10_summary_text: '',
        transcript_fca_summary_text: '',
        ...overrides,
    }
}

test('summary rows are split by style, not merged into one field', () => {
    const rows = __testOnly.enrichTranscriptsWithSummaries(
        [transcript(33)],
        [
            { transcription_id: 33, summary_style: 'topic-bullets-third-person', summary_text: 'GENERIC', summary_payload_json: { structuredEvidenceFacts: [{ domain: 'fatigue' }] } },
            { transcription_id: 33, summary_style: 'otf10-home-services', summary_text: 'OTF10' },
            { transcription_id: 33, summary_style: FCA_STYLE, summary_text: 'FCA', summary_payload_json: { structuredEvidenceFacts: [{ domain: 'adl-personal-care' }] } },
        ]
    )

    assert.equal(rows[0].transcript_summary_text, 'GENERIC')
    assert.equal(rows[0].transcript_otf10_summary_text, 'OTF10')
    assert.equal(rows[0].transcript_fca_summary_text, 'FCA')
    assert.deepEqual(rows[0].transcript_summary_payload, { structuredEvidenceFacts: [{ domain: 'fatigue' }] })
    assert.deepEqual(rows[0].transcript_fca_summary_payload, { structuredEvidenceFacts: [{ domain: 'adl-personal-care' }] })
})

test('each style reads its own field when deciding which transcripts lack a summary', () => {
    // Regression guard: mapping a style to the wrong field reports "nothing missing" while the
    // report keeps deferring, because the enqueue never requests the summary it is waiting for.
    const transcripts = [
        transcript(33, { transcript_summary_text: 'GENERIC ONLY' }),
        transcript(34, { transcript_summary_text: 'GENERIC ONLY', transcript_otf10_summary_text: 'OTF10 ONLY' }),
        transcript(35, { transcript_summary_text: 'GENERIC ONLY', transcript_fca_summary_text: 'FCA ONLY' }),
    ]

    assert.deepEqual(__testOnly.resolveMissingSummaryTranscriptionIds(transcripts, null), [])
    assert.deepEqual(__testOnly.resolveMissingSummaryTranscriptionIds(transcripts, 'topic-bullets-third-person'), [])
    assert.deepEqual(__testOnly.resolveMissingSummaryTranscriptionIds(transcripts, 'otf10-home-services'), [33, 35])
    assert.deepEqual(__testOnly.resolveMissingSummaryTranscriptionIds(transcripts, FCA_STYLE), [33, 34])
})

test('transcripts without body text are never queued for summarising', () => {
    const transcripts = [transcript(33, { transcript_text: '   ' })]
    assert.deepEqual(__testOnly.resolveMissingSummaryTranscriptionIds(transcripts, FCA_STYLE), [])
})

test('the FCA gap list honours builder exclusions and clinician overrides', () => {
    const transcripts = [
        transcript(33),
        transcript(34),
        transcript(35, { transcript_fca_summary_text: 'FCA SUMMARY' }),
    ]

    // 33 and 34 have no FCA summary; 35 does.
    assert.deepEqual(
        __testOnly.findTranscriptsMissingFcaSummary(transcripts, null).map((item) => item.id),
        [33, 34]
    )

    assert.deepEqual(
        __testOnly.findTranscriptsMissingFcaSummary(transcripts, {
            transcriptSelection: { excludedIds: [33], summaryOverrides: {} },
        }).map((item) => item.id),
        [34]
    )

    assert.deepEqual(
        __testOnly.findTranscriptsMissingFcaSummary(transcripts, {
            transcriptSelection: { excludedIds: [33], summaryOverrides: { 34: 'Clinician written summary.' } },
        }),
        []
    )
})

test('builder overrides match numeric ids against string selection keys', () => {
    const transcripts = [transcript(34)]

    assert.deepEqual(
        __testOnly.findTranscriptsMissingFcaSummary(transcripts, {
            transcriptSelection: { excludedIds: [], summaryOverrides: { 34: 'Written by the clinician.' } },
        }),
        []
    )
})
