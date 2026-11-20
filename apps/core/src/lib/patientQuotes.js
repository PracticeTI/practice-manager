// Shared helpers for the patient "Quotes" feature.
//
// A quote is the priced document a practice gives an NDIS participant (or their
// plan manager) before delivering the supports — most often assistive technology
// and home modifications, which the NDIS asks to be quoted rather than paid at a
// price limit. It is deliberately stored as a header (patient_quotes) plus priced
// lines (quote_items) so each line can carry its NDIS support item number, unit
// and the price limit that applied when the quote was prepared.
//
// Kept free of Node-only APIs so the API routes and the admin panel share the
// same validation, normalisation and totals logic.

import {
    NDIS_PRICING_REGION_VALUES,
    DEFAULT_NDIS_PRICING_REGION,
    isNdisQuoteRequired,
    normalizeNdisPricingRegion,
    normalizeSupportItemNumber,
} from './ndisSupportCatalogue.js'

export const QUOTE_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined', 'expired'])

/** Statuses whose outcome is already decided, so expiry no longer matters. */
export const SETTLED_QUOTE_STATUSES = ['accepted', 'declined']

export const FUNDING_TYPES = new Set(['ndis', 'private', 'other'])

export const DEFAULT_QUOTE_STATUS = 'draft'
export const DEFAULT_FUNDING_TYPE = 'ndis'

/** GST on a quote line. NDIS supports are GST-free, so this only applies to private work. */
export const GST_RATE = 0.1

/** Default validity window offered on a new NDIS quote. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30

export function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

export function toBool(value) {
    return value === true || value === 1 || value === '1' || value === 't' || value === 'true'
}

export function toFinite(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
}

export function roundMoney(value) {
    return Math.round((toFinite(value) + Number.EPSILON) * 100) / 100
}

/**
 * True when the quote is priced against NDIS price limits rather than a private
 * agreement. NDIS supports are GST-free, so the GST option only applies to
 * private work.
 */
export function isNdisFunding(fundingType) {
    return String(fundingType || '').trim().toLowerCase() === 'ndis'
}

function padTwo(value) {
    return String(value).padStart(2, '0')
}

