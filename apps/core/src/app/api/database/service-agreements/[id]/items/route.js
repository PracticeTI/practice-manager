import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    SERVICE_AGREEMENT_ITEM_COLUMNS,
    normalizeServiceAgreementItemRow,
    parseQuoteItemFields,
    resolveRouteParams,
    toFinite,
    validateId,
} from '@/lib/patientServiceAgreements'

async function loadAgreementHeader(connection, agreementId, domain) {
    const result = await connection.query(
        'SELECT id, patient_id, status FROM patient_service_agreements WHERE id = $1 AND domain = $2 LIMIT 1',
        [agreementId, domain]
    )
    return result.rows?.[0] || null
}

async function loadItem(connection, itemId, agreementId, domain) {
    const result = await connection.query(
        `SELECT ${SERVICE_AGREEMENT_ITEM_COLUMNS} FROM service_agreement_items
         WHERE id = $1 AND agreement_id = $2 AND domain = $3 LIMIT 1`,
        [itemId, agreementId, domain]
    )
    return normalizeServiceAgreementItemRow(result.rows?.[0] || null)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const agreementId = validateId(routeParams?.id)
    if (!agreementId) {
        return NextResponse.json({ success: false, error: 'Invalid service agreement id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            `SELECT ${SERVICE_AGREEMENT_ITEM_COLUMNS} FROM service_agreement_items
             WHERE agreement_id = $1 AND domain = $2
             ORDER BY position ASC, id ASC`,
            [agreementId, domain]
        )
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeServiceAgreementItemRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load the schedule of supports' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const agreementId = validateId(routeParams?.id)
    if (!agreementId) {
        return NextResponse.json({ success: false, error: 'Invalid service agreement id' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const parsed = parseQuoteItemFields(payload)
        if (parsed.error) {
            return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
        }
        const fields = parsed.value
        if (fields.metadata !== null && typeof fields.metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const agreement = await loadAgreementHeader(connection, agreementId, domain)
        if (!agreement) {
            return NextResponse.json({ success: false, error: 'Service agreement not found' }, { status: 404 })
        }

        // A support appended without an explicit position goes to the end of the schedule.
        let position = fields.position
        if (!Object.prototype.hasOwnProperty.call(payload, 'position')) {
            const maxResult = await connection.query(
                'SELECT COALESCE(MAX(position), 0) AS max_position FROM service_agreement_items WHERE agreement_id = $1 AND domain = $2',
                [agreementId, domain]
            )
            position = Math.trunc(toFinite(maxResult.rows?.[0]?.max_position)) + 1
        }

        const serializedMetadata = fields.metadata === null ? null : JSON.stringify(fields.metadata)
        const result = await connection.query(
            `INSERT INTO service_agreement_items (
                domain, agreement_id, patient_id, position, ndis_support_item_number,
                ndis_support_item_name, registration_group_number, registration_group_name,
                support_category_number, support_category_name, unit, quantity, unit_price,
                price_limit, quote_required, description, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
            RETURNING id`,
            [
                domain, agreementId, agreement.patient_id, position, fields.ndis_support_item_number,
                fields.ndis_support_item_name, fields.registration_group_number,
                fields.registration_group_name, fields.support_category_number,
                fields.support_category_name, fields.unit, fields.quantity, fields.unit_price,
                fields.price_limit, fields.quote_required, fields.description, serializedMetadata,
            ]
        )
        const itemId = result.rows?.[0]?.id || null

        if (!itemId) {
            return NextResponse.json({ success: false, error: 'Failed to add support' }, { status: 500 })
        }

        const created = await loadItem(connection, itemId, agreementId, domain)
        return NextResponse.json({ success: true, item: created })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to add support' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
