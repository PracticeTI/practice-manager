import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection, getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { resolvePublicOrigin, runDueReminders } from '@/lib/appointmentReminders'

function resolveRequestOrigin(request) {
    const requestUrl = new URL(request.url)
    const host = request.headers.get('x-forwarded-host')
        || request.headers.get('host')
        || requestUrl.host
    const protocol = request.headers.get('x-forwarded-proto')
        || requestUrl.protocol.replace(':', '')
        || 'http'
    return `${protocol}://${host}`
}

function readProvidedSecrets(request) {
    const secrets = []
    const authorization = request.headers.get('authorization') || ''
    if (authorization.startsWith('Bearer ')) {
        secrets.push(authorization.slice('Bearer '.length).trim())
    }
    const querySecret = new URL(request.url).searchParams.get('secret')
    if (querySecret) secrets.push(querySecret)
    return secrets
}

function providerSecret() {
    return String(
        process.env.SCHEDULING_REMINDER_RUN_SECRET
        || process.env.CRON_SECRET
        || process.env.CORE_BACKEND_SECRET
        || ''
    ).trim()
}

function parseBoundedInt(rawValue, { fallback, min, max }) {
    const parsed = Number.parseInt(String(rawValue ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

async function handleRun(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const requestUrl = new URL(request.url)
    const secret = providerSecret()
    let domain = String(requestUrl.searchParams.get('domain') || '').trim().toLowerCase()

    if (secret) {
        if (!readProvidedSecrets(request).includes(secret)) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }
    } else {
        // No shared secret configured: only an authenticated admin may run it,
        // scoped to their own domain.
        const context = await resolveAdminDomainScope(request, domain || null)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        domain = context.domain
    }

    const dryRun = ['1', 'true', 'yes'].includes(
        String(requestUrl.searchParams.get('dryRun') || '').toLowerCase()
    )
    const limit = parseBoundedInt(requestUrl.searchParams.get('limit'), {
        fallback: 100,
        min: 1,
        max: 500,
    })

    let connection = null
    try {
        await ensureSchedulingTables()
        // An admin run is scoped to one domain; the cron/service run sweeps every
        // domain that has upcoming appointments, which is a superadmin session.
        connection = domain
            ? await getDomainBoundConnection(domain)
            : await getSuperAdminConnection()

        let domains = domain ? [domain] : []
        if (domains.length === 0) {
            const result = await connection.query(
                `SELECT DISTINCT domain
                 FROM appointments
                 WHERE starts_at > NOW()
                   AND starts_at <= NOW() + INTERVAL '30 days'
                   AND appointment_status IN ('tentative', 'confirmed')
                   AND COALESCE(archived, FALSE) = FALSE
                 ORDER BY domain`
            )
            domains = (result.rows || []).map((row) => row.domain)
        }

        const origin = resolvePublicOrigin(resolveRequestOrigin(request))
        const summaries = []

        for (const domainKey of domains) {
            try {
                const summary = await runDueReminders(connection, {
                    domain: domainKey,
                    origin,
                    dryRun,
                    limit,
                })
                summaries.push(summary)
            } catch (error) {
                summaries.push({
                    domain: domainKey,
                    error: error?.message || 'Reminder run failed',
                })
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                dryRun,
                domains: summaries,
                sent: summaries.reduce((total, item) => total + (item.sent || 0), 0),
                skipped: summaries.reduce((total, item) => total + (item.skipped || 0), 0),
                failed: summaries.reduce((total, item) => total + (item.failed || 0), 0),
            },
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Reminder run failed' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function GET(request) {
    return handleRun(request)
}

export async function POST(request) {
    return handleRun(request)
}
