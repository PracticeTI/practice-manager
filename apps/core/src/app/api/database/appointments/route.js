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
    DEFAULT_EXTERNAL_SOURCE,
    buildAppointmentSelect,
    cleanString,
    normalizeAppointmentRow,
    resolveAppointmentUpdates,
} from '@/lib/appointments'

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
        const practitionerId = parsePositiveInt(searchParams.get('practitioner_id'))
        const serviceId = parsePositiveInt(searchParams.get('service_id'))
        const locationId = parsePositiveInt(searchParams.get('location_id'))
        const externalId = cleanString(searchParams.get('external_id'))
        const source = cleanString(searchParams.get('source')).toLowerCase()
        const status = cleanString(searchParams.get('status')).toLowerCase()
        const appointmentStatus = cleanString(searchParams.get('appointment_status')).toLowerCase()
        const from = toIsoOrNull(searchParams.get('from'))
        const to = toIsoOrNull(searchParams.get('to'))
        const search = cleanString(searchParams.get('search')).toLowerCase()
        const includeArchived = ['1', 'true', 'yes'].includes(cleanString(searchParams.get('includeArchived')).toLowerCase())
        const limit = parseLimit(searchParams.get('limit'))

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const select = buildAppointmentSelect(dbType)
        const params = [domain]
        const whereParts = ['a.domain = $1']
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

        if (patientId) addFilter((p) => `a.patient_id = ${p()}`, patientId)
        if (practitionerId) addFilter((p) => `a.practitioner_id = ${p()}`, practitionerId)
        if (serviceId) addFilter((p) => `a.service_id = ${p()}`, serviceId)
        if (locationId) addFilter((p) => `a.location_id = ${p()}`, locationId)
        if (externalId) addFilter((p) => `a.external_id = ${p()}`, externalId)
        if (source) addFilter((p) => `a.external_source = ${p()}`, source)
        if (status === 'no status') {
            // The source export uses the literal text "No status"; imported
            // rows with a blank cell are treated the same way.
            whereParts.push("COALESCE(LOWER(TRIM(a.progress_note_status)), '') IN ('', 'no status')")
        } else if (status) {
            addFilter((p) => `LOWER(COALESCE(a.progress_note_status, '')) LIKE ${p()}`, `${status}%`)
        }
        if (appointmentStatus) addFilter((p) => `a.appointment_status = ${p()}`, appointmentStatus)
        if (from) addFilter((p) => `a.starts_at >= ${p()}`, from)
        if (to) addFilter((p) => `a.starts_at <= ${p()}`, to)
        if (!includeArchived) whereParts.push('COALESCE(a.archived, FALSE) = FALSE')
        if (search) {
            addFilter(
                (p) => `(
                    LOWER(COALESCE(a.patient_name, '')) LIKE ${p()}
                    OR LOWER(COALESCE(a.practitioner, '')) LIKE ${p()}
                    OR LOWER(COALESCE(a.service, '')) LIKE ${p()}
                    OR LOWER(COALESCE(a.location, '')) LIKE ${p()}
                    OR LOWER(COALESCE(a.external_id, '')) LIKE ${p()}
                )`,
                `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`
            )
        }

        const whereClause = whereParts.join(' AND ')
        let rows = []

        const query = `${select} WHERE ${whereClause} ORDER BY a.starts_at DESC NULLS LAST, a.id DESC LIMIT ${limit}`
        const result = await connection.query(query, params)
        rows = result.rows || []

        return NextResponse.json({ success: true, data: (rows || []).map(normalizeAppointmentRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load appointments' }, { status: 500 })
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

        const { updates, errors } = resolveAppointmentUpdates(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }

        const fields = Object.fromEntries(updates.map((update) => [update.key, update.value]))
        if (!fields.external_source) fields.external_source = DEFAULT_EXTERNAL_SOURCE
        if (!fields.starts_at) {
            return NextResponse.json({ success: false, error: 'starts_at is required' }, { status: 400 })
        }

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const referenceErrors = await findInvalidDomainReferences(connection, domain, fields)
        if (referenceErrors.length > 0) {
            return NextResponse.json({ success: false, error: referenceErrors[0] }, { status: 400 })
        }

        if (fields.external_id) {
            const duplicate = await connection.query(
                'SELECT id FROM appointments WHERE domain = $1 AND external_source = $2 AND external_id = $3 LIMIT 1',
                [domain, fields.external_source, fields.external_id]
            )
            if (duplicate.rows?.length) {
                return NextResponse.json(
                    { success: false, error: 'An appointment with that external id already exists for this source' },
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
            `INSERT INTO appointments (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
        )
        const insertedId = result.rows?.[0]?.id

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'appointment',
            entityId: insertedId,
            entityLabel: fields.service || fields.practitioner || 'Appointment',
            patientId: fields.patient_id,
            patientName: fields.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        try {
            await syncReminderRowsForAppointment(connection, {
                id: insertedId,
                domain,
                patient_id: fields.patient_id ?? null,
                patient_name: fields.patient_name || null,
                starts_at: fields.starts_at,
                appointment_status: fields.appointment_status || 'confirmed',
                confirmation_status: fields.confirmation_status || 'pending',
            })
        } catch (error) {
            console.warn('Failed to schedule appointment reminders:', error?.message || error)
        }

        return NextResponse.json({ success: true, id: insertedId }, { status: 201 })
    } catch (error) {
        if (isScheduleConflictError(error)) {
            return NextResponse.json({ success: false, error: SCHEDULE_CONFLICT_MESSAGE }, { status: 409 })
        }
        const message = error?.message || 'Failed to create appointment'
        const isDuplicate = /duplicate key|unique constraint/i.test(message)
        return NextResponse.json({ success: false, error: message }, { status: isDuplicate ? 409 : 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
