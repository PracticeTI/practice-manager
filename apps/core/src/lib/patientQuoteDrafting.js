// Shared, I/O-free logic for the patient "Quote Writer" worker.
//
// The worker turns a patient's clinical record (notes, transcript summaries, the
// latest report, equipment recommendations and the intake answers) into a draft
// NDIS quote: a header plus priced lines. Everything in this module is pure, so
// the same rules run in the API route, the panel preview and the test suite, and
// so the model's answer is *validated against the curated NDIS catalogue* rather
// than trusted.
//
// Two rules the rest of the feature depends on:
//   1. A proposed line only survives if its support item number resolves in
//      `ndisSupportCatalogue.js`. A hallucinated number is dropped, never stored.
//   2. A line's price is the published price limit for the selected region. The
//      model does not get to invent a price, and `price_limit` is snapshotted on
//      the line the same way the manual quote form does.
//
// Kept free of Node-only APIs, and loaded by `test/*.test.js` under plain
// `node --test`, so sibling imports carry an explicit `.js` extension.

import {
    DEFAULT_NDIS_PRICING_REGION,
    NDIS_CATALOGUE_PERIOD,
    NDIS_SUPPORT_ITEMS,
    buildNdisQuoteLine,
    formatNdisPriceLimit,
    normalizeNdisPricingRegion,
    resolveNdisSupportItemSelection,
} from './ndisSupportCatalogue.js'
import {
    DEFAULT_FUNDING_TYPE,
    DEFAULT_QUOTE_VALIDITY_DAYS,
    GST_RATE,
    cleanString,
    roundMoney,
    toFinite,
} from './patientQuotes.js'

/** Agent key on `patient.metadata.patientAgents`, and the AI worker key. */
export const QUOTE_WRITER_AGENT_KEY = 'quoteWriter'
export const QUOTE_WRITER_LABEL = 'Quote Writer'

/**
 * Provenance marker. `patient_quotes.external_source` carries this value so the
 * unique index on (domain, external_source, external_id) gives the worker exactly
 * one draft per patient, and a re-run updates that draft instead of piling up
 * duplicates. `quote_items.metadata.origin` carries it too, so a re-run only
 * replaces the lines the worker wrote and leaves hand-added lines alone.
 */
export const QUOTE_WRITER_ORIGIN = 'quote-writer'
export const QUOTE_WRITER_SOURCE = 'one:quote-writer'

/** A quote is a document a practitioner reviews — never let the model sprawl. */
export const QUOTE_WRITER_MAX_LINES = 25

/** Per-block character caps for the evidence sent to the model. */
export const QUOTE_WRITER_EVIDENCE_LIMITS = {
    notes: 16000,
    transcripts: 16000,
    report: 16000,
    equipment: 4000,
    intake: 4000,
}

export const DEFAULT_QUOTE_WRITER_WORKER_PROMPT = [
    'You prepare NDIS quotes for an occupational therapy practice.',
    'Read the supplied clinical evidence and decide which supports the practice should quote for this participant.',
    'Only use support item numbers from the supplied NDIS support catalogue — never invent, guess or reformat a number.',
    'Return valid JSON only.',
].join(' ')

export const DEFAULT_QUOTE_WRITER_AGENT_CONFIG = {
    pricingRegion: DEFAULT_NDIS_PRICING_REGION,
    includeTranscripts: true,
    includeReports: true,
    includeEquipment: true,
    additionalInstructions: '',
    workerPrompt: '',
}

const QUOTE_WRITER_STYLE_RULES = [
    'Rules for the lines you return:',
    `- Return at most ${QUOTE_WRITER_MAX_LINES} lines. Prefer few, well-justified lines over a long list.`,
    '- Every line must name a support item number that appears verbatim in the catalogue block.',
    '- quantity is the number of hours (therapy lines) or units (equipment/home modification lines) the evidence supports. Use 1 when the evidence does not justify more.',
    '- description explains what the support covers and cites the evidence it came from (for example the functional goal or the equipment recommendation). Keep it to one or two sentences.',
    '- Do not invent prices. The practice prices lines from the published limits.',
    '- When the evidence does not support a support type, omit it. Never pad the quote.',
].join('\n')

const QUOTE_WRITER_RESPONSE_SHAPE = [
    'Return JSON with these keys:',
    '- summary: one short paragraph explaining what the quote covers and which evidence drove it.',
    '- lines: array of objects with keys support_item_number, quantity, description.',
].join('\n')

function cleanOptionalText(value, maxLength = 2000) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : ''
}

