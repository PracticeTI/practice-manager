// Tests for worker provenance + the review queue.
//
// The behaviour that matters: a record is "awaiting review" only while it is
// still in the state the worker left it in, and "reviewed" is read from the
// record's *existing* lifecycle (a quote leaving draft, a suggestion being
// sourced) — never from a parallel flag that could disagree with it.
//
// Run with: node --test test/workerReviewQueue.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    PROVENANCE_IMPORTED,
    PROVENANCE_NONE,
    PROVENANCE_WORKER_ASSISTED,
    PROVENANCE_WORKER_DRAFT,
    describeQuoteProvenanceBadge,
    isUnreviewedReportJob,
    isUnreviewedWorkerQuote,
    resolveQuoteProvenance,
    selectLatestReportJob,
    selectUnreviewedReportJob,
} from '../src/lib/workerProvenance.js'
import {
    WORKERS_WITHOUT_A_REVIEW_SIGNAL,
    buildWorkerReviewItems,
    selectUnsourcedEquipmentSuggestions,
    summarizeWorkerReviewItems,
} from '../src/lib/workerReviewQueue.js'

const workerDraftQuote = (overrides = {}) => ({
    id: 10,
    quote_number: 'QTE-0001',
    status: 'draft',
    external_id: '21',
    external_source: 'quote-writer',
    created_at: '2026-09-29T04:00:00.000Z',
    ...overrides,
})

const completedReportJob = (overrides = {}) => ({
    id: 44,
    patientId: 9,
    patientName: 'Avery Sample',
    eventType: 'hsr_creator_enabled',
    status: 'completed',
    reviewedAt: null,
    completedAt: '2026-10-14T02:00:00.000Z',
    createdAt: '2026-10-14T01:00:00.000Z',
    ...overrides,
})

test('a worker draft quote is unreviewed until it leaves draft', () => {
    assert.equal(isUnreviewedWorkerQuote(workerDraftQuote()), true)
    assert.equal(isUnreviewedWorkerQuote(workerDraftQuote({ status: 'sent' })), false)
    assert.equal(isUnreviewedWorkerQuote(workerDraftQuote({ status: 'accepted' })), false)
    assert.equal(isUnreviewedWorkerQuote(workerDraftQuote({ status: 'declined' })), false)

    // Not the worker's document at all.
    assert.equal(isUnreviewedWorkerQuote({ status: 'draft' }), false)
    assert.equal(isUnreviewedWorkerQuote({ status: 'draft', external_source: 'splose' }), false)
    assert.equal(isUnreviewedWorkerQuote(null), false)
})

test('provenance distinguishes worker draft, worker-assisted, imported and none', () => {
    assert.equal(resolveQuoteProvenance(workerDraftQuote()), PROVENANCE_WORKER_DRAFT)
    assert.equal(resolveQuoteProvenance(workerDraftQuote({ status: 'sent' })), PROVENANCE_WORKER_ASSISTED)
    assert.equal(resolveQuoteProvenance({ external_id: 'ABC-1', external_source: 'splose' }), PROVENANCE_IMPORTED)
    assert.equal(resolveQuoteProvenance({ id: 4, status: 'draft' }), PROVENANCE_NONE)

    // A quote whose external_source was not carried but whose metadata records the
    // origin is still recognised as the worker's.
    assert.equal(
        resolveQuoteProvenance({ status: 'draft', metadata: { origin: 'quote-writer' } }),
        PROVENANCE_WORKER_DRAFT
    )
})

test('the badge copy comes from one place', () => {
    assert.equal(describeQuoteProvenanceBadge(workerDraftQuote()).label, 'Worker draft')
    assert.equal(describeQuoteProvenanceBadge(workerDraftQuote({ status: 'sent' })).label, 'Worker-assisted')
    assert.equal(describeQuoteProvenanceBadge({ external_id: 'X', external_source: 'splose' }).label, 'Imported')
    assert.equal(describeQuoteProvenanceBadge({ id: 1, status: 'draft' }), null)
})

test('an unsourced equipment suggestion is the only kind that is waiting on a person', () => {
    const suggestions = [
        { equipmentType: 'Hoist', sourcingStatus: 'unsourced' },
        { equipmentType: 'Ramp', sourcingStatus: 'quote_requested' },
        { equipmentType: 'Chair', sourcingStatus: 'quote_received' },
        { equipmentType: 'Missing status' },
    ]

    const selected = selectUnsourcedEquipmentSuggestions(suggestions)
    assert.equal(selected.length, 2)
    assert.deepEqual(selected.map((s) => s.equipmentType), ['Hoist', 'Missing status'])
})

