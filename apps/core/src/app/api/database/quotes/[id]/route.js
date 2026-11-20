import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildQuoteSelect,
    normalizeQuoteItemRow,
    normalizeQuoteRow,
    resolveQuoteUpdates,
    resolveRouteParams,
    validateId,
} from '@/lib/patientQuotes'

const ITEM_COLUMNS = `
    id, domain, quote_id, patient_id, position, ndis_support_item_number,
    ndis_support_item_name, registration_group_number, registration_group_name,
    support_category_number, support_category_name, unit, quantity, unit_price,
    price_limit, quote_required, description, metadata, created_at, updated_at
`

async function loadQuoteById(connection, id, domain) {
    const result = await connection.query(
        `${buildQuoteSelect()} WHERE pq.id = $1 AND pq.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeQuoteRow(result.rows?.[0] || null)
}

async function loadQuoteItems(connection, quoteId, domain) {
    const result = await connection.query(
        `SELECT ${ITEM_COLUMNS} FROM quote_items
         WHERE quote_id = $1 AND domain = $2
         ORDER BY position ASC, id ASC`,
        [quoteId, domain]
    )
    return (result.rows || []).map(normalizeQuoteItemRow)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid quote id' }, { status: 400 })
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

        const quote = await loadQuoteById(connection, id, domain)
        if (!quote) {
            return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 })
        }

        const items = await loadQuoteItems(connection, id, domain)
        return NextResponse.json({ success: true, quote, items })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load quote' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function PATCH(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid quote id' }, { status: 400 })
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

        const { updates, errors } = resolveQuoteUpdates(payload)
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing quote is reported as 404, not a no-op.
        const existing = await loadQuoteById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 })
        }

        const values = updates.map((update) => (
            update.key === 'metadata' && update.value !== null
                ? JSON.stringify(update.value)
                : update.value
        ))

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        const query = `UPDATE patient_quotes SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`
        await connection.query(query, [...values, id, domain])

        const updated = await loadQuoteById(connection, id, domain)
        await recordActivity({
            domain,
            action: 'update',
            entityType: 'quote',
            entityId: id,
            entityLabel: updated?.quote_number || existing.quote_number,
            patientId: updated?.patient_id ?? existing.patient_id,
            patientName: updated?.patient_name || existing.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, quote: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update quote' }, { status: 500 })
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
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid quote id' }, { status: 400 })
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

        const existing = await loadQuoteById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM quote_items WHERE quote_id = $1 AND domain = $2', [id, domain])
        await connection.query('DELETE FROM patient_quotes WHERE id = $1 AND domain = $2', [id, domain])

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'quote',
            entityId: id,
            entityLabel: existing.quote_number,
            patientId: existing.patient_id,
            patientName: existing.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete quote' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
