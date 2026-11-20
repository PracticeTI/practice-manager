import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_CANCELLATION_NOTICE_DAYS,
    MAX_CANCELLATION_NOTICE_DAYS,
    PLAN_MANAGEMENT_TYPES,
    SERVICE_AGREEMENT_STATUSES,
    buildServiceAgreementFromQuote,
    buildServiceAgreementSelect,
    buildServiceAgreementTotalsSelect,
    computeServiceAgreementTotals,
    normalizeServiceAgreementItemRow,
    normalizeServiceAgreementRow,
    nextServiceAgreementNumber,
    parseNoticeDays,
    parseServiceAgreementFields,
    parseSignatureTimestamp,
    resolveServiceAgreementUpdates,
} from '../src/lib/patientServiceAgreements.js'
import {
    AGREEMENT_STATUS_LABELS,
    AGREEMENT_STATUS_PILL_STYLES,
    PLAN_MANAGEMENT_TYPE_OPTIONS,
    buildServiceAgreementMetrics,
    deriveServiceAgreementStatus,
    describeServiceAgreementSummary,
    formatAgreementNumberPreview,
    planManagementTypeLabel,
    resolveSignatureState,
    selectServiceAgreementAttentionItems,
} from '../src/lib/patientServiceAgreementDisplay.js'

const AGREEMENT_NUMBER = (number) => `SA-${String(number).padStart(4, '0')}`

test('agreement statuses and plan-management types are closed vocabularies', () => {
    for (const status of ['draft', 'sent', 'active', 'terminated', 'superseded', 'expired']) {
        assert.ok(SERVICE_AGREEMENT_STATUSES.has(status), `${status} should be a known status`)
    }
    assert.ok(!SERVICE_AGREEMENT_STATUSES.has('signed'))

    for (const type of ['self_managed', 'plan_managed', 'ndia_managed', 'unknown']) {
        assert.ok(PLAN_MANAGEMENT_TYPES.has(type))
    }
    // Every status has a label, a pill style and an option, so the UI cannot render a blank.
    for (const status of SERVICE_AGREEMENT_STATUSES) {
        assert.ok(AGREEMENT_STATUS_LABELS[status], `missing label for ${status}`)
        assert.ok(AGREEMENT_STATUS_PILL_STYLES[status], `missing pill style for ${status}`)
    }
    assert.equal(DEFAULT_CANCELLATION_NOTICE_DAYS, 2)
    assert.deepEqual(
        PLAN_MANAGEMENT_TYPE_OPTIONS.map((option) => option.value),
        ['unknown', 'self_managed', 'plan_managed', 'ndia_managed']
    )
})

test('parseServiceAgreementFields applies defaults and validates enums', () => {
    const parsed = parseServiceAgreementFields({
        agreement_number: ' SA-0007 ',
        funding_type: 'NDIS',
        plan_management_type: 'PLAN_MANAGED',
        ndis_number: '43123456',
        start_date: '2026-07-01',
        end_date: '2027-06-30',
        review_date: 'not-a-date',
        cancellation_notice_days: '5',
        telehealth_authorised: 'true',
    })

    assert.equal(parsed.error, null)
    assert.equal(parsed.value.agreement_number, 'SA-0007')
    assert.equal(parsed.value.funding_type, 'ndis')
    assert.equal(parsed.value.plan_management_type, 'plan_managed')
    assert.equal(parsed.value.status, 'draft')
    assert.equal(parsed.value.start_date, '2026-07-01')
    assert.equal(parsed.value.end_date, '2027-06-30')
    assert.equal(parsed.value.review_date, null)
    assert.equal(parsed.value.cancellation_notice_days, 5)
    assert.equal(parsed.value.telehealth_authorised, true)
    assert.equal(parsed.value.non_face_to_face_authorised, false)

    const defaults = parseServiceAgreementFields({})
    assert.equal(defaults.value.status, 'draft')
    assert.equal(defaults.value.funding_type, 'ndis')
    assert.equal(defaults.value.plan_management_type, 'unknown')
    assert.equal(defaults.value.version, 1)
    assert.equal(defaults.value.cancellation_notice_days, DEFAULT_CANCELLATION_NOTICE_DAYS)

    assert.match(parseServiceAgreementFields({ status: 'signed' }).error, /status must be one of/)
    assert.match(parseServiceAgreementFields({ funding_type: 'dva' }).error, /funding_type must be one of/)
    assert.match(parseServiceAgreementFields({ plan_management_type: 'self' }).error, /plan_management_type must be one of/)
    assert.match(parseServiceAgreementFields({ source_quote_id: 'abc' }).error, /source_quote_id/)
    assert.match(parseServiceAgreementFields({ participant_signed_at: 'yesterday-ish' }).error, /Signature dates/)
})

