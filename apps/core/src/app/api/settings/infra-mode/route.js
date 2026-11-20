import { NextResponse } from 'next/server'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'

const INFRA_MODE_KEY = 'infra_mode'
const VALID_MODES = new Set(['onboard', 'external-tenant'])

export async function GET(request) {
    try {
        const authHeader = request.headers.get('authorization') || ''
        const adminToken = authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length).trim()
            : ''
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const stored = await getSystemStateValue(INFRA_MODE_KEY)
        const normalized = typeof stored === 'string' ? stored.trim().toLowerCase() : null

        if (normalized && VALID_MODES.has(normalized)) {
            return NextResponse.json({
                success: true,
                mode: normalized,
                source: 'system_settings'
            })
        }

        return NextResponse.json({
            success: true,
            mode: 'onboard',
            source: 'default'
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load infra mode' },
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
        const mode = payload?.mode

        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
        if (!VALID_MODES.has(normalized)) {
            return NextResponse.json({ error: 'mode must be one of: onboard, external-tenant' }, { status: 400 })
        }

        const saved = await setSystemStateValue(INFRA_MODE_KEY, normalized)
        if (!saved) {
            return NextResponse.json({ error: 'Failed to save infra mode' }, { status: 500 })
        }

        return NextResponse.json({ success: true, mode: normalized })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update infra mode' },
            { status: 500 }
        )
    }
}
