// Shared helpers for the patient "Service Agreements" feature.
//
// A service agreement is the signed contract that governs ongoing service
// delivery — what supports are provided, how the participant is funded and pays,
// the provider's cancellation and notice terms, consent to claim non-face-to-face
// activities, and the signatures of both parties. It is related to, but not the
// same as, a quote: a quote is a priced proposal the practice issues *before*
// delivering supports, while a service agreement is the contract that changes
// only when the plan, the provider or the agreed supports change.
//
// It is stored as a header (patient_service_agreements) plus a "Schedule of
// Supports" of priced lines (service_agreement_items), the same shape as the
// Quotes feature, so an agreement can be created standalone or derived from a
// quote whose approved lines are copied onto its schedule.
//
// Kept free of Node-only APIs so the API routes and the admin panel share the
// same validation, normalisation and totals logic.

import {
    DEFAULT_FUNDING_TYPE,
    FUNDING_TYPES,
    buildQuoteLineMetrics,
    cleanNullableString,
    cleanOptionalText,
    cleanString,
    computeQuoteTotals,
    formatDateValue,
    parseDateOnly,
    parseMetadataValue,
    parseNonNegativeNumber,
    parseQuoteItemFields,
    patientExists,
    referenceNumberLabelFor,
    resolvePatientFundingContext,
    resolveQuoteItemUpdates,
    resolveRouteParams,
    toBool,
    toFinite,
    validateId,
} from './patientQuotes.js'

export const SERVICE_AGREEMENT_STATUSES = new Set(['draft', 'sent', 'active', 'terminated', 'superseded', 'expired'])

/** Statuses where the agreement has already ended, so expiry no longer applies. */
export const ENDED_SERVICE_AGREEMENT_STATUSES = ['terminated', 'superseded']

export const PLAN_MANAGEMENT_TYPES = new Set(['self_managed', 'plan_managed', 'ndia_managed', 'unknown'])

export const DEFAULT_SERVICE_AGREEMENT_STATUS = 'draft'
export const DEFAULT_PLAN_MANAGEMENT_TYPE = 'unknown'

/**
 * The NDIS default short-notice cancellation window. The pricing arrangements let
 * a provider claim for a cancellation (or no show) with less than two clear
 * business days' notice, "subject to the terms of the service agreement".
 */
export const DEFAULT_CANCELLATION_NOTICE_DAYS = 2
export const MAX_CANCELLATION_NOTICE_DAYS = 365

export {
    DEFAULT_FUNDING_TYPE,
    buildQuoteLineMetrics,
    cleanNullableString,
    cleanOptionalText,
    cleanString,
    formatDateValue,
    parseDateOnly,
    parseMetadataValue,
    parseQuoteItemFields,
    patientExists,
    referenceNumberLabelFor,
    resolvePatientFundingContext,
    resolveQuoteItemUpdates,
    resolveRouteParams,
    toBool,
    toFinite,
    validateId,
}

export function isNdisPlanManagement(planManagementType) {
    return cleanString(planManagementType).toLowerCase() === 'ndia_managed'
}

export function parseNoticeDays(value, fallback = DEFAULT_CANCELLATION_NOTICE_DAYS) {
    const raw = cleanString(value)
    if (raw === '') return fallback

    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    return Math.min(parsed, MAX_CANCELLATION_NOTICE_DAYS)
}

/**
 * Resolves the signature timestamp for a party. Accepts an explicit date, the
 * literal `now` (used when a signature is captured in the UI), or null to clear
 * it. Anything else is rejected so a typo cannot silently clear a signature.
 */
export function parseSignatureTimestamp(value) {
    if (value === null || value === undefined || value === '') return { value: null, valid: true }
    if (typeof value === 'boolean') return { value: null, valid: false }

    const text = cleanString(value)
    if (!text) return { value: null, valid: true }
    if (text.toLowerCase() === 'now') return { value: new Date().toISOString(), valid: true }

    const parsed = new Date(text)
    return Number.isFinite(parsed.getTime())
        ? { value: parsed.toISOString(), valid: true }
        : { value: null, valid: false }
}