test('parseNoticeDays clamps to the supported range and falls back on nonsense', () => {
    assert.equal(parseNoticeDays('7'), 7)
    assert.equal(parseNoticeDays('0'), 0)
    assert.equal(parseNoticeDays(''), DEFAULT_CANCELLATION_NOTICE_DAYS)
    assert.equal(parseNoticeDays('abc'), DEFAULT_CANCELLATION_NOTICE_DAYS)
    assert.equal(parseNoticeDays('-4'), DEFAULT_CANCELLATION_NOTICE_DAYS)
    assert.equal(parseNoticeDays('9999'), MAX_CANCELLATION_NOTICE_DAYS)
})

test('parseSignatureTimestamp accepts a date, the literal now, and clears', () => {
    assert.deepEqual(parseSignatureTimestamp(null), { value: null, valid: true })
    assert.deepEqual(parseSignatureTimestamp(''), { value: null, valid: true })

    const now = parseSignatureTimestamp('now')
    assert.equal(now.valid, true)
    assert.ok(!Number.isNaN(new Date(now.value).getTime()))

    const dated = parseSignatureTimestamp('2026-09-01T00:00:00.000Z')
    assert.equal(dated.value, '2026-09-01T00:00:00.000Z')

    assert.equal(parseSignatureTimestamp('not a date').valid, false)
    assert.equal(parseSignatureTimestamp(true).valid, false)
})

test('resolveServiceAgreementUpdates returns partial validated updates', () => {
    const { updates, errors } = resolveServiceAgreementUpdates({
        status: 'ACTIVE',
        cancellation_notice_days: '3',
        travel_claimable: 'true',
        provider_signed_at: 'now',
        end_date: '2027-01-31',
    })

    assert.deepEqual(errors, [])
    const byKey = Object.fromEntries(updates.map((update) => [update.key, update.value]))
    assert.equal(byKey.status, 'active')
    assert.equal(byKey.cancellation_notice_days, 3)
    assert.equal(byKey.travel_claimable, true)
    assert.equal(byKey.end_date, '2027-01-31')
    assert.ok(!Number.isNaN(new Date(byKey.provider_signed_at).getTime()))

    assert.equal(resolveServiceAgreementUpdates({ status: 'signed' }).errors.length, 1)
    assert.equal(resolveServiceAgreementUpdates({ metadata: 'nope' }).errors[0], 'metadata must be an object or null')
    assert.deepEqual(resolveServiceAgreementUpdates({}).updates, [])
})

test('normalizeServiceAgreementRow coerces stored values for the client', () => {
    const row = normalizeServiceAgreementRow({
        agreement_number: 'SA-0001',
        plan_management_type: 'PLAN_MANAGED',
        cancellation_notice_days: '2',
        telehealth_authorised: 't',
        version: 0,
        item_count: '3',
        subtotal: '386.5',
        is_expired: 1,
        start_date: new Date(2026, 6, 1),
        end_date: '2027-06-30',
        review_date: null,
        source_quote_id: '12',
        metadata: '{"origin":"test"}',
    })

    assert.equal(row.plan_management_type, 'plan_managed')
    assert.equal(row.cancellation_notice_days, 2)
    assert.equal(row.telehealth_authorised, true)
    assert.equal(row.version, 1)
    assert.equal(row.item_count, 3)
    assert.equal(row.subtotal, 386.5)
    assert.equal(row.total, 386.5)
    assert.equal(row.is_expired, true)
    assert.equal(row.start_date, '2026-07-01')
    assert.equal(row.end_date, '2027-06-30')
    assert.equal(row.review_date, null)
    assert.equal(row.source_quote_id, 12)
    assert.deepEqual(row.metadata, { origin: 'test' })

    // An unrecognised plan-management type is reported as "not recorded".
    assert.equal(normalizeServiceAgreementRow({ plan_management_type: 'bogus' }).plan_management_type, 'unknown')
})

