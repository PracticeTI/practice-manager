import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'
import { ensurePatientTranscriptionsTable } from '@/lib/patientTranscriptionsTable'
import { cleanupRecyclingItems, fetchRecyclingItems, restoreRecyclingItem } from '@/lib/recycling'

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function parseLimit(rawValue, defaultValue = 100, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function getRequestedDomain(request, payload = null) {
    if (payload && typeof payload === 'object') {
        const fromBody = normalizeDomain(payload.domain)
        if (fromBody) return fromBody
    }

    const { searchParams } = new URL(request.url)
    return normalizeDomain(searchParams.get('domain'))
}

async function resolveRequestContext(request, payload = null) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
        return { error: 'Missing Authorization header', status: 401 }
    }

    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
        return { error: 'Missing auth token', status: 401 }
    }

    const adminUser = await verifyAdminToken(token)
    if (!adminUser) {
        return { error: 'Invalid auth token', status: 401 }
    }

    const requestedDomain = getRequestedDomain(request, payload)
    const scopedDomain = normalizeDomain(adminUser?.domain)
    if (adminUser?.role !== 'superadmin' && scopedDomain) {
        if (requestedDomain && requestedDomain !== scopedDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { user: adminUser, domain: scopedDomain }
    }

    if (!requestedDomain) {
        return { error: 'domain is required', status: 400 }
    }

    return { user: adminUser, domain: requestedDomain }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveRequestContext(request, payload)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const action = String(payload?.action || '').trim().toLowerCase()
        if (action !== 'restore' && action !== 'cleanup') {
            return NextResponse.json({ success: false, error: 'Unsupported recycling action' }, { status: 400 })
        }

        await ensurePatientTranscriptionsTable()
        connection = await getDatabaseConnection()

        if (action === 'cleanup') {
            const result = await cleanupRecyclingItems({
                connection,
                dbType,
                domain: context.domain,
                scope: payload?.scope,
            })

            if (!result) {
                return NextResponse.json({ success: false, error: 'Unsupported cleanup option' }, { status: 400 })
            }

            return NextResponse.json({ success: true, action, result })
        }

        const record = await restoreRecyclingItem({
            connection,
            dbType,
            domain: context.domain,
            itemType: payload?.itemType,
            sourceId: payload?.sourceId,
            sourceTable: payload?.sourceTable,
        })

        if (!record) {
            return NextResponse.json({ success: false, error: 'Recycling item not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update recycling items' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const { searchParams } = new URL(request.url)
        const limit = parseLimit(searchParams.get('limit'))
        const sourceKey = normalizeDomain(searchParams.get('type') || 'all') || 'all'

        await ensurePatientTranscriptionsTable()
        connection = await getDatabaseConnection()

        const data = await fetchRecyclingItems({
            connection,
            dbType,
            domain: context.domain,
            limit,
            sourceKey,
        })

        return NextResponse.json({
            success: true,
            data,
            filters: {
                types: Array.from(new Set(data.map((item) => item.itemType).filter(Boolean))).sort(),
            },
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load recycling items' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
