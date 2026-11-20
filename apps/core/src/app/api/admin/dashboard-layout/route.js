import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { resolveDomainModeFromHeaders } from '@/lib/domainMode'
import {
    getAdminDashboardCardOrder,
    saveAdminDashboardCardOrder,
} from '@/lib/adminDashboardLayouts'

/**
 * Per-admin Admin dashboard layout.
 *
 * The domain default is the `adminDashboardCardOrder` domain setting, edited on
 * /domains (superadmin only, see /api/settings/domains). This route only ever
 * reads or writes the caller's own row in `user_settings`, resolved from the
 * verified token's username rather than the request, so no admin can change
 * another's layout.
 *
 * `?domain=` names the domain the layout belongs to (a layout is per admin per
 * domain, because the available cards differ). A domain-scoped admin is pinned to
 * their own; a superadmin may name any domain and otherwise gets the one the
 * request host resolves to.
 */

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function readRequestedDomain(request) {
    try {
        return new URL(request.url).searchParams.get('domain')?.trim().toLowerCase() || ''
    } catch {
        return ''
    }
}

async function resolveLayoutScope(request, payload = null) {
    const adminUser = await verifyAdminToken(getAdminTokenFromRequest(request, payload))
    if (!adminUser) {
        return { error: 'Unauthorized: valid admin token required', status: 401 }
    }

    const username = typeof adminUser.username === 'string' ? adminUser.username.trim() : ''
    if (!username) {
        return { error: 'Forbidden: admin username is missing', status: 403 }
    }

    const adminDomain = String(adminUser.domain || '').trim().toLowerCase()
    const requestedDomain = readRequestedDomain(request)

    if (!isSuperAdmin(adminUser)) {
        if (!adminDomain) {
            return { error: 'Forbidden: admin domain scope is missing', status: 403 }
        }
        if (requestedDomain && requestedDomain !== adminDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { username, domain: adminDomain }
    }

    return {
        username,
        domain: requestedDomain || adminDomain || resolveDomainModeFromHeaders(request.headers),
    }
}

export async function GET(request) {
    const scope = await resolveLayoutScope(request)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    try {
        const cardOrder = await getAdminDashboardCardOrder(scope.domain, scope.username)
        return NextResponse.json({
            success: true,
            username: scope.username,
            domain: scope.domain,
            cardOrder,
        })
    } catch (error) {
        console.error('Load dashboard layout error:', error)
        return NextResponse.json({ error: error.message || 'Failed to load dashboard layout' }, { status: 500 })
    }
}

export async function PUT(request) {
    const body = await request.json().catch(() => null)
    const scope = await resolveLayoutScope(request, body)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const cardOrder = body?.cardOrder ?? null
    if (cardOrder !== null && !Array.isArray(cardOrder)) {
        return NextResponse.json({ error: 'cardOrder must be an array of card keys or null' }, { status: 400 })
    }
    if (Array.isArray(cardOrder) && cardOrder.some((cardKey) => typeof cardKey !== 'string')) {
        return NextResponse.json({ error: 'cardOrder entries must be card key strings' }, { status: 400 })
    }

    try {
        const savedOrder = await saveAdminDashboardCardOrder(scope.domain, scope.username, cardOrder)
        return NextResponse.json({
            success: true,
            username: scope.username,
            domain: scope.domain,
            cardOrder: savedOrder,
        })
    } catch (error) {
        console.error('Save dashboard layout error:', error)
        return NextResponse.json({ error: error.message || 'Failed to save dashboard layout' }, { status: 500 })
    }
}
