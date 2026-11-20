import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { countSystemStateRecords, deleteSystemStateValue, listSystemStateRecords, setSystemStateValue } from '@/lib/systemState'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

async function requireSuperAdmin(request, payload = null) {
    const adminToken = getAdminTokenFromRequest(request, payload)
    const adminUser = await verifyAdminToken(adminToken)
    return adminUser && isSuperAdmin(adminUser)
}

function normalizeKey(value) {
    return String(value || '').trim()
}

function normalizeValueText(value) {
    if (typeof value === 'string') return value
    if (value === undefined) return ''
    return JSON.stringify(value, null, 2)
}

function getListOptions(request) {
    const { searchParams } = new URL(request.url)
    const rawLimit = Number.parseInt(searchParams.get('limit') || '', 10)
    const rawOffset = Number.parseInt(searchParams.get('offset') || '', 10)

    return {
        limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT,
        offset: Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0,
        query: String(searchParams.get('q') || '').trim(),
    }
}

export async function GET(request) {
    try {
        if (!await requireSuperAdmin(request)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const options = getListOptions(request)
        const [records, total] = await Promise.all([
            listSystemStateRecords(options),
            countSystemStateRecords(options),
        ])
        return NextResponse.json({ success: true, records, total, ...options })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load system state records' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        if (!await requireSuperAdmin(request, payload)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const key = normalizeKey(payload?.key)
        if (!key) {
            return NextResponse.json({ error: 'key is required' }, { status: 400 })
        }

        const saved = await setSystemStateValue(key, normalizeValueText(payload?.value))
        if (!saved) {
            return NextResponse.json({ error: 'Failed to save system state record' }, { status: 500 })
        }

        return NextResponse.json({ success: true, key })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to save system state record' },
            { status: 500 }
        )
    }
}

export async function DELETE(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        if (!await requireSuperAdmin(request, payload)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const key = normalizeKey(payload?.key)
        if (!key) {
            return NextResponse.json({ error: 'key is required' }, { status: 400 })
        }

        const deleted = await deleteSystemStateValue(key)
        if (!deleted) {
            return NextResponse.json({ error: 'System state record not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, key })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to delete system state record' },
            { status: 500 }
        )
    }
}