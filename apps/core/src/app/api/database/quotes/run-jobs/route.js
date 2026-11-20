import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import {
    getQuoteWriterConfig,
    readQuoteWriterQueueSummary,
    runQuoteWriterCycle,
} from '@/lib/quoteWriter'
import { authorizeOperatorRequest } from '@/lib/serviceRouteAuth'

// Drain endpoint for the Quote Writer queue.
//
// The worker lives in this app rather than in the worker service because quote
// lines are priced and validated against `ndisSupportCatalogue.js`, which is the
// single source of truth for NDIS price limits. This route is how an external
// scheduler (or `scripts/run-quote-writer.mjs`) drives it.
//
// Authorisation is the shared operator rule (service secret, superadmin token, or
// non-production), so a domain admin can never trigger bulk AI spend.

async function authorize(request) {
    return authorizeOperatorRequest(request)
}

export async function GET(request) {
    const access = await authorize(request)
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: 403 })
    }

    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()
        const summary = await readQuoteWriterQueueSummary(connection)
        const config = getQuoteWriterConfig()
        return NextResponse.json({
            success: true,
            workerEnabled: config.workerEnabled,
            batchSize: config.batchSize,
            maxAttempts: config.maxAttempts,
            queue: summary,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to read the queue' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request) {
    const access = await authorize(request)
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: 403 })
    }

    try {
        const payload = await request.json().catch(() => ({}))
        const batchSize = Number.parseInt(String(payload?.batch_size || ''), 10)
        const result = await runQuoteWriterCycle({
            // An explicit call always runs, even when the automatic worker is off:
            // the background toggle is for scheduled drains, not for this button.
            forceRun: true,
            batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : null,
        })
        return NextResponse.json({ success: true, via: access.via, result })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to run the Quote Writer' }, { status: 500 })
    }
}
