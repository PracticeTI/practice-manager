import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureFormsTable } from '@/lib/formsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    DEFAULT_EXTERNAL_SOURCE,
    MANUAL_EXTERNAL_SOURCE,
    buildFormSelect,
    cleanString,
    normalizeFormRow,
    resolveFormUpdates,
} from '@/lib/forms'

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toIsoOrNull(value) {
    const text = cleanString(value)
    if (!text) return null
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
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

        const patientId = parsePositiveInt(searchParams.get('patient_id'))
        const externalId = cleanString(searchParams.get('external_id'))
        const source = cleanString(searchParams.get('source')).toLowerCase()
        const from = toIsoOrNull(searchParams.get('from'))
        const to = toIsoOrNull(searchParams.get('to'))
        const search = cleanString(searchParams.get('search')).toLowerCase()
        const includeArchived = ['1', 'true', 'yes'].includes(cleanString(searchParams.get('includeArchived')).toLowerCase())
        const compact = ['1', 'true', 'yes'].includes(cleanString(searchParams.get('compact')).toLowerCase())
        const limit = parseLimit(searchParams.get('limit'))

        await ensureFormsTable()
        connection = await getDomainBoundConnection(domain)

        const select = buildFormSelect({ compact })
        const params = [domain]
        const whereParts = ['f.domain = $1']
        let paramIndex = 1

        // `nextPlaceholder` keeps the PostgreSQL $n numbering in sync with the
        // values pushed into `params`.
        const nextPlaceholder = () => {
            paramIndex += 1
            return `$${paramIndex}`
        }
        const addFilter = (sqlFactory, ...values) => {
            whereParts.push(sqlFactory(nextPlaceholder))
            params.push(...values)
        }

        if (patientId) addFilter((p) => `f.patient_id = ${p()}`, patientId)
        if (externalId) addFilter((p) => `f.external_id = ${p()}`, externalId)
        if (source) addFilter((p) => `f.external_source = ${p()}`, source)
        if (from) addFilter((p) => `f.submitted_at >= ${p()}`, from)
        if (to) addFilter((p) => `f.submitted_at <= ${p()}`, to)
        if (!includeArchived) whereParts.push('COALESCE(f.archived, FALSE) = FALSE')
        if (search) {
            addFilter(
                (p) => `(
                    LOWER(COALESCE(f.patient_name, '')) LIKE ${p()}
                    OR LOWER(COALESCE(f.title, '')) LIKE ${p()}
                    OR LOWER(COALESCE(f.external_patient_id, '')) LIKE ${p()}
                    OR LOWER(COALESCE(f.external_id, '')) LIKE ${p()}
                )`,
                `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`
            )
        }

        const query = `${select} WHERE ${whereParts.join(' AND ')}
            ORDER BY f.submitted_at DESC NULLS LAST, f.id DESC LIMIT ${limit}`
        const result = await connection.query(query, params)

        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeFormRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load forms' }, { status: 500 })
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

        const { updates, errors } = resolveFormUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }

        const fields = Object.fromEntries(updates.map((update) => [update.key, update.value]))
        if (!fields.external_source) {
            fields.external_source = fields.external_id ? DEFAULT_EXTERNAL_SOURCE : MANUAL_EXTERNAL_SOURCE
        }
        if (!cleanString(fields.title) && !Array.isArray(fields.content)) {
            return NextResponse.json({ success: false, error: 'A form needs a title or content' }, { status: 400 })
        }

        await ensureFormsTable()
        connection = await getDomainBoundConnection(domain)

        if (fields.external_id) {
            const duplicate = await connection.query(
                'SELECT id FROM forms WHERE domain = $1 AND external_source = $2 AND external_id = $3 LIMIT 1',
                [domain, fields.external_source, fields.external_id]
            )
            if (duplicate.rows?.length) {
                return NextResponse.json(
                    { success: false, error: 'A form with that external id already exists for this source' },
                    { status: 409 }
                )
            }
        }

        const keys = ['domain', ...Object.keys(fields)]
        const values = [
            domain,
            ...Object.values(fields).map((value) => (
                value && typeof value === 'object' ? JSON.stringify(value) : value
            )),
        ]

        const placeholders = keys.map((_key, index) => `$${index + 1}`)
        const result = await connection.query(
            `INSERT INTO forms (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
        )
        const formId = result.rows?.[0]?.id ?? null

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'form',
            entityId: formId,
            entityLabel: fields.title || 'Form',
            patientId: fields.patient_id,
            patientName: fields.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true, id: formId }, { status: 201 })
    } catch (error) {
        const message = error?.message || 'Failed to create form'
        const isDuplicate = /duplicate key|unique constraint/i.test(message)
        return NextResponse.json({ success: false, error: message }, { status: isDuplicate ? 409 : 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
