import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_NDIS_PRICING_REGION,
    NDIS_SUPPORT_ITEMS,
    buildNdisQuoteLine,
    formatNdisPriceLimit,
    formatNdisSupportItemOption,
    getNdisPriceLimit,
    isNdisQuoteRequired,
    normalizeNdisPricingRegion,
    resolveNdisSupportItemSelection,
    searchNdisSupportItems,
} from '../src/lib/ndisSupportCatalogue.js'
import {
    buildQuoteLineMetrics,
    buildQuoteSelect,
    computeQuoteTotals,
    isNdisFunding,
    normalizeQuoteRow,
    parseQuoteFields,
    parseQuoteItemFields,
    referenceNumberLabelFor,
    resolvePatientFundingContext,
    resolveQuoteUpdates,
} from '../src/lib/patientQuotes.js'
import {
    buildQuoteMetrics,
    deriveQuoteStatus,
    describeQuoteLine,
    describeQuoteSummary,
    formatCurrency,
    formatQuantity,
    selectQuoteAttentionItems,
} from '../src/lib/patientQuoteDisplay.js'

// The figures below are transcribed from the official NDIS support catalogue
// 2026-27 (media/8038) — the test doubles as the contract for the curated table,
// so a typo in a price is caught here rather than on a participant's quote.
const OT_DIRECT_SERVICE = '15_617_0128_1_3'
const OT_PROVIDER_TRAVEL = '15_617_0128_1_3_PT'
const HOME_MOD_CEILING_HOIST = '06_123615401_0111_2_2'

test('catalogue carries the published price limits for OT supports', () => {
    assert.equal(getNdisPriceLimit(OT_DIRECT_SERVICE, 'national'), 193.99)
    assert.equal(getNdisPriceLimit(OT_DIRECT_SERVICE, 'remote'), 271.59)
    assert.equal(getNdisPriceLimit(OT_DIRECT_SERVICE, 'very_remote'), 290.99)

    assert.equal(getNdisPriceLimit(OT_PROVIDER_TRAVEL, 'national'), 97)
    assert.equal(getNdisPriceLimit(OT_PROVIDER_TRAVEL, 'remote'), 135.8)
    assert.equal(getNdisPriceLimit(OT_PROVIDER_TRAVEL, 'very_remote'), 145.5)
})

test('price limit lookup is tolerant of case and unknown regions', () => {
    assert.equal(getNdisPriceLimit('15_617_0128_1_3', 'remote'), 271.59)
    assert.equal(getNdisPriceLimit('15_617_0128_1_3', 'not-a-region'), 193.99)
    assert.equal(normalizeNdisPricingRegion('Very_Remote'), 'very_remote')
    assert.equal(normalizeNdisPricingRegion(''), DEFAULT_NDIS_PRICING_REGION)
    assert.equal(getNdisPriceLimit('99_999_9999_9_9', 'national'), null)
})

test('supports the NDIS quotes have no price limit', () => {
    assert.equal(getNdisPriceLimit(HOME_MOD_CEILING_HOIST, 'national'), null)
    assert.equal(formatNdisPriceLimit(HOME_MOD_CEILING_HOIST, 'national'), 'Quote required')
    assert.equal(isNdisQuoteRequired(HOME_MOD_CEILING_HOIST), true)

    // Therapy hours are price-limited, so they are never flagged as quote-only.
    assert.equal(isNdisQuoteRequired(OT_DIRECT_SERVICE), false)
    assert.equal(formatNdisPriceLimit(OT_DIRECT_SERVICE, 'national'), '$193.99')
})

test('a custom line whose number belongs to a quoted registration group is still flagged', () => {
    // 0111 is Home Modification Design And Construction, a "Quote = Yes" group,
    // even though this particular number is not in the curated table.
    assert.equal(isNdisQuoteRequired('06_999999999_0111_2_2'), true)
    assert.equal(isNdisQuoteRequired('15_999999999_0128_1_3'), false)
})

