import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { authorizeOperatorRequest } from '@/lib/serviceRouteAuth'
import { enqueueMissingAnalysisJobs } from '@/lib/patientAnalysisJobs'

// Backfill endpoint for the FCA Analyst.
//
// There is no worker to drive here - the analyst runs in the worker service. What this route owns is
// the *enqueue*, because the AI selection lives in this app. The worker service used to run this
// backfill itself, which meant the jobs it created carried no `aiUsage` block and the analyst fell
// back to a hardcoded model instead of the operator's chosen provider and tier.
//
// Authorisation is the shared operator rule (service secret, superadmin token, or non-production),
// so a domain admin can never trigger bulk AI spend.

export async function POST(request) {
    const access = await authorizeOperatorRequest(request)
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: 403 })
    }

    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        connection = await getDatabaseConnection()
        const result = await enqueueMissingAnalysisJobs({ connection, limit: payload?.batch_size })

        return NextResponse.json({ success: true, via: access.via, result })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to backfill analyst jobs' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
