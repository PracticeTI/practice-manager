import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureFormsTable } from '@/lib/formsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildFormSelect,
    normalizeFormRow,
    resolveFormUpdates,
    toDbTimestamp,
    validateId,
} from '@/lib/forms'

async function loadFormById(connection, id, domain) {
    const result = await connection.query(
        `${buildFormSelect()} WHERE f.id = $1 AND f.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeFormRow(result.rows?.[0] || null)
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
        return NextResponse.json({ success: false, error: 'Invalid form id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureFormsTable()
        connection = await getDomainBoundConnection(domain)
        const record = await loadFormById(connection, id, domain)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, form: record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load form' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid form id' }, { status: 400 })
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

        const { updates, errors } = resolveFormUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensureFormsTable()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing form is reported as 404, not a no-op.
        const existing = await loadFormById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
        }

        const values = updates.map((update) => {
            if (update.key === 'submitted_at') return toDbTimestamp(update.value)
            if (update.key === 'metadata' || update.key === 'content'
                || update.key === 'answers' || update.key === 'labelled_answers') {
                return update.value === null ? null : JSON.stringify(update.value)
            }
            return update.value
        })

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        await connection.query(
            `UPDATE forms SET ${setClauses.join(', ')}, updated_at = NOW()
             WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`,
            [...values, id, domain]
        )

        const updated = await loadFormById(connection, id, domain)
        await recordActivity({
            domain,
            action: 'update',
            entityType: 'form',
            entityId: id,
            entityLabel: updated?.title || existing?.title || 'Form',
            patientId: updated?.patient_id ?? existing?.patient_id,
            patientName: updated?.patient_name || updated?.linked_patient_name || existing?.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, form: updated })
    } catch (error) {
        const message = error?.message || 'Failed to update form'
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
        return NextResponse.json({ success: false, error: 'Invalid form id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureFormsTable()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadFormById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM forms WHERE id = $1 AND domain = $2', [id, domain])

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'form',
            entityId: id,
            entityLabel: existing.title || 'Form',
            patientId: existing.patient_id,
            patientName: existing.patient_name || existing.linked_patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete form' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