test('the picker resolves both the datalist label and a bare item number', () => {
    const direct = resolveNdisSupportItemSelection(OT_DIRECT_SERVICE)
    assert.equal(direct?.name, 'Therapy - Occupational Therapist - Direct Service')

    const labelled = resolveNdisSupportItemSelection(
        formatNdisSupportItemOption(direct)
    )
    assert.equal(labelled?.number, OT_DIRECT_SERVICE)

    assert.equal(resolveNdisSupportItemSelection('Custom bathroom grab rails'), null)
    assert.equal(resolveNdisSupportItemSelection(''), null)
})

test('buildNdisQuoteLine fills identity, unit and the regional price limit', () => {
    const line = buildNdisQuoteLine({ itemNumber: OT_DIRECT_SERVICE, region: 'remote' })

    assert.equal(line.ndis_support_item_number, OT_DIRECT_SERVICE)
    assert.equal(line.registration_group_number, '0128')
    assert.equal(line.registration_group_name, 'Therapeutic Supports')
    assert.equal(line.support_category_name, 'Improved Daily Living Skills')
    assert.equal(line.unit, 'H')
    assert.equal(line.quote_required, false)
    assert.equal(line.price_limit, 271.59)

    const quoted = buildNdisQuoteLine({ itemNumber: HOME_MOD_CEILING_HOIST })
    assert.equal(quoted.quote_required, true)
    assert.equal(quoted.price_limit, null)
    assert.equal(quoted.unit, 'E')

    assert.equal(buildNdisQuoteLine({ itemNumber: 'not-a-real-item' }), null)
})

test('search finds the OT therapy items', () => {
    const results = searchNdisSupportItems('occupational therapist - direct')
    assert.ok(results.length > 0)
    assert.ok(results.some((item) => item.number === OT_DIRECT_SERVICE))

    assert.equal(searchNdisSupportItems('0128', { limit: 100 }).length > 0, true)
})

test('catalogue rows are internally consistent', () => {
    const numbers = new Set()
    for (const item of NDIS_SUPPORT_ITEMS) {
        assert.equal(numbers.has(item.number), false, `duplicate support item ${item.number}`)
        numbers.add(item.number)

        assert.match(item.number, /^\d{2}_[0-9A-Za-z]+_\d{4}_/)
        assert.ok(item.name.length > 0)
        assert.ok(item.unit.length > 0)

        const { national, remote, very_remote: veryRemote } = item.priceLimits
        if (item.quoteRequired) {
            // Quoted supports are individually priced, so they carry no limit.
            assert.equal(national, 0)
            assert.equal(remote, 0)
            assert.equal(veryRemote, 0)
        } else {
            assert.ok(national > 0, `${item.number} needs a national price`)
            assert.ok(remote >= national, `${item.number} remote price must not be below national`)
            assert.ok(veryRemote >= remote, `${item.number} very remote price must not be below remote`)
        }
    }
})

test('quote totals add the lines up and flag price-limit breaches', () => {
    const totals = computeQuoteTotals([
        { quantity: 2, unit_price: 193.99, price_limit: 193.99 },
        { quantity: 3.5, unit_price: 97, price_limit: 97 },
    ])

    assert.equal(totals.itemCount, 2)
    assert.equal(totals.subtotal, 727.48)
    assert.equal(totals.total, 727.48)
    assert.equal(totals.gst, 0)
    assert.equal(totals.overLimitCount, 0)
    assert.equal(totals.quotedLineCount, 0)

    const over = computeQuoteTotals([
        { quantity: 1, unit_price: 220, price_limit: 193.99 },
        { quantity: 1, unit_price: 4500, price_limit: null },
    ])
    assert.equal(over.subtotal, 4720)
    assert.equal(over.overLimitCount, 1)
    assert.equal(over.quotedLineCount, 1)
})

test('GST only applies when the quote asks for it', () => {
    const lines = [{ quantity: 1, unit_price: 100 }]
    assert.equal(computeQuoteTotals(lines).total, 100)
    assert.equal(computeQuoteTotals(lines, { gstApplicable: true }).total, 110)
})

