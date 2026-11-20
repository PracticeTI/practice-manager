import { NextResponse } from 'next/server'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    DISPLAY_POLICY_SYSTEM_KEY,
    DEFAULT_DISPLAY_POLICY,
    normalizeDisplayPolicy,
} from '@/lib/displayPolicy'

export async function GET() {
    try {
        const storedPolicy = await getSystemStateValue(DISPLAY_POLICY_SYSTEM_KEY)

        const normalizedPolicy = normalizeDisplayPolicy(storedPolicy || DEFAULT_DISPLAY_POLICY)

        return NextResponse.json({
            success: true,
            policy: normalizedPolicy,
            source: storedPolicy ? 'system_settings' : 'default'
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load display policy' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const authHeader = request.headers.get('authorization') || ''
        const adminTokenFromHeader = authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length).trim()
            : ''
        const adminToken =
            (typeof payload?.adminToken === 'string' ? payload.adminToken.trim() : '') ||
            adminTokenFromHeader
        const policy = payload?.policy

        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const normalizedPolicy = normalizeDisplayPolicy(policy)
        const saved = await setSystemStateValue(DISPLAY_POLICY_SYSTEM_KEY, normalizedPolicy)
        if (!saved) {
            return NextResponse.json({ error: 'Failed to save display policy' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            policy: normalizedPolicy
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update display policy' },
            { status: 500 }
        )
    }
}
