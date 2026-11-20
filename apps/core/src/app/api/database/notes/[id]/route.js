import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureNotesTable } from '@/lib/notesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildNoteSelect,
    normalizeNoteRow,
    resolveNoteUpdates,
    validateId,
} from '@/lib/notes'

async function loadNoteById(connection, id, domain) {
    const result = await connection.query(
        `${buildNoteSelect()} WHERE n.id = $1 AND n.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeNoteRow(result.rows?.[0] || null)
}

async function resolveId(params) {
    const resolved = await params
    return validateId(resolved?.id)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid note id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureNotesTable()
        connection = await getDomainBoundConnection(domain)
        const record = await loadNoteById(connection, id, domain)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, note: record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load note' }, { status: 500 })
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

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid note id' }, { status: 400 })
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

        const { updates, errors } = resolveNoteUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensureNotesTable()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing note is reported as 404, not a no-op.
        const existing = await loadNoteById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 })
        }

        const values = updates.map((update) => {
            if (update.key === 'metadata' || update.key === 'content') {
                return update.value === null ? null : JSON.stringify(update.value)
            }
            return update.value
        })

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        await connection.query(
            `UPDATE notes SET ${setClauses.join(', ')}, updated_at = NOW()
             WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`,
            [...values, id, domain]
        )

        const updated = await loadNoteById(connection, id, domain)
        await recordActivity({
            domain,
            action: 'update',
            entityType: 'note',
            entityId: id,
            entityLabel: updated?.title || existing?.title || 'Note',
            patientId: updated?.patient_id ?? existing?.patient_id,
            patientName: updated?.patient_name || updated?.linked_patient_name || existing?.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, note: updated })
    } catch (error) {
        const message = error?.message || 'Failed to update note'
        const isDuplicate = /duplicate key|unique constraint/i.test(message)
        return NextResponse.json({ success: false, error: message }, { status: isDuplicate ? 409 : 500 })
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

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid note id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureNotesTable()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadNoteById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM notes WHERE id = $1 AND domain = $2', [id, domain])

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'note',
            entityId: id,
            entityLabel: existing.title || 'Note',
            patientId: existing.patient_id,
            patientName: existing.patient_name || existing.linked_patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete note' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
