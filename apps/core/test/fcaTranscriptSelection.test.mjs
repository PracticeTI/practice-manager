import test from 'node:test'
import assert from 'node:assert/strict'
import {
    FCA_SUMMARY_STYLE,
    buildTranscriptRows,
    findTranscriptsMissingEvidence,
    isTranscriptIncluded,
    normalizeTranscriptSelection,
    setTranscriptIncluded,
    setTranscriptSummaryOverride,
    setTranscriptsIncluded,
} from '../src/lib/fcaTranscriptSelection.js'

// The worker reads this shape in two/src/lib/jobs/fcaReportGeneration.js.
function workerShape(selection) {
    const normalized = normalizeTranscriptSelection(selection)
    return {
        excludedIds: normalized.excludedIds,
        summaryOverrides: normalized.summaryOverrides,
    }
}

const TRANSCRIPTS = [
    { id: 33, title: 'note-recording-010926-140222.webm', status: 'completed', updated_at: '2026-09-15T04:43:47.127Z' },
    { id: 34, title: 'note-recording-060826-142220.webm', status: 'completed', updated_at: '2026-09-15T04:44:56.150Z' },
    { id: 35, title: 'note-recording-270726-122723.webm', status: 'completed', updated_at: '2026-09-15T04:54:44.250Z' },
]

const SUMMARIES = [
    { id: 30, transcriptionId: 33, summaryStyle: FCA_SUMMARY_STYLE, summaryText: '- Personal Care\n  Evidence: Needs seated setup.' },
    { id: 31, transcriptionId: 35, summaryStyle: FCA_SUMMARY_STYLE, summaryText: '- Domestic Function\n  Evidence: Pacing limits cleaning.' },
    // A generic summary must not be mistaken for an FCA one.
    { id: 32, transcriptionId: 34, summaryStyle: 'topic-bullets-third-person', summaryText: 'Generic topic bullets.' },
]

test('normalizes a transcript selection and drops blank overrides', () => {
    const selection = normalizeTranscriptSelection({
        excludedIds: [34, '34', '', null],
        summaryOverrides: { 33: '  Kept  ', 34: '   ', 35: null },
    })

    assert.deepEqual(selection.excludedIds, ['34'])
    assert.deepEqual(Object.keys(selection.summaryOverrides), ['33'])
    assert.equal(selection.summaryOverrides['33'], '  Kept  ')
})

test('normalizes malformed selections to an empty selection', () => {
    for (const input of [null, undefined, 'nope', 42, []]) {
        const selection = normalizeTranscriptSelection(input)
        assert.deepEqual(selection.excludedIds, [])
        assert.deepEqual(selection.summaryOverrides, {})
    }
})

test('include and exclude toggles round-trip through the worker shape', () => {
    let selection = normalizeTranscriptSelection(null)
    assert.equal(isTranscriptIncluded(selection, 34), true)

    selection = setTranscriptIncluded(selection, 34, false)
    assert.equal(isTranscriptIncluded(selection, 34), false)
    assert.deepEqual(workerShape(selection).excludedIds, ['34'])

    selection = setTranscriptIncluded(selection, 34, true)
    assert.equal(isTranscriptIncluded(selection, 34), true)
    assert.deepEqual(workerShape(selection).excludedIds, [])
})

test('selection tolerates numeric and string ids interchangeably', () => {
    const selection = setTranscriptIncluded({ excludedIds: ['34'] }, 34, true)
    assert.deepEqual(selection.excludedIds, [])
    assert.equal(isTranscriptIncluded(selection, '34'), true)
})

test('setting an override to blank removes it rather than sending empty evidence', () => {
    let selection = setTranscriptSummaryOverride(null, 33, 'Edited text')
    assert.equal(selection.summaryOverrides['33'], 'Edited text')

    selection = setTranscriptSummaryOverride(selection, 33, '   ')
    assert.deepEqual(selection.summaryOverrides, {})
})

test('select all and clear all operate across every row', () => {
    const ids = TRANSCRIPTS.map((item) => item.id)

    let selection = setTranscriptsIncluded(null, ids, false)
    assert.deepEqual(workerShape(selection).excludedIds, ['33', '34', '35'])

    selection = setTranscriptsIncluded(selection, [33, 35], true)
    assert.deepEqual(workerShape(selection).excludedIds, ['34'])
})

test('rows only pick up FCA-style summaries and expose the unedited text separately', () => {
    const rows = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: SUMMARIES, fca: null, selection: null })
    const byId = new Map(rows.map((row) => [row.id, row]))

    assert.equal(byId.get('33').hasSummary, true)
    assert.equal(byId.get('33').storedText, '- Personal Care\n  Evidence: Needs seated setup.')
    // Transcript 34 only has a generic summary, so it must read as not ready.
    assert.equal(byId.get('34').hasSummary, false)
    assert.equal(byId.get('34').summaryStatus, 'missing')
    assert.equal(byId.get('35').hasSummary, true)
})