test('line metrics never treat a quoted (limitless) line as over the limit', () => {
    const quoted = buildQuoteLineMetrics({ quantity: 1, unit_price: 4500, price_limit: null })
    assert.equal(quoted.priceLimit, null)
    assert.equal(quoted.overLimit, false)

    const withinLimit = buildQuoteLineMetrics({ quantity: 3, unit_price: 193.99, price_limit: 193.99 })
    assert.equal(withinLimit.lineTotal, 581.97)
    assert.equal(withinLimit.overLimit, false)

    const above = buildQuoteLineMetrics({ quantity: 1, unit_price: 194, price_limit: 193.99 })
    assert.equal(above.overLimit, true)
    assert.equal(above.overLimitBy, 0.01)
})

test('quote lines must be quantified and identified', () => {
    const missingQuantity = parseQuoteItemFields({ ndis_support_item_name: 'Ceiling hoist' })
    assert.match(missingQuantity.error, /quantity/)

    const zeroQuantity = parseQuoteItemFields({ ndis_support_item_name: 'Ceiling hoist', quantity: 0 })
    assert.match(zeroQuantity.error, /quantity/)

    const unnamed = parseQuoteItemFields({ quantity: 1 })
    assert.match(unnamed.error, /support item or a description/)

    const negativePrice = parseQuoteItemFields({
        ndis_support_item_name: 'Ceiling hoist',
        quantity: 1,
        unit_price: -5,
    })
    assert.match(negativePrice.error, /unit_price/)
})

test('a parsed quote line normalises the catalogue fields', () => {
    const parsed = parseQuoteItemFields({
        quantity: '2',
        unit_price: '193.99',
        price_limit: '193.99',
        ndis_support_item_number: '15_617_0128_1_3',
        ndis_support_item_name: 'Therapy - Occupational Therapist - Direct Service',
        unit: 'h',
    })

    assert.equal(parsed.error, null)
    assert.equal(parsed.value.quantity, 2)
    assert.equal(parsed.value.unit_price, 193.99)
    assert.equal(parsed.value.price_limit, 193.99)
    // Item numbers are stored upper-case, matching the catalogue.
    assert.equal(parsed.value.ndis_support_item_number, '15_617_0128_1_3')
    // No explicit quote_required flag: derived from the support item.
    assert.equal(parsed.value.quote_required, false)
})

test('a line for a quoted support defaults to quote_required', () => {
    const parsed = parseQuoteItemFields({
        quantity: 1,
        unit_price: 4800,
        ndis_support_item_number: HOME_MOD_CEILING_HOIST,
        ndis_support_item_name: 'HM - Ceiling Hoist',
        unit: 'E',
    })

    assert.equal(parsed.error, null)
    assert.equal(parsed.value.quote_required, true)
    assert.equal(parsed.value.price_limit, null)
})

test('quote headers validate their enums and default sensibly', () => {
    const defaults = parseQuoteFields({})
    assert.equal(defaults.error, null)
    assert.equal(defaults.value.status, 'draft')
    assert.equal(defaults.value.funding_type, 'ndis')
    assert.equal(defaults.value.pricing_region, 'national')

    assert.match(parseQuoteFields({ status: 'pending' }).error, /status/)
    assert.match(parseQuoteFields({ funding_type: 'workcover' }).error, /funding_type/)
    assert.match(parseQuoteFields({ pricing_region: 'metro' }).error, /pricing_region/)
    assert.equal(parseQuoteFields({ status: 'accepted', funding_type: 'private' }).error, null)
})

test('partial quote updates only touch the fields provided', () => {
    const { updates, errors } = resolveQuoteUpdates({ status: 'sent', plan_manager: '   ' })
    assert.deepEqual(errors, [])
    assert.deepEqual(updates, [
        { key: 'status', value: 'sent' },
        { key: 'plan_manager', value: null },
    ])

    assert.deepEqual(resolveQuoteUpdates({ status: 'nope' }).errors, [
        'status must be one of: draft, sent, accepted, declined, expired',
    ])
})

