import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    normalizeQuoteItemRow,
    resolveQuoteItemUpdates,
    resolveRouteParams,
    validateId,
} from '@/lib/patientQuotes'

const ITEM_COLUMNS = `
    id, domain, quote_id, patient_id, position, ndis_support_item_number,
    ndis_support_item_name, registration_group_number, registration_group_name,
    support_category_number, support_category_name, unit, quantity, unit_price,
    price_limit, quote_required, description, metadata, created_at, updated_at
`

async function loadItem(connection, itemId, quoteId, domain) {
    const result = await connection.query(
        `SELECT ${ITEM_COLUMNS} FROM quote_items WHERE id = $1 AND quote_id = $2 AND domain = $3 LIMIT 1`,
        [itemId, quoteId, domain]
    )
    return normalizeQuoteItemRow(result.rows?.[0] || null)
}

export async function PATCH(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const quoteId = validateId(routeParams?.id)
    const itemId = validateId(routeParams?.itemId)
    if (!quoteId || !itemId) {
        return NextResponse.json({ success: false, error: 'Invalid quote or line id' }, { status: 400 })
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

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadItem(connection, itemId, quoteId, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Quote line not found' }, { status: 404 })
        }

        // Partial updates are validated against the merged line, so the caller can
        // PATCH just a quantity without resending the whole NDIS support item.
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
        const query = `UPDATE quote_items SET ${setClauses.join(', ')}, updated_at = NOW()
                       WHERE id = $${values.length + 1} AND quote_id = $${values.length + 2} AND domain = $${values.length + 3}`
        await connection.query(query, [...values, itemId, quoteId, domain])

        const updated = await loadItem(connection, itemId, quoteId, domain)
        return NextResponse.json({ success: true, item: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update quote line' }, { status: 500 })
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
    const quoteId = validateId(routeParams?.id)
    const itemId = validateId(routeParams?.itemId)
    if (!quoteId || !itemId) {
        return NextResponse.json({ success: false, error: 'Invalid quote or line id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadItem(connection, itemId, quoteId, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Quote line not found' }, { status: 404 })
        }

        await connection.query(
            'DELETE FROM quote_items WHERE id = $1 AND quote_id = $2 AND domain = $3',
            [itemId, quoteId, domain]
        )
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete quote line' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
