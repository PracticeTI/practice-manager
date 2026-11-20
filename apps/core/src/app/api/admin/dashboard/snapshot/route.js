import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'

const ADMIN_DASHBOARD_SNAPSHOT_KEY = 'admin_dashboard_snapshot_v1'

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function normalizeScope(value) {
    return String(value || '').trim().toLowerCase() || 'default:all'
}

function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    const cachedAt = Number(value.cachedAt ?? 0)
    const refreshedAt = Number(value.refreshedAt ?? cachedAt ?? 0)
    const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
        ? value.payload
        : null

    if (!payload) return null

    return {
        cachedAt: Number.isFinite(cachedAt) ? cachedAt : Date.now(),
        refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : Date.now(),
        payload,
    }
}

function sanitizeSnapshotMap(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return Object.entries(source).reduce((acc, [scope, snapshot]) => {
        const normalizedSnapshot = normalizeSnapshot(snapshot)
        if (normalizedSnapshot) {
            acc[scope] = normalizedSnapshot
        }
        return acc
    }, {})
}

function getRequestedScopes(searchParams, adminUser) {
    const explicitScope = String(searchParams.get('scope') || '').trim()
    const mode = normalizeScope(searchParams.get('mode'))
    const userDomain = String(adminUser?.domain || '').trim().toLowerCase()

    if (explicitScope) {
        const normalizedExplicitScope = normalizeScope(explicitScope)
        const fallbackMode = normalizedExplicitScope.includes(':')
            ? normalizeScope(normalizedExplicitScope.split(':')[0])
            : mode
        return [normalizedExplicitScope, fallbackMode]
    }

    if (mode.includes(':')) {
        const fallbackMode = normalizeScope(mode.split(':')[0])
        return [mode, fallbackMode]
    }

    const scopedMode = `${mode}:${userDomain || 'all'}`
    return [scopedMode, mode]
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedScopes = getRequestedScopes(searchParams, adminUser)
        const snapshotMap = await getSystemStateValue(ADMIN_DASHBOARD_SNAPSHOT_KEY)
        const normalizedMap = sanitizeSnapshotMap(snapshotMap)
        const scope = requestedScopes.find((candidate) => normalizedMap[candidate]) || requestedScopes[0]
        const snapshot = normalizedMap[scope] || null

        return NextResponse.json({
            success: true,
            scope,
            snapshot,
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load dashboard snapshot' }, { status: 500 })
    }
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const scope = normalizeScope(payload?.scope)
        const snapshot = normalizeSnapshot(payload?.snapshot)
        if (!snapshot) {
            return NextResponse.json({ error: 'snapshot object is required' }, { status: 400 })
        }

        const existing = await getSystemStateValue(ADMIN_DASHBOARD_SNAPSHOT_KEY)
        const snapshotMap = sanitizeSnapshotMap(existing)
        snapshotMap[scope] = snapshot

        const ok = await setSystemStateValue(ADMIN_DASHBOARD_SNAPSHOT_KEY, snapshotMap)
        if (!ok) {
            return NextResponse.json({ error: 'Failed to persist dashboard snapshot' }, { status: 500 })
        }

        return NextResponse.json({ success: true, scope, snapshot })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to save dashboard snapshot' }, { status: 500 })
    }
}
