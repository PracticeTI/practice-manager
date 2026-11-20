import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    SETTLED_QUOTE_STATUSES,
    buildQuoteSelect,
    nextQuoteNumber,
    normalizeQuoteRow,
    parseQuoteFields,
    patientExists,
} from '@/lib/patientQuotes'

const SETTLED_STATUS_LIST = SETTLED_QUOTE_STATUSES.map((value) => `'${value}'`).join(', ')

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
        const parsedPatientId = Number.parseInt(String(searchParams.get('patient_id') || ''), 10)
        const hasPatientFilter = Number.isFinite(parsedPatientId) && parsedPatientId > 0
        const status = String(searchParams.get('status') || '').trim().toLowerCase()
        const limit = parseLimit(searchParams.get('limit'))

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        let query = `${buildQuoteSelect()} WHERE pq.domain = $1`
        const params = [domain]
        let index = 2

        if (hasPatientFilter) {
            query += ` AND pq.patient_id = $${index}`
            params.push(parsedPatientId)
            index += 1
        }
        if (status === 'expired') {
            // "Expired" is derived: the validity date has passed and the participant
            // has not already accepted or declined the quote.
            query += ` AND pq.status NOT IN (${SETTLED_STATUS_LIST}) AND pq.valid_until IS NOT NULL AND pq.valid_until < CURRENT_DATE`
        } else if (status && ['draft', 'sent', 'accepted', 'declined'].includes(status)) {
            query += ` AND pq.status = $${index}`
            params.push(status)
            index += 1
        }

        query += ` ORDER BY pq.id DESC LIMIT $${index}`
        params.push(limit)

        const result = await connection.query(query, params)
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeQuoteRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load quotes' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const patientId = Number.parseInt(String(payload?.patient_id || ''), 10)
        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const parsed = parseQuoteFields(payload)
        if (parsed.error) {
            return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
        }
        const fields = parsed.value
        if (fields.metadata !== null && typeof fields.metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        await ensurePatientQuotesTables()
        connection = await getDomainBoundConnection(domain)

        const exists = await patientExists(connection, dbType, patientId, domain)
        if (!exists) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const quoteNumber = fields.quote_number || await nextQuoteNumber(connection, domain)
        const serializedMetadata = fields.metadata === null ? null : JSON.stringify(fields.metadata)

        const result = await connection.query(
            `INSERT INTO patient_quotes (
                domain, patient_id, quote_number, status, funding_type, pricing_region,
                plan_manager, ndis_number, quote_date, valid_until, prepared_by,
                gst_applicable, notes, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
            RETURNING id`,
            [
                domain, patientId, quoteNumber, fields.status, fields.funding_type,
                fields.pricing_region, fields.plan_manager, fields.ndis_number,
                fields.quote_date, fields.valid_until, fields.prepared_by,
                fields.gst_applicable, fields.notes, serializedMetadata,
            ]
        )
        const quoteId = result.rows?.[0]?.id || null

        if (!quoteId) {
            return NextResponse.json({ success: false, error: 'Failed to create quote' }, { status: 500 })
        }

        const created = await connection.query(
            `${buildQuoteSelect()} WHERE pq.id = $1 AND pq.domain = $2 LIMIT 1`,
            [quoteId, domain]
        )
        const createdQuote = normalizeQuoteRow(created.rows?.[0] || null)

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'quote',
            entityId: quoteId,
            entityLabel: createdQuote?.quote_number || quoteNumber,
            patientId,
            patientName: createdQuote?.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true, quote: createdQuote })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create quote' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
