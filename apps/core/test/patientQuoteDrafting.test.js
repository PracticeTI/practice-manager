// Tests for the Quote Writer's shared drafting logic.
//
// The rules that matter are the safety ones: a line the model proposes is only
// kept when its support item number resolves in the curated NDIS catalogue, and
// its price comes from the published limit rather than from the model. These
// tests pin both, plus the config/header defaults the API and the panel share.
//
// Run with: node --test test/patientQuoteDrafting.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_QUOTE_WRITER_AGENT_CONFIG,
    QUOTE_WRITER_MAX_LINES,
    buildQuoteCatalogueBlock,
    buildQuoteDraftEvidence,
    buildQuoteDraftHeader,
    buildQuoteDraftMessages,
    buildQuoteDraftNotes,
    buildQuoteItemMetadata,
    buildQuoteMetadata,
    isQuoteWriterEnabled,
    normalizeQuoteDraftLine,
    normalizeQuoteDraftResponse,
    normalizeQuoteWriterConfig,
    quoteWriterConfigSignature,
    summarizeQuoteDraft,
} from '../src/lib/patientQuoteDrafting.js'

// Verified against the 2026-27 NDIS pricing schedule in ndisSupportCatalogue.js.
const OT_DIRECT_SERVICE = '15_617_0128_1_3'
const OT_DIRECT_SERVICE_NATIONAL = 193.99
const OT_DIRECT_SERVICE_REMOTE = 271.59
const CEILING_HOIST = '06_123615401_0111_2_2'

test('catalogue block lists support items with the selected region prices', () => {
    const national = buildQuoteCatalogueBlock('national')
    assert.match(national, /15_617_0128_1_3 \| Therapy - Occupational Therapist - Direct Service \| H \| \$193\.99/)

    const remote = buildQuoteCatalogueBlock('remote')
    assert.match(remote, /15_617_0128_1_3 \| .* \| H \| \$271\.59/)
    assert.match(remote, /region: remote/)

    // A quoted support has no published limit, so the model is told so.
    assert.match(national, /06_123615401_0111_2_2 \| .* \| E \| Quote required/)
})

test('a proposed line is priced at the published limit for the region', () => {
    const { line } = normalizeQuoteDraftLine(
        { support_item_number: OT_DIRECT_SERVICE, quantity: 8, description: 'Eight hours of OT' },
        { pricingRegion: 'national' }
    )

    assert.equal(line.ndis_support_item_number, OT_DIRECT_SERVICE)
    assert.equal(line.unit, 'H')
    assert.equal(line.quantity, 8)
    assert.equal(line.unit_price, OT_DIRECT_SERVICE_NATIONAL)
    assert.equal(line.price_limit, OT_DIRECT_SERVICE_NATIONAL)
    assert.equal(line.quote_required, false)
    assert.equal(line.registration_group_number, '0128')
    assert.equal(line.support_category_name, 'Improved Daily Living Skills')
})

test('the same line is priced differently in another region', () => {
    const { line } = normalizeQuoteDraftLine(
        { support_item_number: OT_DIRECT_SERVICE, quantity: 1 },
        { pricingRegion: 'remote' }
    )
    assert.equal(line.unit_price, OT_DIRECT_SERVICE_REMOTE)
    assert.equal(line.price_limit, OT_DIRECT_SERVICE_REMOTE)
})

test('a quoted support keeps a null limit and a zero price', () => {
    const { line } = normalizeQuoteDraftLine(
        { support_item_number: CEILING_HOIST, quantity: 1 },
        { pricingRegion: 'national' }
    )
    assert.equal(line.quote_required, true)
    assert.equal(line.price_limit, null)
    assert.equal(line.unit_price, 0)
})

test('a support item number the catalogue does not know is dropped, never stored', () => {
    const result = normalizeQuoteDraftLine({ support_item_number: '99_999_9999_9_9', quantity: 2 })
    assert.equal(result.line, null)
    assert.equal(result.reason, 'unknown-support-item')
})

test('a non-positive quantity is rejected', () => {
    assert.equal(normalizeQuoteDraftLine({ support_item_number: OT_DIRECT_SERVICE, quantity: 0 }).reason, 'invalid-quantity')
    assert.equal(normalizeQuoteDraftLine({ support_item_number: OT_DIRECT_SERVICE, quantity: 'lots' }).reason, 'invalid-quantity')

    // A blank quantity is not an error: the default of one unit is used.
    assert.equal(normalizeQuoteDraftLine({ support_item_number: OT_DIRECT_SERVICE }).line.quantity, 1)
})

test('the picker format the panel stores is accepted as well as a bare number', () => {
    const { line } = normalizeQuoteDraftLine({
        support_item_number: `${OT_DIRECT_SERVICE} — Therapy - Occupational Therapist - Direct Service`,
        quantity: 1,
    })
    assert.equal(line.ndis_support_item_number, OT_DIRECT_SERVICE)
})