test('the queue lists a worker draft quote with its number', () => {
    const items = buildWorkerReviewItems({ quotes: [workerDraftQuote()] })

    assert.equal(items.length, 1)
    assert.equal(items[0].kind, 'quotes')
    assert.equal(items[0].tab, 'quotes')
    assert.equal(items[0].workerLabel, 'Quote Writer')
    assert.equal(items[0].count, 1)
    assert.equal(items[0].title, 'Quote QTE-0001 needs review')
    assert.match(items[0].detail, /Check the supports and the price limits/)
    assert.equal(items[0].actionLabel, 'Review quote')
    assert.equal(items[0].oldestCreatedAt, '2026-09-29T04:00:00.000Z')
})

test('several worker drafts become one counted entry', () => {
    const items = buildWorkerReviewItems({
        quotes: [
            workerDraftQuote({ id: 10, quote_number: 'QTE-0001' }),
            workerDraftQuote({ id: 11, quote_number: 'QTE-0002' }),
        ],
    })

    assert.equal(items.length, 1)
    assert.equal(items[0].count, 2)
    assert.equal(items[0].title, '2 quotes need review')
})

test('quotes a person has already actioned leave the queue', () => {
    const items = buildWorkerReviewItems({
        quotes: [
            workerDraftQuote({ id: 10, status: 'sent' }),
            workerDraftQuote({ id: 11, status: 'accepted' }),
            { id: 12, status: 'draft', quote_number: 'QTE-0003' },
        ],
    })

    assert.equal(items.length, 0)
})

test('unsourced equipment suggestions become one counted entry', () => {
    const items = buildWorkerReviewItems({
        equipmentSuggestions: [{ sourcingStatus: 'unsourced' }, { sourcingStatus: 'unsourced' }, { sourcingStatus: 'quote_received' }],
    })

    assert.equal(items.length, 1)
    assert.equal(items[0].kind, 'equipment')
    assert.equal(items[0].tab, 'equipment')
    assert.equal(items[0].workerLabel, 'Equipment Sourcer')
    assert.equal(items[0].count, 2)
    assert.equal(items[0].title, '2 equipment suggestions to source')
    assert.equal(items[0].actionLabel, 'Review equipment')
})

test('quotes are listed before equipment', () => {
    const items = buildWorkerReviewItems({
        quotes: [workerDraftQuote()],
        equipmentSuggestions: [{ sourcingStatus: 'unsourced' }],
    })

    assert.deepEqual(items.map((item) => item.kind), ['quotes', 'equipment'])
})

test('an entry is dropped when its destination tab is not on screen', () => {
    const withAll = {
        quotes: [workerDraftQuote()],
        equipmentSuggestions: [{ sourcingStatus: 'unsourced' }],
        reportJobs: [completedReportJob()],
    }

    const noEquipmentTab = buildWorkerReviewItems({ ...withAll, tabAvailability: { equipment: false } })
    assert.deepEqual(noEquipmentTab.map((item) => item.kind), ['quotes', 'report'])

    const noReportTab = buildWorkerReviewItems({ ...withAll, tabAvailability: { report: false } })
    assert.deepEqual(noReportTab.map((item) => item.kind), ['quotes', 'equipment'])

    const neither = buildWorkerReviewItems({
        ...withAll,
        tabAvailability: { quotes: false, equipment: false, report: false },
    })
    assert.equal(neither.length, 0)
})

test('the queue tolerates junk input instead of throwing', () => {
    assert.deepEqual(buildWorkerReviewItems(), [])
    assert.deepEqual(buildWorkerReviewItems({ quotes: null, equipmentSuggestions: 'nope' }), [])
    assert.deepEqual(buildWorkerReviewItems({ quotes: [null, undefined, {}, { status: 'draft' }] }), [])
    assert.deepEqual(buildWorkerReviewItems({ reportJobs: [null, {}, { status: 'completed' }] }), [])
})