test('normalizeServiceAgreementItemRow derives the line total', () => {
    const row = normalizeServiceAgreementItemRow({
        quantity: '6',
        unit_price: '193.99',
        price_limit: '193.99',
        metadata: null,
    })

    assert.equal(row.quantity, 6)
    assert.equal(row.unit_price, 193.99)
    assert.equal(row.price_limit, 193.99)
    assert.equal(row.line_total, 1163.94)

    // A zero/blank limit means "quoted support", which is never a limit.
    assert.equal(normalizeServiceAgreementItemRow({ quantity: 1, unit_price: 10, price_limit: 0 }).price_limit, null)
})

test('computeServiceAgreementTotals sums the schedule and counts limit breaches', () => {
    const totals = computeServiceAgreementTotals([
        { quantity: 6, unit_price: 193.99, price_limit: 193.99 },
        { quantity: 1, unit_price: 250, price_limit: 200 },
        { quantity: 1, unit_price: 100, price_limit: null },
    ])

    assert.equal(totals.itemCount, 3)
    assert.equal(totals.subtotal, 1513.94)
    // A service agreement is not a tax invoice, so GST never applies.
    assert.equal(totals.gst, 0)
    assert.equal(totals.total, 1513.94)
    assert.equal(totals.overLimitCount, 1)
    assert.equal(totals.quotedLineCount, 1)
})

test('buildServiceAgreementFromQuote copies the approved supports and keeps the link', () => {
    const derived = buildServiceAgreementFromQuote(
        {
            id: '42',
            funding_type: 'NDIS',
            plan_manager: 'Provider Plan Managers',
            ndis_number: '43123456',
            prepared_by: 'J. Smith',
        },
        [
            {
                ndis_support_item_number: '15_617_0128_1_3',
                ndis_support_item_name: 'Occupational therapy',
                registration_group_number: '12',
                registration_group_name: 'Therapeutic supports',
                unit: 'H',
                quantity: '6',
                unit_price: '193.99',
                price_limit: '193.99',
                quote_required: true,
                description: null,
                metadata: { origin: 'quote-writer' },
            },
            { description: 'Travel', quantity: 2, unit_price: 97, price_limit: null },
        ]
    )

    assert.equal(derived.funding_type, 'ndis')
    assert.equal(derived.plan_manager, 'Provider Plan Managers')
    assert.equal(derived.ndis_number, '43123456')
    assert.equal(derived.source_quote_id, 42)
    assert.equal(derived.items.length, 2)
    assert.equal(derived.items[0].position, 1)
    assert.equal(derived.items[1].position, 2)
    assert.equal(derived.items[0].ndis_support_item_number, '15_617_0128_1_3')
    assert.equal(derived.items[0].quantity, 6)
    assert.equal(derived.items[0].price_limit, 193.99)
    assert.equal(derived.items[0].quote_required, true)
    assert.deepEqual(derived.items[0].metadata, { origin: 'quote-writer' })
    assert.equal(derived.items[1].price_limit, null)
})

test('nextServiceAgreementNumber continues from the highest stored SA number', async () => {
    const connection = {
        query: async () => ({
            rows: [
                { agreement_number: 'SA-0001' },
                { agreement_number: 'SA-0003' },
                { agreement_number: 'CUSTOM-1' },
            ],
        }),
    }

    assert.equal(await nextServiceAgreementNumber(connection, 'domain-a'), 'SA-0004')

    const emptyConnection = { query: async () => ({ rows: [] }) }
    assert.equal(await nextServiceAgreementNumber(emptyConnection, 'domain-a'), AGREEMENT_NUMBER(1))
})

test('the quote select exposes the derived schedule totals and expiry flag', () => {
    const select = buildServiceAgreementSelect()
    assert.match(select, /FROM patient_service_agreements sa/)
    assert.match(select, /LEFT JOIN patients pt ON pt\.id = sa\.patient_id/)
    assert.match(select, /AS item_count/)
    assert.match(select, /AS subtotal/)
    assert.match(select, /AS is_expired/)

    const totals = buildServiceAgreementTotalsSelect()
    assert.match(totals.itemCountExpr, /service_agreement_items sai/)
    assert.match(totals.expiredExpr, /sa\.end_date < CURRENT_DATE/)
})