test('normalizeQuoteDraftResponse reports what it dropped', () => {
    const draft = normalizeQuoteDraftResponse({
        summary: 'Eight hours of OT plus a hoist.',
        lines: [
            { support_item_number: OT_DIRECT_SERVICE, quantity: 8, description: 'OT' },
            { support_item_number: '99_999_9999_9_9', quantity: 1, description: 'Invented' },
            { support_item_number: OT_DIRECT_SERVICE, quantity: 8, description: 'OT' },
        ],
    })

    assert.equal(draft.proposedCount, 3)
    assert.equal(draft.lines.length, 1)
    assert.equal(draft.dropped.length, 2)
    assert.deepEqual(
        draft.dropped.map((entry) => entry.reason).sort(),
        ['duplicate', 'unknown-support-item']
    )
    assert.equal(draft.summary, 'Eight hours of OT plus a hoist.')
})

test('the draft never exceeds the line cap', () => {
    const lines = Array.from({ length: QUOTE_WRITER_MAX_LINES + 10 }, (unused, index) => ({
        support_item_number: OT_DIRECT_SERVICE,
        quantity: 1,
        description: `Line ${index}`,
    }))
    const draft = normalizeQuoteDraftResponse({ lines })
    assert.equal(draft.lines.length, QUOTE_WRITER_MAX_LINES)
})

test('a malformed model answer yields an empty draft rather than an error', () => {
    for (const payload of [null, undefined, 'nope', 42, {}, { lines: null }, { lines: 'nope' }]) {
        const draft = normalizeQuoteDraftResponse(payload)
        assert.equal(draft.lines.length, 0)
        assert.equal(draft.dropped.length, 0)
    }
})

test('normalizeQuoteWriterConfig defaults to national and includes every evidence source', () => {
    const config = normalizeQuoteWriterConfig(undefined)
    assert.equal(config.pricingRegion, DEFAULT_QUOTE_WRITER_AGENT_CONFIG.pricingRegion)
    assert.equal(config.includeTranscripts, true)
    assert.equal(config.includeReports, true)
    assert.equal(config.includeEquipment, true)
    assert.equal(config.additionalInstructions, '')
    assert.equal(config.workerPrompt, '')
})

test('normalizeQuoteWriterConfig falls back to national for an unknown region', () => {
    assert.equal(normalizeQuoteWriterConfig({ pricingRegion: 'mars' }).pricingRegion, 'national')
    assert.equal(normalizeQuoteWriterConfig({ pricingRegion: 'very_remote' }).pricingRegion, 'very_remote')
})

test('the config signature changes when a setting changes, and is stable otherwise', () => {
    const base = { patientAgents: { quoteWriter: true, quoteWriterConfig: { pricingRegion: 'remote' } } }
    const same = { patientAgents: { quoteWriter: true, quoteWriterConfig: { pricingRegion: 'remote' } } }
    const changed = { patientAgents: { quoteWriter: true, quoteWriterConfig: { pricingRegion: 'national' } } }
    const toggled = { patientAgents: { quoteWriter: true, quoteWriterConfig: { pricingRegion: 'remote', includeReports: false } } }

    assert.equal(quoteWriterConfigSignature(base), quoteWriterConfigSignature(same))
    assert.notEqual(quoteWriterConfigSignature(base), quoteWriterConfigSignature(changed))
    assert.notEqual(quoteWriterConfigSignature(base), quoteWriterConfigSignature(toggled))
})

test('isQuoteWriterEnabled accepts both the modern and legacy keys', () => {
    assert.equal(isQuoteWriterEnabled({ patientAgents: { quoteWriter: true } }), true)
    assert.equal(isQuoteWriterEnabled({ patientAgents: { quote_writer: true } }), true)
    assert.equal(isQuoteWriterEnabled({ agents: { quoteWriter: true } }), true)
    assert.equal(isQuoteWriterEnabled({ patientAgents: { quoteWriter: false } }), false)
    assert.equal(isQuoteWriterEnabled({ patientAgents: { billing: true } }), false)
    assert.equal(isQuoteWriterEnabled(null), false)
})

test('the draft header carries the participant snapshot and no GST', () => {
    const header = buildQuoteDraftHeader({
        fundingContext: { fundingType: 'ndis', referenceNumber: '430000000' },
        config: { pricingRegion: 'remote' },
        today: new Date('2026-09-29T00:00:00Z'),
    })

    assert.equal(header.status, 'draft')
    assert.equal(header.funding_type, 'ndis')
    assert.equal(header.pricing_region, 'remote')
    assert.equal(header.ndis_number, '430000000')
    assert.equal(header.quote_date, '2026-09-29')
    assert.equal(header.valid_until, '2026-10-29')
    assert.equal(header.gst_applicable, false)
    assert.equal(header.prepared_by, 'Quote Writer')
})

test('the header falls back to NDIS funding when the patient has no funding source', () => {
    const header = buildQuoteDraftHeader({ fundingContext: { fundingType: null }, today: new Date('2026-09-29T00:00:00Z') })
    assert.equal(header.funding_type, 'ndis')
    assert.equal(header.ndis_number, null)
})

