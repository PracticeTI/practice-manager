import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    normalizeQuoteItemRow,
    parseQuoteItemFields,
    resolveRouteParams,
    toFinite,
    validateId,
} from '@/lib/patientQuotes'

const ITEM_COLUMNS = `
    id, domain, quote_id, patient_id, position, ndis_support_item_number,
    ndis_support_item_name, registration_group_number, registration_group_name,
    support_category_number, support_category_name, unit, quantity, unit_price,
    price_limit, quote_required, description, metadata, created_at, updated_at
`

async function loadQuoteHeader(connection, quoteId, domain) {
    const result = await connection.query(
        'SELECT id, patient_id, status FROM patient_quotes WHERE id = $1 AND domain = $2 LIMIT 1',
        [quoteId, domain]
    )
    return result.rows?.[0] || null
}

async function loadItem(connection, itemId, quoteId, domain) {
    const result = await connection.query(
        `SELECT ${ITEM_COLUMNS} FROM quote_items WHERE id = $1 AND quote_id = $2 AND domain = $3 LIMIT 1`,
        [itemId, quoteId, domain]
    )
    return normalizeQuoteItemRow(result.rows?.[0] || null)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const quoteId = validateId(routeParams?.id)
    if (!quoteId) {
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

        const result = await connection.query(
            `SELECT ${ITEM_COLUMNS} FROM quote_items
             WHERE quote_id = $1 AND domain = $2
             ORDER BY position ASC, id ASC`,
            [quoteId, domain]
        )
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeQuoteItemRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load quote items' }, { status: 500 })
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
    const quoteId = validateId(routeParams?.id)
    if (!quoteId) {
        return NextResponse.json({ success: false, error: 'Invalid quote id' }, { status: 400 })
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

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        const quote = await loadQuoteHeader(connection, quoteId, domain)
        if (!quote) {
            return NextResponse.json({ success: false, error: 'Quote not found' }, { status: 404 })
        }

        // A line appended without an explicit position goes to the end of the quote.
        let position = fields.position
        if (!Object.prototype.hasOwnProperty.call(payload, 'position')) {
            const maxResult = await connection.query(
                'SELECT COALESCE(MAX(position), 0) AS max_position FROM quote_items WHERE quote_id = $1 AND domain = $2',
                [quoteId, domain]
            )
            position = Math.trunc(toFinite(maxResult.rows?.[0]?.max_position)) + 1
        }

        const serializedMetadata = fields.metadata === null ? null : JSON.stringify(fields.metadata)
        const result = await connection.query(
            `INSERT INTO quote_items (
                domain, quote_id, patient_id, position, ndis_support_item_number,
                ndis_support_item_name, registration_group_number, registration_group_name,
                support_category_number, support_category_name, unit, quantity, unit_price,
                price_limit, quote_required, description, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
            RETURNING id`,
            [
                domain, quoteId, quote.patient_id, position, fields.ndis_support_item_number,
                fields.ndis_support_item_name, fields.registration_group_number,
                fields.registration_group_name, fields.support_category_number,
                fields.support_category_name, fields.unit, fields.quantity, fields.unit_price,
                fields.price_limit, fields.quote_required, fields.description, serializedMetadata,
            ]
        )
        const itemId = result.rows?.[0]?.id || null

        if (!itemId) {
            return NextResponse.json({ success: false, error: 'Failed to add quote line' }, { status: 500 })
        }

        const created = await loadItem(connection, itemId, quoteId, domain)
        return NextResponse.json({ success: true, item: created })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to add quote line' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
