import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveDomainSourcing } from '@/lib/equipmentSourcing'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function parseLimit(rawValue, defaultValue = 100, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

async function resolveRequestContext(request) {
    const auth = request.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) {
        return { error: 'Missing Authorization header', status: 401 }
    }

    const token = auth.replace('Bearer ', '').trim()
    if (!token) {
        return { error: 'Missing auth token', status: 401 }
    }

    const adminUser = await verifyAdminToken(token)
    if (!adminUser) {
        return { error: 'Invalid auth token', status: 401 }
    }

    const requestedDomain = normalizeDomainKey(new URL(request.url).searchParams.get('domain'))
    const scopedDomain = normalizeDomainKey(adminUser.domain)

    if (adminUser.role !== 'superadmin' && scopedDomain) {
        return { user: adminUser, domainScope: scopedDomain }
    }

    return { user: adminUser, domainScope: requestedDomain }
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
        const domain = normalizeDomainKey(context.domainScope)
        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const limit = parseLimit(searchParams.get('limit'))
        const patientIdParam = Number.parseInt(String(searchParams.get('patient_id') || ''), 10)
        const patientId = Number.isFinite(patientIdParam) && patientIdParam > 0 ? patientIdParam : null
        // Reconciliation is what moves a stored `quote_requested` item on to
        // `quote_received` once a supplier reply has been matched.
        const reconcile = String(searchParams.get('reconcile') || '1') !== '0'

        connection = await getDatabaseConnection()
        const { items, changes } = await resolveDomainSourcing(connection, domain, {
            persist: reconcile,
            patientId,
        })

        const counts = items.reduce((acc, item) => {
            acc[item.status] = (acc[item.status] || 0) + 1
            acc.total += 1
            return acc
        }, { total: 0, quote_requested: 0, quote_received: 0 })

        return NextResponse.json({
            success: true,
            domain,
            counts,
            changes,
            items: patientId === null ? items.slice(0, limit) : items,
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load sourcing items' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}