test('the summary reads as one sentence for the section header', () => {
    assert.equal(summarizeWorkerReviewItems([]).summaryText, 'Nothing from your agents is waiting on review.')

    const one = summarizeWorkerReviewItems([{ count: 1 }])
    assert.equal(one.total, 1)
    assert.equal(one.summaryText, '1 item from your agents is waiting on review.')

    const many = summarizeWorkerReviewItems([{ count: 1 }, { count: 2 }])
    assert.equal(many.itemCount, 2)
    assert.equal(many.total, 3)
    assert.equal(many.summaryText, '3 items from your agents are waiting on review.')
})

test('workers without a review signal are named, not silently omitted', () => {
    // Reporting left this list by gaining a review signal — opening the report writes
    // `reviewed_at` on the job — so only these two are still unreported by the queue.
    assert.deepEqual(WORKERS_WITHOUT_A_REVIEW_SIGNAL, ['analyst', 'scribe'])
})

test('a report job waits for review only once it is finished and unopened', () => {
    assert.equal(isUnreviewedReportJob(completedReportJob()), true)
    // `reviewed_at` from the API is camelCase; the column is snake_case.
    assert.equal(isUnreviewedReportJob(completedReportJob({ reviewed_at: null })), true)
    assert.equal(isUnreviewedReportJob(completedReportJob({ reviewedAt: '2026-10-14T03:00:00.000Z' })), false)

    // Nothing to read while the run is in flight, and a failed run never landed.
    assert.equal(isUnreviewedReportJob(completedReportJob({ status: 'queued' })), false)
    assert.equal(isUnreviewedReportJob(completedReportJob({ status: 'processing' })), false)
    assert.equal(isUnreviewedReportJob(completedReportJob({ status: 'failed' })), false)

    assert.equal(isUnreviewedReportJob(null), false)
    assert.equal(isUnreviewedReportJob({ status: 'completed' }), true)
})

test('only the newest run decides whether a report is waiting', () => {
    const reviewed = completedReportJob({ id: 40, reviewedAt: '2026-10-13T03:00:00.000Z' })
    const unreviewed = completedReportJob({ id: 44 })

    // Newest wins, so an older reviewed run cannot mask a fresh report.
    assert.equal(selectLatestReportJob([reviewed, unreviewed]).id, 44)
    assert.equal(selectUnreviewedReportJob([reviewed, unreviewed]).id, 44)

    // A run still in flight supersedes the report already on the record: a newer one
    // is on its way, so the previous report is no longer what is waiting.
    const queued = completedReportJob({ id: 45, status: 'queued', reviewedAt: null })
    assert.equal(selectUnreviewedReportJob([unreviewed, queued]), null)

    assert.equal(selectLatestReportJob([]), null)
    assert.equal(selectUnreviewedReportJob(null), null)
})

test('a finished report becomes one entry that names the agent that wrote it', () => {
    const items = buildWorkerReviewItems({ reportJobs: [completedReportJob()] })

    assert.equal(items.length, 1)
    assert.equal(items[0].kind, 'report')
    assert.equal(items[0].tab, 'report')
    assert.equal(items[0].workerLabel, 'HSR Writer')
    assert.equal(items[0].count, 1)
    assert.equal(items[0].title, 'Report ready to review')
    assert.equal(items[0].actionLabel, 'Review report')
    assert.equal(items[0].reportJobId, 44)
    // Aged from when the report landed, not from when the run was requested.
    assert.equal(items[0].oldestCreatedAt, '2026-10-14T02:00:00.000Z')

    // The reporting worker is the practice's FCA Builder.
    const [fca] = buildWorkerReviewItems({
        reportJobs: [completedReportJob({ eventType: 'reporting_enabled' })],
    })
    assert.equal(fca.workerLabel, 'FCA Builder')
    assert.equal(fca.workerKey, 'reporting')
})

test('a report a person has opened leaves the queue', () => {
    assert.deepEqual(buildWorkerReviewItems({
        reportJobs: [completedReportJob({ reviewedAt: '2026-10-14T03:00:00.000Z' })],
    }), [])
})

test('reports follow quotes and equipment', () => {
    const items = buildWorkerReviewItems({
        quotes: [workerDraftQuote()],
        equipmentSuggestions: [{ sourcingStatus: 'unsourced' }],
        reportJobs: [completedReportJob()],
    })

    assert.deepEqual(items.map((item) => item.kind), ['quotes', 'equipment', 'report'])
})