test('normalising a stored quote derives its GST-inclusive total', () => {
    const withoutGst = normalizeQuoteRow({ subtotal: '727.48', item_count: '2', gst_applicable: false })
    assert.equal(withoutGst.subtotal, 727.48)
    assert.equal(withoutGst.item_count, 2)
    assert.equal(withoutGst.total, 727.48)

    const withGst = normalizeQuoteRow({ subtotal: 100, gst_applicable: 'true', is_expired: 'f' })
    assert.equal(withGst.gst_applicable, true)
    assert.equal(withGst.gst, 10)
    assert.equal(withGst.total, 110)
    assert.equal(withGst.is_expired, false)
})

test('the quote projection is built consistently for every route', () => {
    const select = buildQuoteSelect()
    assert.match(select, /FROM patient_quotes pq/)
    assert.match(select, /LEFT JOIN patients pt/)
    assert.match(select, /AS item_count/)
    assert.match(select, /AS subtotal/)
    assert.match(select, /AS over_limit_count/)
    assert.match(select, /AS is_expired/)
    assert.match(select, /AS valid_until/)
})

test('status is derived: expiry only applies to undecided quotes', () => {
    assert.equal(deriveQuoteStatus({ status: 'draft', is_expired: false }), 'draft')
    assert.equal(deriveQuoteStatus({ status: 'sent', is_expired: true }), 'expired')
    assert.equal(deriveQuoteStatus({ status: 'accepted', is_expired: true }), 'accepted')
    assert.equal(deriveQuoteStatus({ status: 'declined', is_expired: true }), 'declined')
    assert.equal(deriveQuoteStatus({}), 'draft')
})

test('a price-limit breach outranks expiry when ranking quotes', () => {
    const now = new Date(2026, 8, 28)

    const breach = buildQuoteMetrics(
        { status: 'sent', is_expired: true, valid_until: '2026-08-01', over_limit_count: 1 },
        now
    )
    assert.equal(breach.attention.rank, 0)
    assert.equal(breach.attention.tone, 'danger')
    assert.equal(breach.attention.label, 'Above price limit')

    const expired = buildQuoteMetrics(
        { status: 'sent', is_expired: true, valid_until: '2026-08-01', over_limit_count: 0 },
        now
    )
    assert.equal(expired.attention.rank, 1)
    assert.equal(expired.attention.label, 'Validity expired')

    const soon = buildQuoteMetrics({ status: 'draft', valid_until: '2026-10-05' }, now)
    assert.equal(soon.attention.rank, 2)
    assert.equal(soon.attention.label, 'Expires in 7d')
    assert.equal(soon.expiringSoon, true)

    const settled = buildQuoteMetrics({ status: 'accepted', valid_until: '2026-10-05' }, now)
    assert.equal(settled.attention, null)
    assert.equal(settled.awaitingDecision, false)
})

test('attention ordering puts breaches first and lapses before expiries', () => {
    const now = new Date(2026, 8, 28)
    const rows = [
        { id: 1, status: 'draft', valid_until: '2026-09-30', item_count: 1, subtotal: 10 },
        { id: 2, status: 'sent', is_expired: true, valid_until: '2026-09-01', item_count: 1, subtotal: 10 },
        { id: 3, status: 'sent', valid_until: '2026-12-01', over_limit_count: 2, item_count: 1, subtotal: 10 },
    ]

    assert.deepEqual(selectQuoteAttentionItems(rows, { now }).map((entry) => entry.row.id), [3, 2, 1])
    assert.deepEqual(selectQuoteAttentionItems(rows, { now, limit: 1 }).map((entry) => entry.row.id), [3])
})

