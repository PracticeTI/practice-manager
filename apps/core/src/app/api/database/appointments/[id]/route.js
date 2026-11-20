import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { isScheduleConflictError, SCHEDULE_CONFLICT_MESSAGE } from '@/lib/schedulingConstraint'
import { findInvalidDomainReferences } from '@/lib/schedulingReferences'
import { syncReminderRowsForAppointment } from '@/lib/appointmentReminders'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildAppointmentSelect,
    normalizeAppointmentRow,
    resolveAppointmentUpdates,
    resolveRouteParams,
    toDbTimestamp,
    validateId,
} from '@/lib/appointments'

async function loadAppointmentById(connection, dbType, id, domain) {
    const select = buildAppointmentSelect(dbType)
    const result = await connection.query(
        `${select} WHERE a.id = $1 AND a.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeAppointmentRow(result.rows?.[0] || null)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)
        const record = await loadAppointmentById(connection, dbType, id, domain)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, appointment: record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load appointment' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400 })
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

        const { updates, errors } = resolveAppointmentUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing appointment is reported as 404, not a no-op.
        const existing = await loadAppointmentById(connection, dbType, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 })
        }

        const referenceErrors = await findInvalidDomainReferences(
            connection,
            domain,
            Object.fromEntries(updates.map((update) => [update.key, update.value]))
        )
        if (referenceErrors.length > 0) {
            return NextResponse.json({ success: false, error: referenceErrors[0] }, { status: 400 })
        }

        const values = updates.map((update) => {
            if (update.key === 'starts_at' || update.key === 'ends_at') {
                return toDbTimestamp(update.value, dbType)
            }
            if (update.key === 'metadata' && update.value !== null) {
                return JSON.stringify(update.value)
            }
            return update.value
        })

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        const query = `UPDATE appointments SET ${setClauses.join(', ')}, updated_at = NOW()
                       WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`
        await connection.query(query, [...values, id, domain])

        const updated = await loadAppointmentById(connection, dbType, id, domain)

        try {
            await syncReminderRowsForAppointment(connection, updated, { includePast: true })
        } catch (error) {
            console.warn('Failed to reschedule appointment reminders:', error?.message || error)
        }

        await recordActivity({
            domain,
            action: 'update',
            entityType: 'appointment',
            entityId: id,
            entityLabel: updated?.service || existing.service || 'Appointment',
            patientId: updated?.patient_id ?? existing.patient_id,
            patientName: updated?.patient_name || updated?.linked_patient_name || existing.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, appointment: updated })
    } catch (error) {
        if (isScheduleConflictError(error)) {
            return NextResponse.json({ success: false, error: SCHEDULE_CONFLICT_MESSAGE }, { status: 409 })
        }
        const message = error?.message || 'Failed to update appointment'
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

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadAppointmentById(connection, dbType, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM appointments WHERE id = $1 AND domain = $2', [id, domain])

        await connection.query(
            'DELETE FROM appointment_reminders WHERE domain = $1 AND appointment_id = $2',
            [domain, id]
        ).catch(() => { })
        await connection.query(
            `UPDATE waitlist_offers
             SET status = 'cancelled', updated_at = NOW()
             WHERE domain = $1 AND appointment_id = $2 AND status IN ('offered', 'sent')`,
            [domain, id]
        ).catch(() => { })

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'appointment',
            entityId: id,
            entityLabel: existing.service || 'Appointment',
            patientId: existing.patient_id,
            patientName: existing.patient_name || existing.linked_patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete appointment' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
