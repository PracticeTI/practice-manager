import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordImportActivity } from '@/lib/activities'
import { importAppointmentsFromCsv } from '@/lib/appointmentImport'
import { linkAppointmentsToSchedulingEntities } from '@/lib/schedulingLink'
import { DEFAULT_EXTERNAL_SOURCE, cleanString } from '@/lib/appointments'

// Body can be JSON ({ domain, csv, source, dryRun, fileName }) or a raw CSV
// document (text/csv) with `domain` / `source` supplied as query parameters.
async function readImportRequest(request) {
    const contentType = cleanString(request.headers.get('content-type')).toLowerCase()

    if (contentType.includes('application/json')) {
        const payload = await request.json().catch(() => ({}))
        return {
            domain: payload?.domain,
            csvText: typeof payload?.csv === 'string' ? payload.csv : '',
            source: payload?.source,
            dryRun: payload?.dryRun === true,
            fileName: payload?.fileName,
        }
    }

    const csvText = await request.text().catch(() => '')
    const { searchParams } = new URL(request.url)
    return {
        domain: searchParams.get('domain'),
        csvText,
        source: searchParams.get('source'),
        dryRun: ['1', 'true', 'yes'].includes(cleanString(searchParams.get('dryRun')).toLowerCase()),
        fileName: searchParams.get('fileName'),
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const requestData = await readImportRequest(request)
        const context = await resolveAdminDomainScope(request, requestData.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const csvText = cleanString(requestData.csvText)
        if (!csvText) {
            return NextResponse.json({ success: false, error: 'No CSV content was provided' }, { status: 400 })
        }

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const summary = await importAppointmentsFromCsv(connection, dbType, {
            domain,
            csvText: requestData.csvText,
            source: requestData.source || DEFAULT_EXTERNAL_SOURCE,
            dryRun: requestData.dryRun,
        })

        const schedulingLinks = requestData.dryRun
            ? null
            : await linkAppointmentsToSchedulingEntities(connection, { domain })

        await recordImportActivity({
            domain,
            entityType: 'appointment',
            summary,
            fileName: cleanString(requestData.fileName),
            source: requestData.source || DEFAULT_EXTERNAL_SOURCE,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({
            success: true,
            data: {
                ...summary,
                domain,
                schedulingLinks,
                fileName: cleanString(requestData.fileName) || null,
            },
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to import appointments' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