function truncate(value, maxLength) {
    const text = cleanString(value)
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n[truncated]` : text
}

/** True when the Quote Writer agent is switched on for this patient. */
export function isQuoteWriterEnabled(metadata) {
    const agents = metadata?.patientAgents || metadata?.agents
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return false
    return agents[QUOTE_WRITER_AGENT_KEY] === true || agents.quote_writer === true
}

/**
 * Normalises the per-patient worker settings. Region drives every price limit on
 * the draft, so an unknown value falls back to the national schedule rather than
 * silently pricing at a region the practice does not operate in.
 */
export function normalizeQuoteWriterConfig(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    return {
        ...DEFAULT_QUOTE_WRITER_AGENT_CONFIG,
        pricingRegion: normalizeNdisPricingRegion(source.pricingRegion),
        includeTranscripts: source.includeTranscripts !== false,
        includeReports: source.includeReports !== false,
        includeEquipment: source.includeEquipment !== false,
        additionalInstructions: cleanOptionalText(source.additionalInstructions, 2000),
        workerPrompt: cleanOptionalText(source.workerPrompt, 4000),
    }
}

/**
 * Stable signature of a patient's Quote Writer settings, so the patient route can
 * tell "switched on" apart from "switched on and its settings changed".
 */
export function quoteWriterConfigSignature(metadata) {
    const agents = metadata?.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : metadata?.agents && typeof metadata.agents === 'object' && !Array.isArray(metadata.agents)
            ? metadata.agents
            : {}
    const raw = agents.quoteWriterConfig ?? agents.quote_writer_config
    return JSON.stringify(normalizeQuoteWriterConfig(raw))
}

/**
 * The catalogue block handed to the model: number, name, unit and the region's
 * price limit. The curated catalogue is deliberately small enough to send in
 * full, which is what makes "only use numbers from this list" enforceable.
 */
export function buildQuoteCatalogueBlock(region = DEFAULT_NDIS_PRICING_REGION) {
    const pricingRegion = normalizeNdisPricingRegion(region)
    const rows = NDIS_SUPPORT_ITEMS.map((item) => (
        `${item.number} | ${item.name} | ${item.unit} | ${formatNdisPriceLimit(item.number, pricingRegion)}`
    ))

    return [
        `NDIS support catalogue ${NDIS_CATALOGUE_PERIOD} (region: ${pricingRegion}).`,
        'Format: number | name | unit | unit price',
        ...rows,
    ].join('\n')
}

/**
 * The evidence block the model reads. Each section is dropped when it is off or
 * empty, so a patient with no transcripts simply gets a shorter prompt.
 */
export function buildQuoteDraftEvidence({
    patientName,
    fundingSource,
    referenceLabel,
    referenceNumber,
    intakeAnswers,
    notesText,
    transcriptSummaries,
    reportMarkdown,
    equipmentSuggestions,
    config,
} = {}) {
    const settings = normalizeQuoteWriterConfig(config)
    const limits = QUOTE_WRITER_EVIDENCE_LIMITS

    const sections = []
    const intakeLines = describeIntakeAnswers(intakeAnswers, { fundingSource, referenceLabel, referenceNumber })
    if (intakeLines.length) {
        sections.push(`Participant details:\n${truncate(intakeLines.join('\n'), limits.intake)}`)
    }
    if (settings.includeReports) {
        const report = truncate(reportMarkdown, limits.report)
        if (report) sections.push(`Latest report:\n${report}`)
    }
    const notes = truncate(notesText, limits.notes)
    if (notes) sections.push(`Patient notes:\n${notes}`)
    if (settings.includeTranscripts) {
        const transcripts = truncate(transcriptSummaries, limits.transcripts)
        if (transcripts) sections.push(`Transcript summaries:\n${transcripts}`)
    }
    if (settings.includeEquipment) {
        const equipment = truncate(equipmentSuggestions, limits.equipment)
        if (equipment) sections.push(`Equipment recommendations:\n${equipment}`)
    }

    return { patientName: cleanString(patientName), sections }
}

function describeIntakeAnswers(answers, { fundingSource, referenceLabel, referenceNumber } = {}) {
    const lines = []
    const funding = cleanString(fundingSource)
    if (funding) lines.push(`- Funding source: ${funding}`)

    const number = cleanString(referenceNumber)
    if (number) lines.push(`- ${cleanString(referenceLabel) || 'Reference number'}: ${number}`)

    const source = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {}
    for (const [key, value] of Object.entries(source)) {
        const text = cleanOptionalText(value, 500)
        if (text) lines.push(`- ${key}: ${text}`)
        if (lines.length >= 40) break
    }

    return lines
}

/** Chat messages for the drafting call. */
export function buildQuoteDraftMessages({
    evidence,
    config,
    fundingSource,
    subjectNoun = 'participant',
} = {}) {
    const settings = normalizeQuoteWriterConfig(config)
    const systemPrompt = [
        settings.workerPrompt || DEFAULT_QUOTE_WRITER_WORKER_PROMPT,
        QUOTE_WRITER_STYLE_RULES,
        QUOTE_WRITER_RESPONSE_SHAPE,
        settings.additionalInstructions || null,
    ].filter(Boolean).join('\n\n')

    const blocks = Array.isArray(evidence?.sections) ? evidence.sections : []
    const noun = String(subjectNoun || 'participant').trim().toLowerCase()
    const userPrompt = [
        // The person is named by their role, never by name: the identity block strips every
        // identifying value before this prompt leaves, and the real name is restored onto the
        // quote header locally when the draft is written.
        `Subject: refer to the person as "the ${noun}".`,
        cleanString(fundingSource) ? `Funding: ${fundingSource}` : null,
        fundingPricingNote(settings.pricingRegion),
        '',
        blocks.join('\n\n') || `No clinical evidence is available for this ${noun}.`,
        '',
        '',
        buildQuoteCatalogueBlock(settings.pricingRegion),
    ].filter((part) => part !== null).join('\n')

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ]
}

function fundingPricingNote(region) {
    return `Price every line at the published ${region} price limit shown in the catalogue below.`
}

/**
 * Validates one proposed line against the catalogue. Returns null when the line
 * cannot be trusted (unknown support item number, or no quantity).
 */
export function normalizeQuoteDraftLine(raw, { pricingRegion = DEFAULT_NDIS_PRICING_REGION } = {}) {
    const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const proposedNumber = cleanString(
        candidate.support_item_number
        ?? candidate.ndis_support_item_number
        ?? candidate.supportItemNumber
        ?? candidate.item_number
        ?? candidate.itemNumber
        ?? candidate.number
    )

    const catalogueItem = resolveNdisSupportItemSelection(proposedNumber)
    if (!catalogueItem) {
        return { line: null, reason: 'unknown-support-item', proposedNumber }
    }

    const base = buildNdisQuoteLine({ itemNumber: catalogueItem.number, region: pricingRegion })
    if (!base) {
        return { line: null, reason: 'unknown-support-item', proposedNumber }
    }

    const quantityRaw = candidate.quantity
    const quantity = quantityRaw === undefined || quantityRaw === null || cleanString(quantityRaw) === ''
        ? 1
        : toFinite(quantityRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { line: null, reason: 'invalid-quantity', proposedNumber: catalogueItem.number }
    }

    // The limit is the price: `unit_price` and the `price_limit` snapshot are the
    // same number, and a quoted support (no published limit) stays at zero for the
    // practitioner to negotiate.
    const priceLimit = base.price_limit === null || base.price_limit === undefined
        ? null
        : roundMoney(base.price_limit)

    return {
        line: {
            ...base,
            price_limit: priceLimit,
            unit_price: priceLimit === null ? 0 : priceLimit,
            quantity: Math.min(roundQuantity(quantity), 999),
            description: cleanOptionalText(candidate.description ?? candidate.justification, 2000) || null,
        },
        reason: null,
        proposedNumber: catalogueItem.number,
    }
}

function roundQuantity(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Turns the model's JSON answer into a reviewable draft. Never throws on a
 * malformed answer: a partial draft plus the list of dropped proposals is more
 * useful to a practitioner than an error, and the caller surfaces what was lost.
 */
export function normalizeQuoteDraftResponse(payload, { pricingRegion = DEFAULT_NDIS_PRICING_REGION } = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const proposed = Array.isArray(source.lines)
        ? source.lines
        : Array.isArray(source.items)
            ? source.items
            : []

    const lines = []
    const dropped = []
    const seen = new Set()

    for (const raw of proposed) {
        const result = normalizeQuoteDraftLine(raw, { pricingRegion })
        if (!result.line) {
            dropped.push({ supportItemNumber: result.proposedNumber || '', reason: result.reason })
            continue
        }
        // The catalogue lists the same therapy under several support categories.
        // Keep the model's first choice and drop later duplicates.
        const key = `${result.line.ndis_support_item_number}:${result.line.description || ''}`.toLowerCase()
        if (seen.has(key)) {
            dropped.push({ supportItemNumber: result.line.ndis_support_item_number, reason: 'duplicate' })
            continue
        }
        seen.add(key)
        lines.push(result.line)
        if (lines.length >= QUOTE_WRITER_MAX_LINES) break
    }

    return {
        summary: cleanOptionalText(source.summary, 2000),
        lines,
        dropped,
        proposedCount: proposed.length,
    }
}

/** The quote header a draft is written with. */
export function buildQuoteDraftHeader({
    fundingContext,
    config,
    preparedBy = QUOTE_WRITER_LABEL,
    today = new Date(),
    validityDays = DEFAULT_QUOTE_VALIDITY_DAYS,
} = {}) {
    const settings = normalizeQuoteWriterConfig(config)
    const fundingType = cleanString(fundingContext?.fundingType).toLowerCase() || DEFAULT_FUNDING_TYPE
    const quoteDate = toDateOnly(today)
    const validUntil = toDateOnly(addDays(today, validityDays))

    return {
        status: 'draft',
        funding_type: fundingType,
        pricing_region: settings.pricingRegion,
        // The participant number is copied from the patient at draft time and kept
        // as a snapshot on the quote, matching the manual form.
        ndis_number: cleanString(fundingContext?.referenceNumber) || null,
        quote_date: quoteDate,
        valid_until: validUntil,
        prepared_by: cleanOptionalText(preparedBy, 255) || QUOTE_WRITER_LABEL,
        // NDIS supports are GST-free; a quote in this worker is always NDIS-side.
        gst_applicable: false,
    }
}

/** The note stored on the generated draft, explaining where it came from. */
export function buildQuoteDraftNotes({ summary, dropped, pricingRegion } = {}) {
    const parts = [`Drafted by the ${QUOTE_WRITER_LABEL} worker.`]
    const statement = cleanOptionalText(summary, 1200)
    if (statement) parts.push(statement)

    const problems = Array.isArray(dropped) ? dropped : []
    if (problems.length) {
        parts.push(`${problems.length} proposed line(s) were not added because their support item could not be verified against the NDIS catalogue.`)
    }
    parts.push(`Priced at the published ${normalizeNdisPricingRegion(pricingRegion)} price limits.`)
    return parts.join(' ')
}

/** Line count, subtotal and quoted-line count for the panel's preview header. */
export function summarizeQuoteDraft(lines, { gstApplicable = false } = {}) {
    const rows = Array.isArray(lines) ? lines : []
    let subtotal = 0
    let quotedLineCount = 0

    for (const line of rows) {
        subtotal += toFinite(line?.quantity) * toFinite(line?.unit_price)
        if (line?.price_limit === null || line?.price_limit === undefined || toFinite(line.price_limit) <= 0) {
            quotedLineCount += 1
        }
    }

    const rounded = roundMoney(subtotal)
    const gst = gstApplicable ? roundMoney(rounded * GST_RATE) : 0
    return {
        itemCount: rows.length,
        subtotal: rounded,
        gst,
        total: roundMoney(rounded + gst),
        quotedLineCount,
        gstApplicable: Boolean(gstApplicable),
    }
}

/** `quote_items.metadata` for a worker-written line. */
export function buildQuoteItemMetadata({ jobId = null, generatedAt = new Date() } = {}) {
    return {
        origin: QUOTE_WRITER_ORIGIN,
        generatedAt: toIsoString(generatedAt),
        jobId: jobId === null || jobId === undefined ? null : jobId,
    }
}

/** `patient_quotes.metadata` for a worker-written draft. */
export function buildQuoteMetadata({ summary, dropped, config, jobId = null, generatedAt = new Date() } = {}) {
    const settings = normalizeQuoteWriterConfig(config)
    return {
        origin: QUOTE_WRITER_ORIGIN,
        generatedAt: toIsoString(generatedAt),
        jobId: jobId === null || jobId === undefined ? null : jobId,
        summary: cleanOptionalText(summary, 2000) || null,
        pricingRegion: settings.pricingRegion,
        droppedProposals: Array.isArray(dropped)
            ? dropped.slice(0, 25).map((entry) => ({
                supportItemNumber: cleanString(entry?.supportItemNumber),
                reason: cleanString(entry?.reason),
            }))
            : [],
    }
}

/** True when a stored quote row is the worker's own draft for this patient. */
export function isQuoteWriterDraft(row) {
    const source = cleanString(row?.external_source).toLowerCase()
    const origin = cleanString(row?.metadata?.origin).toLowerCase()
    return source === QUOTE_WRITER_ORIGIN || origin === QUOTE_WRITER_ORIGIN
}

function toDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${padTwo(value.getMonth() + 1)}-${padTwo(value.getDate())}`
    }
    const text = cleanString(value)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function addDays(value, days) {
    const base = value instanceof Date && !Number.isNaN(value.getTime()) ? new Date(value.getTime()) : new Date()
    base.setDate(base.getDate() + Math.max(0, Math.trunc(toFinite(days))))
    return base
}

function toIsoString(value) {
    const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date()
    return date.toISOString()
}

function padTwo(value) {
    return String(value).padStart(2, '0')
}
