import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    PLAN_MANAGEMENT_TYPES,
    SERVICE_AGREEMENT_ITEM_COLUMNS,
    buildServiceAgreementFromQuote,
    buildServiceAgreementSelect,
    cleanString,
    nextServiceAgreementNumber,
    normalizeServiceAgreementItemRow,
    normalizeServiceAgreementRow,
    parseDateOnly,
    toFinite,
    validateId,
} from '@/lib/patientServiceAgreements'

// Creates a service agreement from an accepted quote.
//
// A quote is the priced proposal the participant approved; the agreement is the
// contract that governs delivering those supports. This route copies the quote's
// schedule onto the agreement so the two documents agree on what was approved,
// and records `source_quote_id` so the agreement can still be traced back to the
// quote it came from. It is a static segment under /api/database/service-agreements,
// so it takes precedence over the /[id] dynamic route.

const DEFAULT_AGREEMENT_DAYS = 365
const DEFAULT_REVIEW_WINDOW_DAYS = 30

function toLocalDateString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(days || 0))
}

/**
 * Infers the NDIS plan-management type from the plan manager text the quote
 * carries, so the operator does not retype what is already on the record. The
 * participant or plan manager can still correct it.
 */
export function inferPlanManagementType(planManager) {
    const value = cleanString(planManager).toLowerCase()
    if (!value) return 'unknown'
    if (value.includes('ndia') || value.includes('agency')) return 'ndia_managed'
    if (value.includes('self')) return 'self_managed'
    if (value.includes('plan manager') || value.includes('plan-managed') || value.includes('plan managed')) return 'plan_managed'
    return 'unknown'
}

export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    let transactionStarted = false
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const quoteId = validateId(payload?.quote_id)
        if (!quoteId) {
            return NextResponse.json({ success: false, error: 'quote_id is required' }, { status: 400 })
        }

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const quoteResult = await connection.query(
            `${buildServiceAgreementQuoteSelect()} WHERE pq.id = $1 AND pq.domain = $2 LIMIT 1`,
            [quoteId, domain]
        )
        const quote = quoteResult.rows?.[0] || null
        if (!quote) {
            return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 })
        }

        const itemResult = await connection.query(
            `SELECT id, ndis_support_item_number, ndis_support_item_name, registration_group_number,
                    registration_group_name, support_category_number, support_category_name, unit,
                    quantity, unit_price, price_limit, quote_required, description, metadata
             FROM quote_items WHERE quote_id = $1 AND domain = $2
             ORDER BY position ASC, id ASC`,
            [quoteId, domain]
        )
        const quoteItems = itemResult.rows || []

        const derived = buildServiceAgreementFromQuote(quote, quoteItems)

        const today = new Date()
        const startDate = parseDateOnly(payload?.start_date) || toLocalDateString(today)
        const endDate = parseDateOnly(payload?.end_date) || toLocalDateString(addDays(today, DEFAULT_AGREEMENT_DAYS))
        const reviewDate = parseDateOnly(payload?.review_date)
            || toLocalDateString(addDays(addDays(today, DEFAULT_AGREEMENT_DAYS), -DEFAULT_REVIEW_WINDOW_DAYS))
        const requestedPlanManagement = cleanString(payload?.plan_management_type).toLowerCase()
        if (requestedPlanManagement && !PLAN_MANAGEMENT_TYPES.has(requestedPlanManagement)) {
            return NextResponse.json(
                { success: false, error: 'plan_management_type must be one of: self_managed, plan_managed, ndia_managed, unknown' },
                { status: 400 }
            )
        }
        const planManagementType = requestedPlanManagement || inferPlanManagementType(derived.plan_manager)

        await connection.query('BEGIN')
        transactionStarted = true

        const agreementNumber = await nextServiceAgreementNumber(connection, domain)
        const insertResult = await connection.query(
            `INSERT INTO patient_service_agreements (
                domain, patient_id, agreement_number, status, funding_type, plan_management_type,
                plan_manager, ndis_number, start_date, end_date, review_date, prepared_by,
                source_quote_id, version, notes
            ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)
            RETURNING id`,
            [
                domain, quote.patient_id, agreementNumber, derived.funding_type, planManagementType,
                derived.plan_manager, derived.ndis_number, startDate, endDate, reviewDate,
                derived.prepared_by, derived.source_quote_id,
                `Derived from quote ${cleanString(quote.quote_number) || `#${quoteId}`}.`,
            ]
        )
        const agreementId = insertResult.rows?.[0]?.id || null
        if (!agreementId) {
            throw new Error('Failed to create the service agreement')
        }

        for (const item of derived.items) {
            await connection.query(
                `INSERT INTO service_agreement_items (
                    domain, agreement_id, patient_id, position, ndis_support_item_number,
                    ndis_support_item_name, registration_group_number, registration_group_name,
                    support_category_number, support_category_name, unit, quantity, unit_price,
                    price_limit, quote_required, description, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
                [
                    domain, agreementId, quote.patient_id, item.position, item.ndis_support_item_number,
                    item.ndis_support_item_name, item.registration_group_number,
                    item.registration_group_name, item.support_category_number,
                    item.support_category_name, item.unit, toFinite(item.quantity),
                    toFinite(item.unit_price), item.price_limit, item.quote_required,
                    item.description, item.metadata === null ? null : JSON.stringify(item.metadata),
                ]
            )
        }

        const created = await connection.query(
            `${buildServiceAgreementSelect()} WHERE sa.id = $1 AND sa.domain = $2 LIMIT 1`,
            [agreementId, domain]
        )
        const createdAgreement = normalizeServiceAgreementRow(created.rows?.[0] || null)

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'service_agreement',
            entityId: agreementId,
            entityLabel: createdAgreement?.agreement_number || agreementNumber,
            patientId: quote.patient_id,
            patientName: createdAgreement?.patient_name || quote.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        const createdItems = await connection.query(
            `SELECT ${SERVICE_AGREEMENT_ITEM_COLUMNS} FROM service_agreement_items
             WHERE agreement_id = $1 AND domain = $2 ORDER BY position ASC, id ASC`,
            [agreementId, domain]
        )

        await connection.query('COMMIT')
        transactionStarted = false

        return NextResponse.json({
            success: true,
            agreement: createdAgreement,
            items: (createdItems.rows || []).map(normalizeServiceAgreementItemRow),
            copiedItemCount: derived.items.length,
        })
    } catch (error) {
        if (transactionStarted) {
            await connection?.query('ROLLBACK').catch(() => { })
        }
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create a service agreement from the quote' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

// The quote columns this route needs to derive an agreement. Kept local to the
// route because nothing else reads a quote this way.
function buildServiceAgreementQuoteSelect() {
    return `
        SELECT pq.id, pq.domain, pq.patient_id, pt.patient_name, pq.quote_number, pq.status,
               pq.funding_type, pq.plan_manager, pq.ndis_number, pq.prepared_by
        FROM patient_quotes pq
        LEFT JOIN patients pt ON pt.id = pq.patient_id AND pt.domain = pq.domain
    `
}
