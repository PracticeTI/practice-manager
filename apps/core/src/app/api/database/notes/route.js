import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureNotesTable } from '@/lib/notesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    DEFAULT_EXTERNAL_SOURCE,
    MANUAL_EXTERNAL_SOURCE,
    buildNoteSelect,
    cleanString,
    isEmptyNoteContent,
    noteOrderExpression,
    normalizeNoteRow,
    resolveNoteUpdates,
} from '@/lib/notes'

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// `draft=1` narrows the list to drafts, `draft=0` to everything that was
// finalised. An absent value keeps both.
function parseDraftFilter(rawValue) {
    const text = cleanString(rawValue).toLowerCase()
    if (!text) return null
    if (['1', 'true', 'yes'].includes(text)) return true
    if (['0', 'false', 'no'].includes(text)) return false
    return null
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
        const search = cleanString(searchParams.get('search')).toLowerCase()
        const draft = parseDraftFilter(searchParams.get('draft'))
        // `compact=1` keeps a preview only (the dashboard card), while
        // `compact=text` keeps the whole flattened body but drops the document
        // - what callers that need "all the notes as one blob" ask for.
        const compactParam = cleanString(searchParams.get('compact')).toLowerCase()
        const compact = compactParam === 'text' ? 'text' : ['1', 'true', 'yes'].includes(compactParam)
        const limit = parseLimit(searchParams.get('limit'))

        await ensureNotesTable()
        connection = await getDomainBoundConnection(domain)

        const select = buildNoteSelect({ compact })
        const params = [domain]
        const whereParts = ['n.domain = $1']
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

        if (patientId) addFilter((p) => `n.patient_id = ${p()}`, patientId)
        if (externalId) addFilter((p) => `n.external_id = ${p()}`, externalId)
        if (source) addFilter((p) => `n.external_source = ${p()}`, source)
        if (draft !== null) whereParts.push(`COALESCE(n.draft, FALSE) = ${draft ? 'TRUE' : 'FALSE'}`)
        if (search) {
            addFilter(
                (p) => `(
                    LOWER(COALESCE(n.patient_name, '')) LIKE ${p()}
                    OR LOWER(COALESCE(n.title, '')) LIKE ${p()}
                    OR LOWER(COALESCE(n.content_text, '')) LIKE ${p()}
                    OR LOWER(COALESCE(n.practitioner_name, '')) LIKE ${p()}
                    OR LOWER(COALESCE(n.external_patient_id, '')) LIKE ${p()}
                    OR LOWER(COALESCE(n.external_id, '')) LIKE ${p()}
                )`,
                `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`
            )
        }

        const query = `${select} WHERE ${whereParts.join(' AND ')}
            ORDER BY ${noteOrderExpression()} LIMIT ${limit}`
        const result = await connection.query(query, params)

        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeNoteRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load notes' }, { status: 500 })
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

        const { updates, errors } = resolveNoteUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }

        const fields = Object.fromEntries(updates.map((update) => [update.key, update.value]))
        if (!fields.external_source) {
            fields.external_source = fields.external_id ? DEFAULT_EXTERNAL_SOURCE : MANUAL_EXTERNAL_SOURCE
        }
        if (!cleanString(fields.title) && isEmptyNoteContent(fields.content)) {
            return NextResponse.json({ success: false, error: 'A note needs a title or content' }, { status: 400 })
        }

        await ensureNotesTable()
        connection = await getDomainBoundConnection(domain)

        if (fields.external_id) {
            const duplicate = await connection.query(
                'SELECT id FROM notes WHERE domain = $1 AND external_source = $2 AND external_id = $3 LIMIT 1',
                [domain, fields.external_source, fields.external_id]
            )
            if (duplicate.rows?.length) {
                return NextResponse.json(
                    { success: false, error: 'A note with that external id already exists for this source' },
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
            `INSERT INTO notes (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
        )
        const noteId = result.rows?.[0]?.id ?? null

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'note',
            entityId: noteId,
            entityLabel: fields.title || 'Note',
            patientId: fields.patient_id,
            patientName: fields.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true, id: noteId }, { status: 201 })
    } catch (error) {
        const message = error?.message || 'Failed to create note'
        const isDuplicate = /duplicate key|unique constraint/i.test(message)
        return NextResponse.json({ success: false, error: message }, { status: isDuplicate ? 409 : 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
