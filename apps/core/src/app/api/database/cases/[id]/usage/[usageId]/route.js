import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientCasesTables } from '@/lib/patientCasesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, loadActivityPatientName, recordActivity } from '@/lib/activities'
import { resolveRouteParams, validateId } from '@/lib/patientCases'

export async function DELETE(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const caseId = validateId(routeParams?.id)
    const usageId = validateId(routeParams?.usageId)
    if (!caseId) {
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
    }
    if (!usageId) {
        return NextResponse.json({ success: false, error: 'Invalid usage id' }, { status: 400 })
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

        const result = await connection.query(
            `DELETE FROM case_usage
             WHERE id = $1 AND case_id = $2 AND domain = $3
             RETURNING id, patient_id, entry_date, description, quantity`,
            [usageId, caseId, domain]
        )
        const deletedUsage = result.rows?.[0] || null
        if (!deletedUsage) {
            return NextResponse.json({ success: false, error: 'Usage entry not found' }, { status: 404 })
        }

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'case_usage',
            entityId: deletedUsage.id,
            entityLabel: deletedUsage.description || `Case #${caseId} usage`,
            patientId: deletedUsage.patient_id,
            patientName: await loadActivityPatientName(connection, deletedUsage.patient_id, domain),
            metadata: { case_id: caseId },
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete usage' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
