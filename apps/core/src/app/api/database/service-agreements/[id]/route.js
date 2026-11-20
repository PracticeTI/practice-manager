import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    SERVICE_AGREEMENT_ITEM_COLUMNS,
    buildServiceAgreementSelect,
    normalizeServiceAgreementItemRow,
    normalizeServiceAgreementRow,
    resolveRouteParams,
    resolveServiceAgreementUpdates,
    validateId,
} from '@/lib/patientServiceAgreements'

async function loadServiceAgreementById(connection, id, domain) {
    const result = await connection.query(
        `${buildServiceAgreementSelect()} WHERE sa.id = $1 AND sa.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeServiceAgreementRow(result.rows?.[0] || null)
}

async function loadServiceAgreementItems(connection, agreementId, domain) {
    const result = await connection.query(
        `SELECT ${SERVICE_AGREEMENT_ITEM_COLUMNS} FROM service_agreement_items
         WHERE agreement_id = $1 AND domain = $2
         ORDER BY position ASC, id ASC`,
        [agreementId, domain]
    )
    return (result.rows || []).map(normalizeServiceAgreementItemRow)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid service agreement id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const agreement = await loadServiceAgreementById(connection, id, domain)
        if (!agreement) {
            return NextResponse.json({ success: false, error: 'Service agreement not found' }, { status: 404 })
        }

        const items = await loadServiceAgreementItems(connection, id, domain)
        return NextResponse.json({ success: true, agreement, items })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load service agreement' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid service agreement id' }, { status: 400 })
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

        const { updates, errors } = resolveServiceAgreementUpdates(payload)
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing agreement is reported as 404, not a no-op.
        const existing = await loadServiceAgreementById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Service agreement not found' }, { status: 404 })
        }

        const values = updates.map((update) => (
            update.key === 'metadata' && update.value !== null
                ? JSON.stringify(update.value)
                : update.value
        ))

        const setClauses = updates.map((update, index) => `${update.key} = $${index + 1}`)
        const query = `UPDATE patient_service_agreements SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`
        await connection.query(query, [...values, id, domain])

        const updated = await loadServiceAgreementById(connection, id, domain)
        await recordActivity({
            domain,
            action: 'update',
            entityType: 'service_agreement',
            entityId: id,
            entityLabel: updated?.agreement_number || existing.agreement_number,
            patientId: updated?.patient_id ?? existing.patient_id,
            patientName: updated?.patient_name || existing.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, agreement: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update service agreement' }, { status: 500 })
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
        return NextResponse.json({ success: false, error: 'Invalid service agreement id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadServiceAgreementById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Service agreement not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM service_agreement_items WHERE agreement_id = $1 AND domain = $2', [id, domain])
        await connection.query('DELETE FROM patient_service_agreements WHERE id = $1 AND domain = $2', [id, domain])

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'service_agreement',
            entityId: id,
            entityLabel: existing.agreement_number,
            patientId: existing.patient_id,
            patientName: existing.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete service agreement' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
