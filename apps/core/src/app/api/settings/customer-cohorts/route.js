import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    CUSTOMER_COHORTS_SETTINGS_KEY,
    normalizeCustomerCohorts,
} from '@/lib/customerCohorts'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const stored = await getSystemStateValue(CUSTOMER_COHORTS_SETTINGS_KEY)
        const cohorts = normalizeCustomerCohorts(stored)

        return NextResponse.json({
            success: true,
            cohorts,
            source: stored ? 'system_settings' : 'default',
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load customer cohorts' }, { status: 500 })
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        if (!Array.isArray(payload?.cohorts)) {
            return NextResponse.json({ error: 'cohorts array is required' }, { status: 400 })
        }

        const now = new Date().toISOString()
        const cohorts = normalizeCustomerCohorts(payload.cohorts)
            .map((cohort) => ({
                ...cohort,
                updatedAt: now,
            }))

        const ok = await setSystemStateValue(CUSTOMER_COHORTS_SETTINGS_KEY, cohorts)
        if (!ok) {
            return NextResponse.json({ error: 'Failed to persist customer cohorts' }, { status: 500 })
        }

        return NextResponse.json({ success: true, cohorts })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to save customer cohorts' }, { status: 500 })
    }
}