// The driver may return DATE columns as JS Date objects; normalise them back to
// the YYYY-MM-DD string form PostgreSQL already returns via to_char().
export function formatDateValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${padTwo(value.getMonth() + 1)}-${padTwo(value.getDate())}`
    }
    return String(value)
}

export function validateId(rawId) {
    const id = Number.parseInt(String(rawId || ''), 10)
    return Number.isFinite(id) && id > 0 ? id : null
}

export async function resolveRouteParams(params) {
    if (params && typeof params.then === 'function') {
        return await params
    }
    return params || {}
}

export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableString(value, maxLength = 255) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : null
}

export function cleanOptionalText(value) {
    return cleanString(value) || null
}

export function parseDateOnly(value) {
    const text = cleanString(value)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function parseNonNegativeNumber(value) {
    const text = cleanString(value)
    if (text === '') return 0
    const number = Number(text)
    return Number.isFinite(number) && number >= 0 ? number : 0
}

/**
 * Like parseNonNegativeNumber but reports whether the raw value was usable, so
 * callers can reject "abc" instead of silently storing 0. A blank value is valid
 * (0) — a quote line may legitimately be priced at zero for a negotiated support.
 */
export function parseMoney(value) {
    const text = cleanString(value)
    if (text === '') return { value: 0, valid: true }

    const number = Number(text)
    if (!Number.isFinite(number) || number < 0) {
        return { value: 0, valid: false }
    }
    return { value: roundMoney(number), valid: true }
}

/**
 * The line total, and how it compares with the NDIS price limit for this line.
 * A null limit (quoted supports) is never "over".
 */
export function buildQuoteLineMetrics(item) {
    const quantity = toFinite(item?.quantity)
    const unitPrice = toFinite(item?.unit_price)
    const lineTotal = roundMoney(quantity * unitPrice)
    const priceLimit = item?.price_limit === null || item?.price_limit === undefined
        ? null
        : toFinite(item.price_limit)
    const overLimit = priceLimit !== null && priceLimit > 0 && unitPrice > priceLimit + 0.000001

    return {
        quantity,
        unitPrice,
        lineTotal,
        priceLimit: priceLimit && priceLimit > 0 ? priceLimit : null,
        overLimit,
        overLimitBy: overLimit ? roundMoney(unitPrice - priceLimit) : 0,
    }
}

/**
 * Quote totals from its lines. Kept in one place so the API, the panel summary
 * and any export always agree.
 */
export function computeQuoteTotals(items, { gstApplicable = false } = {}) {
    const rows = Array.isArray(items) ? items : []
    let subtotal = 0
    let overLimitCount = 0
    let quotedLineCount = 0

    for (const item of rows) {
        const metrics = buildQuoteLineMetrics(item)
        subtotal += metrics.lineTotal
        if (metrics.overLimit) overLimitCount += 1
        if (metrics.priceLimit === null) quotedLineCount += 1
    }

    subtotal = roundMoney(subtotal)
    const gst = gstApplicable ? roundMoney(subtotal * GST_RATE) : 0

    return {
        itemCount: rows.length,
        subtotal,
        gst,
        gstApplicable: Boolean(gstApplicable),
        total: roundMoney(subtotal + gst),
        overLimitCount,
        quotedLineCount,
    }
}

export function normalizeQuoteRow(row) {
    if (!row || typeof row !== 'object') return row

    const gstApplicable = toBool(row.gst_applicable)
    const subtotal = roundMoney(row.subtotal)
    const gst = gstApplicable ? roundMoney(subtotal * GST_RATE) : 0

    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        gst_applicable: gstApplicable,
        item_count: Math.trunc(toFinite(row.item_count)),
        over_limit_count: Math.trunc(toFinite(row.over_limit_count)),
        subtotal,
        gst,
        total: roundMoney(subtotal + gst),
        is_expired: toBool(row.is_expired),
        quote_date: formatDateValue(row.quote_date),
        valid_until: formatDateValue(row.valid_until),
    }
}

export function normalizeQuoteItemRow(row) {
    if (!row || typeof row !== 'object') return row

    const quantity = toFinite(row.quantity)
    const unitPrice = toFinite(row.unit_price)
    const priceLimit = row.price_limit === null || row.price_limit === undefined
        ? null
        : toFinite(row.price_limit)

    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        position: Math.trunc(toFinite(row.position)),
        quantity,
        unit_price: unitPrice,
        price_limit: priceLimit && priceLimit > 0 ? priceLimit : null,
        quote_required: toBool(row.quote_required),
        line_total: roundMoney(quantity * unitPrice),
    }
}

export async function patientExists(connection, dbType, patientId, domain) {
    if (!validateId(patientId) || !domain) return false

    const result = await connection.query(
        'SELECT id FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
        [patientId, domain]
    )
    return (result?.rowCount || 0) > 0
}

/**
 * The next `QTE-nnnn` number for a domain. Numbers are derived from the stored
 * ones rather than a sequence so a domain that already has hand-numbered quotes
 * continues from there. Shared by the quotes route and the Quote Writer worker —
 * both create quotes, and two numbering schemes would collide.
 */
export async function nextQuoteNumber(connection, domain) {
    const result = await connection.query(
        'SELECT quote_number FROM patient_quotes WHERE domain = $1',
        [domain]
    )

    const existing = new Set(
        (result.rows || [])
            .map((row) => cleanNullableString(row?.quote_number, 120))
            .filter(Boolean)
    )

    let maxSeq = 0
    existing.forEach((value) => {
        const match = /^QTE-(\d+)$/i.exec(value)
        if (match) {
            maxSeq = Math.max(maxSeq, Number.parseInt(match[1], 10))
        }
    })

    let seq = maxSeq > 0 ? maxSeq + 1 : existing.size + 1
    let candidate = `QTE-${String(seq).padStart(4, '0')}`
    while (existing.has(candidate)) {
        seq += 1
        candidate = `QTE-${String(seq).padStart(4, '0')}`
    }
    return candidate
}

/**
 * SELECT fragment for the derived quote projection (line count, subtotal, expiry
 * flag and the number of lines priced above their NDIS limit).
 */
export function buildQuoteTotalsSelect() {
    return {
        dateExpr: (column) => `to_char(${column}, 'YYYY-MM-DD')`,
        itemCountExpr: `COALESCE((SELECT COUNT(*) FROM quote_items qi WHERE qi.quote_id = pq.id AND qi.domain = pq.domain), 0) AS item_count`,
        subtotalExpr: `COALESCE((SELECT SUM(qi.quantity * qi.unit_price) FROM quote_items qi WHERE qi.quote_id = pq.id AND qi.domain = pq.domain), 0) AS subtotal`,
        overLimitExpr: `COALESCE((SELECT COUNT(*) FROM quote_items qi WHERE qi.quote_id = pq.id AND qi.domain = pq.domain AND qi.price_limit IS NOT NULL AND qi.unit_price > qi.price_limit), 0) AS over_limit_count`,
        expiredExpr: `(pq.valid_until IS NOT NULL AND pq.valid_until < CURRENT_DATE) AS is_expired`,
    }
}

/**
 * The full quote projection used by every quotes route: header columns, the
 * patient's name and the derived totals. Kept here so the list, detail and item
 * endpoints cannot drift apart.
 */
export function buildQuoteSelect() {
    const totals = buildQuoteTotalsSelect()
    const date = totals.dateExpr

    const columns = `
        pq.id, pq.domain, pq.patient_id, pt.patient_name, pq.quote_number, pq.status,
        pq.funding_type, pq.pricing_region, pq.plan_manager, pq.ndis_number,
        pq.quote_date, pq.valid_until, pq.prepared_by, pq.gst_applicable, pq.notes,
        pq.metadata, pq.created_at, pq.updated_at,
        pq.external_id, pq.external_source, pq.external_patient_id
    `
        .replaceAll('pq.quote_date', `${date('pq.quote_date')} AS quote_date`)
        .replaceAll('pq.valid_until', `${date('pq.valid_until')} AS valid_until`)

    return `
        SELECT ${columns},
               ${totals.itemCountExpr},
               ${totals.subtotalExpr},
               ${totals.overLimitExpr},
               ${totals.expiredExpr}
        FROM patient_quotes pq
        LEFT JOIN patients pt ON pt.id = pq.patient_id AND pt.domain = pq.domain
    `
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

export function parseQuoteFields(payload) {
    const status = cleanString(payload?.status).toLowerCase()
    const fundingType = cleanString(payload?.funding_type).toLowerCase()
    const pricingRegion = cleanString(payload?.pricing_region).toLowerCase()

    if (status && !QUOTE_STATUSES.has(status)) {
        return { value: null, error: 'status must be one of: draft, sent, accepted, declined, expired' }
    }
    if (fundingType && !FUNDING_TYPES.has(fundingType)) {
        return { value: null, error: 'funding_type must be one of: ndis, private, other' }
    }
    if (pricingRegion && !NDIS_PRICING_REGION_VALUES.includes(pricingRegion)) {
        return { value: null, error: `pricing_region must be one of: ${NDIS_PRICING_REGION_VALUES.join(', ')}` }
    }

    return {
        value: {
            quote_number: cleanNullableString(payload?.quote_number, 120),
            status: status || DEFAULT_QUOTE_STATUS,
            funding_type: fundingType || DEFAULT_FUNDING_TYPE,
            pricing_region: pricingRegion || DEFAULT_NDIS_PRICING_REGION,
            plan_manager: cleanNullableString(payload?.plan_manager, 255),
            ndis_number: cleanNullableString(payload?.ndis_number, 64),
            quote_date: parseDateOnly(payload?.quote_date),
            valid_until: parseDateOnly(payload?.valid_until),
            prepared_by: cleanNullableString(payload?.prepared_by, 255),
            gst_applicable: toBool(payload?.gst_applicable),
            notes: cleanOptionalText(payload?.notes),
            metadata: payload?.metadata === undefined ? null : payload?.metadata,
        },
        error: null,
    }
}

/**
 * Parses a quote line. `quantity` must be greater than zero and `unit_price` may
 * be zero (a support whose price is negotiated), but a line must still name what
 * is being quoted — either a catalogue support item or a free-text description.
 */
export function parseQuoteItemFields(payload) {
    const quantityRaw = cleanString(payload?.quantity)
    const quantity = Number(quantityRaw)
    if (quantityRaw === '' || !Number.isFinite(quantity) || quantity <= 0) {
        return { value: null, error: 'quantity must be greater than zero' }
    }

    const unitPrice = parseMoney(payload?.unit_price)
    if (!unitPrice.valid) {
        return { value: null, error: 'unit_price must be zero or greater' }
    }

    const priceLimit = parseMoney(payload?.price_limit)
    if (!priceLimit.valid) {
        return { value: null, error: 'price_limit must be zero or greater' }
    }

    const supportItemNumber = cleanNullableString(payload?.ndis_support_item_number, 48)
    const supportItemName = cleanNullableString(payload?.ndis_support_item_name, 255)
    const description = cleanOptionalText(payload?.description)
    if (!supportItemName && !description) {
        return { value: null, error: 'A line needs an NDIS support item or a description' }
    }

    const registrationGroupNumber = cleanNullableString(payload?.registration_group_number, 16)
    const quoteRequired = payload?.quote_required === undefined
        ? isNdisQuoteRequired(supportItemNumber)
        : toBool(payload?.quote_required)

    return {
        value: {
            position: Math.max(Math.trunc(parseNonNegativeNumber(payload?.position)), 0),
            ndis_support_item_number: supportItemNumber ? normalizeSupportItemNumber(supportItemNumber) : null,
            ndis_support_item_name: supportItemName,
            registration_group_number: registrationGroupNumber,
            registration_group_name: cleanNullableString(payload?.registration_group_name, 160),
            support_category_number: cleanNullableString(payload?.support_category_number, 16),
            support_category_name: cleanNullableString(payload?.support_category_name, 160),
            unit: cleanNullableString(payload?.unit, 16),
            quantity,
            unit_price: roundMoney(unitPrice.value),
            price_limit: priceLimit.value > 0 ? roundMoney(priceLimit.value) : null,
            quote_required: quoteRequired,
            description,
            metadata: payload?.metadata === undefined ? null : payload?.metadata,
        },
        error: null,
    }
}

/**
 * Resolves the mutable quote header fields present in a PATCH payload into
 * `{ key, value }` updates, validating enums. Mirrors the case update helper so
 * the route stays a thin wrapper.
 */
export function resolveQuoteUpdates(payload) {
    const updates = []
    const errors = []

    const pushString = (key, maxLength) => {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            updates.push({ key, value: cleanNullableString(payload[key], maxLength) })
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
        const status = cleanString(payload.status).toLowerCase()
        if (!QUOTE_STATUSES.has(status)) {
            errors.push('status must be one of: draft, sent, accepted, declined, expired')
        } else {
            updates.push({ key: 'status', value: status })
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'funding_type')) {
        const fundingType = cleanString(payload.funding_type).toLowerCase()
        if (!FUNDING_TYPES.has(fundingType)) {
            errors.push('funding_type must be one of: ndis, private, other')
        } else {
            updates.push({ key: 'funding_type', value: fundingType })
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'pricing_region')) {
        const region = cleanString(payload.pricing_region).toLowerCase()
        if (!NDIS_PRICING_REGION_VALUES.includes(region)) {
            errors.push(`pricing_region must be one of: ${NDIS_PRICING_REGION_VALUES.join(', ')}`)
        } else {
            updates.push({ key: 'pricing_region', value: region })
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'gst_applicable')) {
        updates.push({ key: 'gst_applicable', value: toBool(payload.gst_applicable) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'quote_date')) {
        updates.push({ key: 'quote_date', value: parseDateOnly(payload.quote_date) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'valid_until')) {
        updates.push({ key: 'valid_until', value: parseDateOnly(payload.valid_until) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
        updates.push({ key: 'notes', value: cleanOptionalText(payload.notes) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && typeof metadata !== 'object') {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    pushString('quote_number', 120)
    pushString('plan_manager', 255)
    pushString('ndis_number', 64)
    pushString('prepared_by', 255)

    return { updates, errors }
}

/** Same shape as resolveQuoteUpdates, for a quote line. */
export function resolveQuoteItemUpdates(payload) {
    const parsed = parseQuoteItemFields(payload)
    if (parsed.error) {
        return { updates: [], errors: [parsed.error] }
    }

    const fields = parsed.value
    const updates = []

    for (const [key, value] of Object.entries(fields)) {
        if (key === 'position' && !Object.prototype.hasOwnProperty.call(payload, 'position')) continue
        if (key === 'quote_required' && !Object.prototype.hasOwnProperty.call(payload, 'quote_required')) continue
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
        updates.push({ key, value })
    }

    return { updates, errors: [] }
}

// ---------------------------------------------------------------------------
// Patient intake context
// ---------------------------------------------------------------------------

/**
 * Field ids from the patient Info tab (`DEFAULT_SPLPOSE_FIELDS` in the admin
 * patients page). The participant/claim number and the funding scheme are
 * captured once on the patient record, so a quote reads them from there instead
 * of asking the therapist to retype them. A single intake field carries the
 * NDIS, TAC and WorkCover numbers, which is why the heading a quote shows
 * follows the funding source rather than being hard-coded.
 */
export const PATIENT_FUNDING_SOURCE_FIELD_ID = 'funding_source_or_referral_type'
export const PATIENT_REFERENCE_NUMBER_FIELD_ID = 'claim_or_reference_number'
export const PATIENT_FUNDING_SOURCE_LABEL = 'Funding Source or Referral Type'
export const PATIENT_REFERENCE_NUMBER_LABEL = 'NDIS number/ TAC Claim Number/Work Cover Reference Number'

/** Fold case and punctuation so an intake answer is found whatever its casing. */
function normalizeAnswerKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Answers are stored under the field id; `labelledAnswers` is the label-keyed
// fallback, and its casing varies between the import and form sources.
function readIntakeAnswer(answers, labelledAnswers, id, label) {
    const direct = cleanString(answers?.[id])
    if (direct) return direct

    const wanted = normalizeAnswerKey(label)
    for (const [key, value] of Object.entries(labelledAnswers || {})) {
        if (normalizeAnswerKey(key) !== wanted) continue
        const text = cleanString(value)
        if (text) return text
    }
    return ''
}

/** The heading the intake number wears for a given funding scheme. */
export function referenceNumberLabelFor(fundingSource) {
    const key = normalizeAnswerKey(fundingSource)
    if (key.startsWith('ndis')) return 'NDIS participant number'
    if (key === 'tac') return 'TAC claim number'
    if (key.startsWith('workcover') || key.startsWith('work cover')) return 'WorkCover reference number'
    if (key === 'dva') return 'DVA file number'
    if (key.includes('aged care') || key === 'hcp') return 'Aged care reference number'
    return 'Participant / claim number'
}

/**
 * Everything a quote takes from the patient's intake record: the participant or
 * claim number, the funding scheme it belongs to, the heading to show it under,
 * and the quote funding type to default to. `fundingType` is null when the
 * patient has no funding source recorded, so the caller keeps its own default.
 *
 * The number is copied onto the quote when it is created (so the quote keeps the
 * number as at its issue date) and read from the patient again as a fallback
 * when the stored copy is blank.
 */
export function resolvePatientFundingContext({ answers, labelledAnswers } = {}) {
    const fundingSource = readIntakeAnswer(
        answers,
        labelledAnswers,
        PATIENT_FUNDING_SOURCE_FIELD_ID,
        PATIENT_FUNDING_SOURCE_LABEL
    )
    const referenceNumber = readIntakeAnswer(
        answers,
        labelledAnswers,
        PATIENT_REFERENCE_NUMBER_FIELD_ID,
        PATIENT_REFERENCE_NUMBER_LABEL
    )
    const isNdis = normalizeAnswerKey(fundingSource) === 'ndis'

    return {
        fundingSource,
        referenceNumber,
        isNdis,
        fundingType: fundingSource ? (isNdis ? 'ndis' : 'other') : null,
        referenceLabel: referenceNumberLabelFor(fundingSource),
    }
}