export function normalizeServiceAgreementRow(row) {
    if (!row || typeof row !== 'object') return row

    const subtotal = toFinite(row.subtotal)

    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        plan_management_type: PLAN_MANAGEMENT_TYPES.has(cleanString(row.plan_management_type).toLowerCase())
            ? cleanString(row.plan_management_type).toLowerCase()
            : DEFAULT_PLAN_MANAGEMENT_TYPE,
        cancellation_notice_days: Math.trunc(toFinite(row.cancellation_notice_days)),
        telehealth_authorised: toBool(row.telehealth_authorised),
        non_face_to_face_authorised: toBool(row.non_face_to_face_authorised),
        travel_claimable: toBool(row.travel_claimable),
        version: Math.max(Math.trunc(toFinite(row.version)) || 1, 1),
        item_count: Math.trunc(toFinite(row.item_count)),
        subtotal,
        total: subtotal,
        is_expired: toBool(row.is_expired),
        source_quote_id: validateId(row.source_quote_id),
        supersedes_agreement_id: validateId(row.supersedes_agreement_id),
        plan_start: formatDateValue(row.plan_start),
        plan_end: formatDateValue(row.plan_end),
        start_date: formatDateValue(row.start_date),
        end_date: formatDateValue(row.end_date),
        review_date: formatDateValue(row.review_date),
    }
}

export function normalizeServiceAgreementItemRow(row) {
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
        line_total: buildQuoteLineMetrics({ quantity, unit_price: unitPrice, price_limit: priceLimit }).lineTotal,
    }
}

/**
 * The next `SA-nnnn` number for a domain. Like the quote numbering, it is derived
 * from the stored numbers rather than a sequence so a domain that already has
 * hand-numbered agreements continues from there.
 */
export async function nextServiceAgreementNumber(connection, domain) {
    const result = await connection.query(
        'SELECT agreement_number FROM patient_service_agreements WHERE domain = $1',
        [domain]
    )

    const existing = new Set(
        (result.rows || [])
            .map((row) => cleanNullableString(row?.agreement_number, 120))
            .filter(Boolean)
    )

    let maxSeq = 0
    existing.forEach((value) => {
        const match = /^SA-(\d+)$/i.exec(value)
        if (match) {
            maxSeq = Math.max(maxSeq, Number.parseInt(match[1], 10))
        }
    })

    let seq = maxSeq > 0 ? maxSeq + 1 : existing.size + 1
    let candidate = `SA-${String(seq).padStart(4, '0')}`
    while (existing.has(candidate)) {
        seq += 1
        candidate = `SA-${String(seq).padStart(4, '0')}`
    }
    return candidate
}

/**
 * SELECT fragment for the derived agreement projection (schedule size, the
 * schedule's subtotal and the expiry flag).
 */
export function buildServiceAgreementTotalsSelect() {
    return {
        dateExpr: (column) => `to_char(${column}, 'YYYY-MM-DD')`,
        itemCountExpr: `COALESCE((SELECT COUNT(*) FROM service_agreement_items sai WHERE sai.agreement_id = sa.id AND sai.domain = sa.domain), 0) AS item_count`,
        subtotalExpr: `COALESCE((SELECT SUM(sai.quantity * sai.unit_price) FROM service_agreement_items sai WHERE sai.agreement_id = sa.id AND sai.domain = sa.domain), 0) AS subtotal`,
        expiredExpr: `(sa.end_date IS NOT NULL AND sa.end_date < CURRENT_DATE) AS is_expired`,
    }
}

/**
 * The full agreement projection used by every service-agreements route: header
 * columns, the patient's name and the derived schedule totals. Kept here so the
 * list, detail and item endpoints cannot drift apart.
 */
export function buildServiceAgreementSelect() {
    const totals = buildServiceAgreementTotalsSelect()
    const date = totals.dateExpr

    const columns = `
        sa.id, sa.domain, sa.patient_id, pt.patient_name, sa.agreement_number, sa.status,
        sa.funding_type, sa.plan_management_type, sa.plan_manager, sa.ndis_number,
        sa.plan_start, sa.plan_end, sa.start_date, sa.end_date, sa.review_date,
        sa.prepared_by, sa.cancellation_notice_days, sa.cancellation_policy,
        sa.telehealth_authorised, sa.non_face_to_face_authorised, sa.travel_claimable,
        sa.terms, sa.source_quote_id, sa.version, sa.supersedes_agreement_id,
        sa.participant_signatory_name, sa.participant_signed_at, sa.representative_name,
        sa.representative_relationship, sa.representative_signed_at,
        sa.provider_signatory_name, sa.provider_signed_at, sa.terminated_at,
        sa.termination_reason, sa.notes, sa.metadata, sa.created_at, sa.updated_at,
        sa.external_id, sa.external_source, sa.external_patient_id
    `
        .replaceAll('sa.plan_start', `${date('sa.plan_start')} AS plan_start`)
        .replaceAll('sa.plan_end', `${date('sa.plan_end')} AS plan_end`)
        .replaceAll('sa.start_date', `${date('sa.start_date')} AS start_date`)
        .replaceAll('sa.end_date', `${date('sa.end_date')} AS end_date`)
        .replaceAll('sa.review_date', `${date('sa.review_date')} AS review_date`)

    return `
        SELECT ${columns},
               ${totals.itemCountExpr},
               ${totals.subtotalExpr},
               ${totals.expiredExpr}
        FROM patient_service_agreements sa
        LEFT JOIN patients pt ON pt.id = sa.patient_id AND pt.domain = sa.domain
    `
}

