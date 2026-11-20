import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    SERVICE_AGREEMENT_ITEM_COLUMNS,
    normalizeServiceAgreementItemRow,
    resolveQuoteItemUpdates,
    resolveRouteParams,
    validateId,
} from '@/lib/patientServiceAgreements'

async function loadItem(connection, itemId, agreementId, domain) {
    const result = await connection.query(
        `SELECT ${SERVICE_AGREEMENT_ITEM_COLUMNS} FROM service_agreement_items
         WHERE id = $1 AND agreement_id = $2 AND domain = $3 LIMIT 1`,
        [itemId, agreementId, domain]
    )
    return normalizeServiceAgreementItemRow(result.rows?.[0] || null)
}

export async function PATCH(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const agreementId = validateId(routeParams?.id)
    const itemId = validateId(routeParams?.itemId)
    if (!agreementId || !itemId) {
        return NextResponse.json({ success: false, error: 'Invalid service agreement or support id' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain') || payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadItem(connection, itemId, agreementId, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Support not found' }, { status: 404 })
        }

        // Partial updates are validated against the merged support, so the caller
        // can PATCH just a quantity without resending the whole NDIS support item.
        const { updates, errors } = resolveQuoteItemUpdates({ ...existing, ...payload })
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        const values = updates.map((update) => (
            update.key === 'metadata' && update.value !== null
                ? JSON.stringify(update.value)
                : update.value
        ))

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        const query = `UPDATE service_agreement_items SET ${setClauses.join(', ')}, updated_at = NOW()
                       WHERE id = $${values.length + 1} AND agreement_id = $${values.length + 2} AND domain = $${values.length + 3}`
        await connection.query(query, [...values, itemId, agreementId, domain])

        const updated = await loadItem(connection, itemId, agreementId, domain)
        return NextResponse.json({ success: true, item: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update support' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function DELETE(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const agreementId = validateId(routeParams?.id)
    const itemId = validateId(routeParams?.itemId)
    if (!agreementId || !itemId) {
        return NextResponse.json({ success: false, error: 'Invalid service agreement or support id' }, { status: 400 })
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

        const existing = await loadItem(connection, itemId, agreementId, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Support not found' }, { status: 404 })
        }

        await connection.query(
            'DELETE FROM service_agreement_items WHERE id = $1 AND agreement_id = $2 AND domain = $3',
            [itemId, agreementId, domain]
        )
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to remove support' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