test('deriveServiceAgreementStatus reports expired without mutating the stored status', () => {
    assert.equal(deriveServiceAgreementStatus({ status: 'active', is_expired: true }), 'expired')
    assert.equal(deriveServiceAgreementStatus({ status: 'draft', is_expired: true }), 'expired')
    // A superseded or terminated agreement keeps its outcome even past its end date.
    assert.equal(deriveServiceAgreementStatus({ status: 'terminated', is_expired: true }), 'terminated')
    assert.equal(deriveServiceAgreementStatus({ status: 'superseded', is_expired: true }), 'superseded')
    assert.equal(deriveServiceAgreementStatus({ status: 'active', is_expired: false }), 'active')
    assert.equal(deriveServiceAgreementStatus({}), 'draft')
})

test('resolveSignatureState treats either participant-side signature as sufficient', () => {
    assert.deepEqual(resolveSignatureState({}), {
        participantSigned: false,
        representativeSigned: false,
        providerSigned: false,
        participantSideSigned: false,
        anySigned: false,
        fullySigned: false,
    })

    const representative = resolveSignatureState({ representative_signed_at: '2026-09-01T00:00:00Z', provider_signed_at: '2026-09-02T00:00:00Z' })
    assert.equal(representative.fullySigned, true)
    assert.equal(representative.representativeSigned, true)
    assert.equal(representative.participantSigned, false)

    const halfSigned = resolveSignatureState({ participant_signed_at: '2026-09-01T00:00:00Z' })
    assert.equal(halfSigned.anySigned, true)
    assert.equal(halfSigned.fullySigned, false)
})

test('buildServiceAgreementMetrics ranks what needs attention', () => {
    const now = new Date(2026, 8, 15)

    const expired = buildServiceAgreementMetrics({ status: 'active', is_expired: true, item_count: 2, subtotal: 100, end_date: '2026-06-30' }, now)
    assert.equal(expired.status, 'expired')
    assert.equal(expired.attention.rank, 0)

    const awaitingSignature = buildServiceAgreementMetrics({ status: 'sent', end_date: '2027-06-30' }, now)
    assert.equal(awaitingSignature.attention.rank, 1)
    assert.equal(awaitingSignature.awaitingSignature, true)

    const reviewDue = buildServiceAgreementMetrics({ status: 'active', review_date: '2026-09-01', end_date: '2027-06-30', provider_signed_at: 'x', participant_signed_at: 'x' }, now)
    assert.equal(reviewDue.attention.rank, 2)
    assert.equal(reviewDue.reviewDue, true)

    const expiringSoon = buildServiceAgreementMetrics({ status: 'active', end_date: '2026-10-05', provider_signed_at: 'x', participant_signed_at: 'x' }, now)
    assert.equal(expiringSoon.attention.rank, 3)
    assert.equal(expiringSoon.expiringSoon, true)

    // A healthy long-running agreement has nothing to say.
    const quiet = buildServiceAgreementMetrics({ status: 'active', end_date: '2027-06-30', provider_signed_at: 'x', participant_signed_at: 'x' }, now)
    assert.equal(quiet.attention, null)
})

test('selectServiceAgreementAttentionItems orders by rank then soonest to end', () => {
    const now = new Date(2026, 8, 15)
    const rows = [
        { id: 1, status: 'active', end_date: '2026-10-01', provider_signed_at: 'x', participant_signed_at: 'x' },
        { id: 2, status: 'active', is_expired: true, end_date: '2026-01-01' },
        { id: 3, status: 'sent', end_date: '2027-06-30' },
        { id: 4, status: 'active', end_date: '2027-06-30', provider_signed_at: 'x', participant_signed_at: 'x' },
    ]

    const ranked = selectServiceAgreementAttentionItems(rows, { now, limit: 3 })
    assert.deepEqual(ranked.map((entry) => entry.row.id), [2, 3, 1])
})

test('describeServiceAgreementSummary and the number preview are stable copy', () => {
    const row = { agreement_number: 'SA-0004', plan_management_type: 'ndia_managed', end_date: '2027-06-30' }
    const summary = describeServiceAgreementSummary(row, buildServiceAgreementMetrics({ ...row, item_count: 2, subtotal: 500 }, new Date(2026, 8, 15)))

    assert.match(summary, /SA-0004/)
    assert.match(summary, /2 supports · \$500\.00/)
    assert.match(summary, /NDIA-managed/)

    assert.equal(formatAgreementNumberPreview(7), 'SA-0007')
    assert.equal(formatAgreementNumberPreview(null), 'SA-0001')
    assert.equal(planManagementTypeLabel('plan_managed'), 'Plan-managed')
    assert.equal(planManagementTypeLabel('nonsense'), 'Not recorded')
})