test('evidence blocks are dropped when a source is switched off or empty', () => {
    const config = { includeTranscripts: true, includeReports: true, includeEquipment: true }
    const { sections } = buildQuoteDraftEvidence({
        patientName: 'Justin McAdam',
        fundingSource: 'NDIS',
        referenceLabel: 'NDIS participant number',
        referenceNumber: '430000000',
        notesText: 'Notes body',
        transcriptSummaries: 'Transcript body',
        reportMarkdown: 'Report body',
        equipmentSuggestions: 'Hoist',
        config,
    })

    const joined = sections.join('\n')
    assert.match(joined, /Participant details:/)
    assert.match(joined, /NDIS participant number: 430000000/)
    assert.match(joined, /Latest report:/)
    assert.match(joined, /Patient notes:/)
    assert.match(joined, /Transcript summaries:/)
    assert.match(joined, /Equipment recommendations:/)

    const trimmed = buildQuoteDraftEvidence({
        notesText: 'Notes body',
        transcriptSummaries: 'Transcript body',
        reportMarkdown: 'Report body',
        equipmentSuggestions: 'Hoist',
        config: { includeTranscripts: false, includeReports: false, includeEquipment: false },
    })
    const trimmedJoined = trimmed.sections.join('\n')
    assert.match(trimmedJoined, /Patient notes:/)
    assert.doesNotMatch(trimmedJoined, /Transcript summaries:/)
    assert.doesNotMatch(trimmedJoined, /Latest report:/)
    assert.doesNotMatch(trimmedJoined, /Equipment recommendations:/)
})

test('the drafting prompt carries the catalogue and the evidence', () => {
    const messages = buildQuoteDraftMessages({
        evidence: { sections: ['Patient notes:\nLives alone'] },
        config: { pricingRegion: 'national' },
        fundingSource: 'NDIS',
        subjectNoun: 'participant',
    })

    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'system')
    assert.match(messages[0].content, /NDIS quotes for an occupational therapy practice/)
    assert.match(messages[0].content, /Return valid JSON only/)

    assert.equal(messages[1].role, 'user')
    assert.match(messages[1].content, /refer to the person as "the participant"/)
    assert.match(messages[1].content, /Patient notes:/)
    assert.match(messages[1].content, /15_617_0128_1_3 \|/)
})

test('the drafting prompt never carries the patient name', () => {
    const messages = buildQuoteDraftMessages({
        evidence: { sections: [] },
        config: {},
        fundingSource: 'TAC',
        subjectNoun: 'patient',
    })

    assert.doesNotMatch(messages[1].content, /Participant:/)
    assert.match(messages[1].content, /refer to the person as "the patient"/)
    assert.match(messages[1].content, /No clinical evidence is available for this patient/)
})

test('a per-patient worker prompt replaces the built-in one', () => {
    const messages = buildQuoteDraftMessages({
        evidence: { sections: [] },
        config: { workerPrompt: 'Quote only home modifications.' },
    })

    assert.match(messages[0].content, /Quote only home modifications\./)
    assert.doesNotMatch(messages[0].content, /NDIS quotes for an occupational therapy practice/)
})

test('summarizeQuoteDraft totals the priced lines', () => {
    const summary = summarizeQuoteDraft([
        { quantity: 8, unit_price: OT_DIRECT_SERVICE_NATIONAL, price_limit: OT_DIRECT_SERVICE_NATIONAL },
        { quantity: 1, unit_price: 0, price_limit: null },
    ])

    assert.equal(summary.itemCount, 2)
    assert.equal(summary.subtotal, Math.round(8 * OT_DIRECT_SERVICE_NATIONAL * 100) / 100)
    assert.equal(summary.quotedLineCount, 1)
    assert.equal(summary.gst, 0)
    assert.equal(summary.total, summary.subtotal)
})

test('the stored metadata records provenance and what was dropped', () => {
    const itemMetadata = buildQuoteItemMetadata({ jobId: 7, generatedAt: new Date('2026-09-29T00:00:00Z') })
    assert.equal(itemMetadata.origin, 'quote-writer')
    assert.equal(itemMetadata.jobId, 7)
    assert.equal(itemMetadata.generatedAt, '2026-09-29T00:00:00.000Z')

    const quoteMetadata = buildQuoteMetadata({
        summary: 'A short summary.',
        dropped: [{ supportItemNumber: '99_999_9999_9_9', reason: 'unknown-support-item' }],
        config: { pricingRegion: 'remote' },
    })
    assert.equal(quoteMetadata.origin, 'quote-writer')
    assert.equal(quoteMetadata.pricingRegion, 'remote')
    assert.equal(quoteMetadata.summary, 'A short summary.')
    assert.equal(quoteMetadata.droppedProposals.length, 1)
})

test('the draft note explains the origin, the summary and the drops', () => {
    const notes = buildQuoteDraftNotes({
        summary: 'Eight hours of OT.',
        dropped: [{ reason: 'unknown-support-item' }],
        pricingRegion: 'remote',
    })

    assert.match(notes, /Drafted by the Quote Writer worker\./)
    assert.match(notes, /Eight hours of OT\./)
    assert.match(notes, /1 proposed line\(s\) were not added/)
    assert.match(notes, /remote price limits/)
})