/** The priced schedule of supports for an agreement, ordered for display. */
export const SERVICE_AGREEMENT_ITEM_COLUMNS = `
    id, domain, agreement_id, patient_id, position, ndis_support_item_number,
    ndis_support_item_name, registration_group_number, registration_group_name,
    support_category_number, support_category_name, unit, quantity, unit_price,
    price_limit, quote_required, description, metadata, created_at, updated_at
`

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

export function parseServiceAgreementFields(payload) {
    const status = cleanString(payload?.status).toLowerCase()
    const fundingType = cleanString(payload?.funding_type).toLowerCase()
    const planManagementType = cleanString(payload?.plan_management_type).toLowerCase()

    if (status && !SERVICE_AGREEMENT_STATUSES.has(status)) {
        return { value: null, error: 'status must be one of: draft, sent, active, terminated, superseded, expired' }
    }
    if (fundingType && !FUNDING_TYPES.has(fundingType)) {
        return { value: null, error: 'funding_type must be one of: ndis, private, other' }
    }
    if (planManagementType && !PLAN_MANAGEMENT_TYPES.has(planManagementType)) {
        return { value: null, error: 'plan_management_type must be one of: self_managed, plan_managed, ndia_managed, unknown' }
    }

    const sourceQuoteId = payload?.source_quote_id === undefined || payload?.source_quote_id === null || payload?.source_quote_id === ''
        ? null
        : validateId(payload.source_quote_id)
    if (payload?.source_quote_id !== undefined && payload?.source_quote_id !== null && payload?.source_quote_id !== '' && !sourceQuoteId) {
        return { value: null, error: 'source_quote_id must be a positive integer' }
    }

    const participantSignature = parseSignatureTimestamp(payload?.participant_signed_at)
    const representativeSignature = parseSignatureTimestamp(payload?.representative_signed_at)
    const providerSignature = parseSignatureTimestamp(payload?.provider_signed_at)
    if (!participantSignature.valid || !representativeSignature.valid || !providerSignature.valid) {
        return { value: null, error: 'Signature dates must be a valid date/time, "now", or null' }
    }

    return {
        value: {
            agreement_number: cleanNullableString(payload?.agreement_number, 120),
            status: status || DEFAULT_SERVICE_AGREEMENT_STATUS,
            funding_type: fundingType || DEFAULT_FUNDING_TYPE,
            plan_management_type: planManagementType || DEFAULT_PLAN_MANAGEMENT_TYPE,
            plan_manager: cleanNullableString(payload?.plan_manager, 255),
            ndis_number: cleanNullableString(payload?.ndis_number, 64),
            plan_start: parseDateOnly(payload?.plan_start),
            plan_end: parseDateOnly(payload?.plan_end),
            start_date: parseDateOnly(payload?.start_date),
            end_date: parseDateOnly(payload?.end_date),
            review_date: parseDateOnly(payload?.review_date),
            prepared_by: cleanNullableString(payload?.prepared_by, 255),
            cancellation_notice_days: parseNoticeDays(payload?.cancellation_notice_days),
            cancellation_policy: cleanOptionalText(payload?.cancellation_policy),
            telehealth_authorised: toBool(payload?.telehealth_authorised),
            non_face_to_face_authorised: toBool(payload?.non_face_to_face_authorised),
            travel_claimable: toBool(payload?.travel_claimable),
            terms: cleanOptionalText(payload?.terms),
            source_quote_id: sourceQuoteId,
            version: Math.max(Math.trunc(parseNonNegativeNumber(payload?.version)) || 1, 1),
            supersedes_agreement_id: validateId(payload?.supersedes_agreement_id),
            participant_signatory_name: cleanNullableString(payload?.participant_signatory_name, 255),
            participant_signed_at: participantSignature.value,
            representative_name: cleanNullableString(payload?.representative_name, 255),
            representative_relationship: cleanNullableString(payload?.representative_relationship, 120),
            representative_signed_at: representativeSignature.value,
            provider_signatory_name: cleanNullableString(payload?.provider_signatory_name, 255),
            provider_signed_at: providerSignature.value,
            terminated_at: parseSignatureTimestamp(payload?.terminated_at).value,
            termination_reason: cleanOptionalText(payload?.termination_reason),
            notes: cleanOptionalText(payload?.notes),
            metadata: payload?.metadata === undefined ? null : payload?.metadata,
        },
        error: null,
    }
}

/**
 * Resolves the mutable agreement fields present in a PATCH payload into
 * `{ key, value }` updates, validating the closed vocabularies. Mirrors the quote
 * update helper so the route stays a thin wrapper.
 */
