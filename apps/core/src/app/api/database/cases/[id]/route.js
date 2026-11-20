import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientCasesTables } from '@/lib/patientCasesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, loadActivityPatientName, recordActivity } from '@/lib/activities'
import {
    CASE_STATUSES,
    CASE_TYPES,
    buildCaseTotalsSelect,
    cleanNullableString,
    cleanOptionalText,
    normalizeCaseRow,
    parseDateOnly,
    parseNonNegativeNumber,
    resolveRouteParams,
    toBool,
    validateId,
} from '@/lib/patientCases'

const CASE_COLUMNS = `
    pc.id, pc.domain, pc.patient_id, pc.case_number, pc.status, pc.case_type,
    pc.total_allocation, pc.practitioner, pc.issue_date, pc.expiry_date,
    pc.disable_exceeding, pc.referral_contact, pc.referral_issue_date,
    pc.referral_period, pc.notes, pc.metadata, pc.created_at, pc.updated_at
`

function buildCaseSelect(dbType) {
    const totals = buildCaseTotalsSelect(dbType)
    const date = totals.dateExpr
    const replacedColumns = CASE_COLUMNS
        .replaceAll('pc.issue_date', `${date('pc.issue_date')} AS issue_date`)
        .replaceAll('pc.expiry_date', `${date('pc.expiry_date')} AS expiry_date`)
        .replaceAll('pc.referral_issue_date', `${date('pc.referral_issue_date')} AS referral_issue_date`)

    return `
        SELECT ${replacedColumns},
               ${totals.usedExpr},
               ${totals.expiredExpr}
        FROM patient_cases pc
    `
}

async function loadCaseById(connection, dbType, id, domain) {
    const select = buildCaseSelect(dbType)
    const result = await connection.query(
        `${select} WHERE pc.id = $1 AND pc.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeCaseRow(result.rows?.[0] || null)
}

// Returns a list of { key, value } updates for the mutable case fields present
// in the payload, validating each one. Invalid enum values fail the request.
function resolveCaseUpdates(payload) {
    const updates = []
    const errors = []

    if (Object.prototype.hasOwnProperty.call(payload, 'case_number')) {
        updates.push({ key: 'case_number', value: cleanNullableString(payload.case_number, 120) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
        const status = String(payload.status || '').trim().toLowerCase()
        if (!CASE_STATUSES.has(status)) {
            errors.push('status must be one of: open, closed')
        } else {
            updates.push({ key: 'status', value: status })
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'case_type')) {
        const caseType = String(payload.case_type || '').trim().toLowerCase()
        if (!CASE_TYPES.has(caseType)) {
            errors.push('case_type must be one of: budget, hours, sessions')
        } else {
            updates.push({ key: 'case_type', value: caseType })
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'total_allocation')) {
        updates.push({ key: 'total_allocation', value: parseNonNegativeNumber(payload.total_allocation) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'practitioner')) {
        updates.push({ key: 'practitioner', value: cleanNullableString(payload.practitioner, 255) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'issue_date')) {
        updates.push({ key: 'issue_date', value: parseDateOnly(payload.issue_date) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'expiry_date')) {
        updates.push({ key: 'expiry_date', value: parseDateOnly(payload.expiry_date) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'disable_exceeding')) {
        updates.push({ key: 'disable_exceeding', value: toBool(payload.disable_exceeding) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'referral_contact')) {
        updates.push({ key: 'referral_contact', value: cleanNullableString(payload.referral_contact, 255) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'referral_issue_date')) {
        updates.push({ key: 'referral_issue_date', value: parseDateOnly(payload.referral_issue_date) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'referral_period')) {
        updates.push({ key: 'referral_period', value: cleanNullableString(payload.referral_period, 120) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
        updates.push({ key: 'notes', value: cleanOptionalText(payload.notes) })
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && typeof metadata !== 'object') {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)
        const record = await loadCaseById(connection, dbType, id, domain)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Case not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, case: record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load case' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
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

        const { updates, errors } = resolveCaseUpdates(payload)
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing case is reported as 404, not a no-op.
        const existing = await loadCaseById(connection, dbType, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Case not found' }, { status: 404 })
        }

        const values = updates.map((update) => (
            update.key === 'metadata' && update.value !== null
                ? JSON.stringify(update.value)
                : update.value
        ))

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        const query = `UPDATE patient_cases SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`
        await connection.query(query, [...values, id, domain])

        const updated = await loadCaseById(connection, dbType, id, domain)
        await recordActivity({
            domain,
            action: 'update',
            entityType: 'case',
            entityId: id,
            entityLabel: updated?.case_number || existing.case_number,
            patientId: existing.patient_id,
            patientName: await loadActivityPatientName(connection, existing.patient_id, domain),
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, case: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update case' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadCaseById(connection, dbType, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Case not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM case_usage WHERE case_id = $1 AND domain = $2', [id, domain])
        await connection.query('DELETE FROM patient_cases WHERE id = $1 AND domain = $2', [id, domain])

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'case',
            entityId: id,
            entityLabel: existing.case_number,
            patientId: existing.patient_id,
            patientName: await loadActivityPatientName(connection, existing.patient_id, domain),
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete case' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