test('money and quantities are formatted for a quote', () => {
    assert.equal(formatCurrency(727.48), '$727.48')
    assert.equal(formatQuantity(6, 'H'), '6 Hours')
    assert.equal(formatQuantity(1, 'H'), '1 Hour')
    assert.equal(formatQuantity(2.5, 'E'), '2.50 Each')

    assert.equal(
        describeQuoteLine({ quantity: 6, unit_price: 193.99, unit: 'H' }),
        '6 Hours @ $193.99 = $1,163.94'
    )

    const summary = describeQuoteSummary(
        { quote_number: 'QTE-0007' },
        { itemCount: 2, total: 727.48, status: 'sent', daysToValidity: 40, expiringSoon: false, attention: null }
    )
    assert.equal(summary, 'QTE-0007 • 2 lines · $727.48')
})

test('GST only applies to non-NDIS funding', () => {
    assert.equal(isNdisFunding('ndis'), true)
    assert.equal(isNdisFunding(' NDIS '), true)
    assert.equal(isNdisFunding('private'), false)
    assert.equal(isNdisFunding(undefined), false)
})

test('the participant number and funding come from the patient Info tab', () => {
    const ndis = resolvePatientFundingContext({
        answers: {
            funding_source_or_referral_type: 'NDIS',
            claim_or_reference_number: '430123456',
        },
    })
    assert.equal(ndis.referenceNumber, '430123456')
    assert.equal(ndis.fundingSource, 'NDIS')
    assert.equal(ndis.isNdis, true)
    assert.equal(ndis.fundingType, 'ndis')
    assert.equal(ndis.referenceLabel, 'NDIS participant number')

    // The same intake field carries TAC and WorkCover references, and those
    // quotes are not NDIS-funded.
    const tac = resolvePatientFundingContext({
        answers: { funding_source_or_referral_type: 'TAC', claim_or_reference_number: '88/10682' },
    })
    assert.equal(tac.referenceNumber, '88/10682')
    assert.equal(tac.isNdis, false)
    assert.equal(tac.fundingType, 'other')
    assert.equal(tac.referenceLabel, 'TAC claim number')
})

test('intake answers are read from the labelled fallback too', () => {
    const fromLabels = resolvePatientFundingContext({
        labelledAnswers: {
            'Funding source or referral type': 'WorkCover',
            'NDIS number/ TAC Claim Number/Work Cover Reference Number': 'WC-4471',
        },
    })
    assert.equal(fromLabels.fundingSource, 'WorkCover')
    assert.equal(fromLabels.referenceNumber, 'WC-4471')
    assert.equal(fromLabels.referenceLabel, 'WorkCover reference number')

    // A patient with nothing recorded leaves the caller's own defaults in place.
    const empty = resolvePatientFundingContext({})
    assert.equal(empty.referenceNumber, '')
    assert.equal(empty.fundingType, null)
    assert.equal(empty.referenceLabel, 'Participant / claim number')

    // The field id wins over a stale labelled answer.
    const both = resolvePatientFundingContext({
        answers: { claim_or_reference_number: '430999' },
        labelledAnswers: { 'NDIS number/ TAC Claim Number/Work Cover Reference Number': 'OLD' },
    })
    assert.equal(both.referenceNumber, '430999')
})

test('the intake number heading follows the funding scheme', () => {
    assert.equal(referenceNumberLabelFor('NDIS'), 'NDIS participant number')
    assert.equal(referenceNumberLabelFor('ndis'), 'NDIS participant number')
    assert.equal(referenceNumberLabelFor('TAC'), 'TAC claim number')
    assert.equal(referenceNumberLabelFor('WorkCover'), 'WorkCover reference number')
    assert.equal(referenceNumberLabelFor('Work Cover'), 'WorkCover reference number')
    assert.equal(referenceNumberLabelFor('DVA'), 'DVA file number')
    assert.equal(referenceNumberLabelFor('HCP/ My Aged Care'), 'Aged care reference number')
    assert.equal(referenceNumberLabelFor('Other'), 'Participant / claim number')
    assert.equal(referenceNumberLabelFor(''), 'Participant / claim number')
})