export function resolveServiceAgreementUpdates(payload) {
    const errors = []
    const updates = []

    const pushIfPresent = (key, transform = (value) => value) => {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) return
        updates.push({ key, value: transform(payload[key]) })
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
        const status = cleanString(payload.status).toLowerCase()
        if (!SERVICE_AGREEMENT_STATUSES.has(status)) {
            errors.push('status must be one of: draft, sent, active, terminated, superseded, expired')
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

    if (Object.prototype.hasOwnProperty.call(payload, 'plan_management_type')) {
        const planManagementType = cleanString(payload.plan_management_type).toLowerCase()
        if (!PLAN_MANAGEMENT_TYPES.has(planManagementType)) {
            errors.push('plan_management_type must be one of: self_managed, plan_managed, ndia_managed, unknown')
        } else {
            updates.push({ key: 'plan_management_type', value: planManagementType })
        }
    }

    pushIfPresent('agreement_number', (value) => cleanNullableString(value, 120))
    pushIfPresent('plan_manager', (value) => cleanNullableString(value, 255))
    pushIfPresent('ndis_number', (value) => cleanNullableString(value, 64))
    pushIfPresent('prepared_by', (value) => cleanNullableString(value, 255))
    pushIfPresent('participant_signatory_name', (value) => cleanNullableString(value, 255))
    pushIfPresent('representative_name', (value) => cleanNullableString(value, 255))
    pushIfPresent('representative_relationship', (value) => cleanNullableString(value, 120))
    pushIfPresent('provider_signatory_name', (value) => cleanNullableString(value, 255))

    pushIfPresent('cancellation_notice_days', (value) => parseNoticeDays(value))
    pushIfPresent('plan_start', parseDateOnly)
    pushIfPresent('plan_end', parseDateOnly)
    pushIfPresent('start_date', parseDateOnly)
    pushIfPresent('end_date', parseDateOnly)
    pushIfPresent('review_date', parseDateOnly)

    pushIfPresent('telehealth_authorised', toBool)
    pushIfPresent('non_face_to_face_authorised', toBool)
    pushIfPresent('travel_claimable', toBool)

    pushIfPresent('cancellation_policy', cleanOptionalText)
    pushIfPresent('terms', cleanOptionalText)
    pushIfPresent('termination_reason', cleanOptionalText)
    pushIfPresent('notes', cleanOptionalText)

    for (const key of ['participant_signed_at', 'representative_signed_at', 'provider_signed_at', 'terminated_at']) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
        const parsed = parseSignatureTimestamp(payload[key])
        if (!parsed.valid) {
            errors.push(`${key} must be a valid date/time, "now", or null`)
        } else {
            updates.push({ key, value: parsed.value })
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && typeof metadata !== 'object') {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

/** Totals for the schedule of supports. A service agreement is not a tax invoice, so no GST. */
export function computeServiceAgreementTotals(items) {
    return computeQuoteTotals(items, { gstApplicable: false })
}

/**
 * Maps a quote and its lines onto the fields of a service agreement and its
 * schedule. The caller supplies the remaining header defaults (number, dates,
 * status); everything that describes the *supports* is taken from the quote so
 * the agreement's schedule matches what the participant approved, with the price
 * limits frozen at the values copied across.
 */
export function buildServiceAgreementFromQuote(quote, items) {
    const rows = Array.isArray(items) ? items : []

    return {
        funding_type: cleanString(quote?.funding_type).toLowerCase() || DEFAULT_FUNDING_TYPE,
        plan_manager: cleanNullableString(quote?.plan_manager, 255),
        ndis_number: cleanNullableString(quote?.ndis_number, 64),
        prepared_by: cleanNullableString(quote?.prepared_by, 255),
        source_quote_id: validateId(quote?.id),
        items: rows.map((item, index) => ({
            position: index + 1,
            ndis_support_item_number: cleanNullableString(item?.ndis_support_item_number, 48),
            ndis_support_item_name: cleanNullableString(item?.ndis_support_item_name, 255),
            registration_group_number: cleanNullableString(item?.registration_group_number, 16),
            registration_group_name: cleanNullableString(item?.registration_group_name, 160),
            support_category_number: cleanNullableString(item?.support_category_number, 16),
            support_category_name: cleanNullableString(item?.support_category_name, 160),
            unit: cleanNullableString(item?.unit, 16),
            quantity: toFinite(item?.quantity),
            unit_price: toFinite(item?.unit_price),
            price_limit: item?.price_limit === null || item?.price_limit === undefined ? null : toFinite(item.price_limit),
            quote_required: toBool(item?.quote_required),
            description: cleanOptionalText(item?.description),
            metadata: item?.metadata ?? null,
        })),
    }
}