test('an override wins over the stored summary but the stored text is preserved', () => {
    const selection = setTranscriptSummaryOverride(null, 33, 'Clinician rewritten summary')
    const rows = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: SUMMARIES, fca: null, selection })
    const row = rows.find((item) => item.id === '33')

    assert.equal(row.summaryText, 'Clinician rewritten summary')
    assert.equal(row.storedText, '- Personal Care\n  Evidence: Needs seated setup.')
    assert.equal(row.isEdited, true)
})

test('rows report queue status while summaries are being prepared', () => {
    const fca = {
        style: FCA_SUMMARY_STYLE,
        transcripts: [
            { transcriptionId: 34, hasSummary: false, queueStatus: 'processing' },
            { transcriptionId: 35, hasSummary: false, queueStatus: 'queued' },
        ],
        readyCount: 1,
        pendingCount: 2,
    }

    const rows = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: SUMMARIES, fca, selection: null })
    const byId = new Map(rows.map((row) => [row.id, row]))

    assert.equal(byId.get('34').summaryStatus, 'processing')
    // A stored summary wins over a stale queued job: the row is ready either way.
    assert.equal(byId.get('35').summaryStatus, 'ready')
    assert.equal(byId.get('35').hasSummary, true)
    assert.equal(byId.get('33').summaryStatus, 'ready')
})

test('a transcript with no stored summary and no job reads as missing', () => {
    const rows = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: SUMMARIES, fca: null, selection: null })
    const row = rows.find((item) => item.id === '34')

    assert.equal(row.summaryStatus, 'missing')
    assert.equal(row.summaryStatusLabel, 'No FCA summary yet')
})

test('a failed summary job surfaces its error text', () => {
    const fca = {
        transcripts: [{ transcriptionId: 34, hasSummary: false, queueStatus: 'failed', queueError: 'Transcript has no text to summarize' }],
    }

    const rows = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: [], fca, selection: null })
    const row = rows.find((item) => item.id === '34')

    assert.equal(row.summaryStatus, 'failed')
    assert.match(row.summaryStatusLabel, /has no text to summarize/)
})

test('missing evidence ignores excluded transcripts and honours overrides', () => {
    const base = buildTranscriptRows({ transcripts: TRANSCRIPTS, summaries: SUMMARIES, fca: null, selection: null })
    // 34 has no FCA summary, so it is the only gap.
    assert.deepEqual(findTranscriptsMissingEvidence(base).map((row) => row.id), ['34'])

    const excluded = buildTranscriptRows({
        transcripts: TRANSCRIPTS,
        summaries: SUMMARIES,
        fca: null,
        selection: setTranscriptIncluded(null, 34, false),
    })
    assert.deepEqual(findTranscriptsMissingEvidence(excluded), [])

    const overridden = buildTranscriptRows({
        transcripts: TRANSCRIPTS,
        summaries: SUMMARIES,
        fca: null,
        selection: setTranscriptSummaryOverride(null, 34, 'Written by the clinician'),
    })
    assert.deepEqual(findTranscriptsMissingEvidence(overridden), [])
})

test('recordings are labelled by consultation date, never by filename', () => {
    const rows = buildTranscriptRows({
        transcripts: [{ id: 35, title: 'note-recording-270726-122723.webm', status: 'completed' }],
        summaries: [],
        fca: null,
        selection: null,
    })

    // The month name is ICU-dependent (`July` in node, `Jul`/`Sept` in browsers), so assert the
    // shape rather than an exact string.
    assert.match(rows[0].title, /^Consultation — 27 \S+ 2026$/)
    assert.equal(rows[0].timeLabel, '12:27 pm')
    assert.doesNotMatch(rows[0].title, /webm/i)
    assert.doesNotMatch(rows[0].title, /recording/i)
})

test('an impossible date in a recording filename falls back instead of inventing a date', () => {
    // 27th month is not a date, so the parser must reject it and use the record timestamp.
    const rows = buildTranscriptRows({
        transcripts: [{ id: 41, title: 'note-recording-992799-120000.webm', updated_at: '2026-08-04T02:00:00.000Z' }],
        summaries: [],
        fca: null,
        selection: null,
    })

    assert.match(rows[0].title, /^Consultation — /)
    assert.doesNotMatch(rows[0].title, /99/)
    assert.equal(rows[0].timeLabel, '')
})

test('a transcript with no title and no usable date gets a positional label', () => {
    const rows = buildTranscriptRows({
        transcripts: [{ id: 41, title: '' }, { id: 42, title: null }],
        summaries: [],
        fca: null,
        selection: null,
    })

    assert.equal(rows[0].title, 'Transcript 1')
    assert.equal(rows[1].title, 'Transcript 2')
})

test('a human title is kept as-is and dated from the record', () => {
    const rows = buildTranscriptRows({
        transcripts: [{ id: 23, title: 'Initial OT Assessment - Amelia Brooks', updated_at: '2026-08-04T02:00:00.000Z' }],
        summaries: [],
        fca: null,
        selection: null,
    })

    assert.equal(rows[0].title, 'Initial OT Assessment - Amelia Brooks')
    assert.equal(rows[0].timeLabel, '')
    assert.match(rows[0].dateLabel, /2026/)
})
