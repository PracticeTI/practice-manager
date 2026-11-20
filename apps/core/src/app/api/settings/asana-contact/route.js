import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import {
    ASANA_CONTACT_SETTINGS_KEY,
    DEFAULT_ASANA_CONTACT_SETTINGS,
    isAsanaContactConfigured,
    normalizeAsanaContactSettings
} from '@/lib/asanaContactConfig'

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const adminTokenFromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''

    if (adminTokenFromHeader) return adminTokenFromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

async function loadSettings() {
    const stored = await getSystemStateValue(ASANA_CONTACT_SETTINGS_KEY)
    return normalizeAsanaContactSettings(stored || DEFAULT_ASANA_CONTACT_SETTINGS)
}

export async function GET(request) {
    try {
        const revealToken = new URL(request.url).searchParams.get('revealToken') === '1'
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const settings = await loadSettings()
        const hasAccessToken = Boolean(process.env.ASANA_ACCESS_TOKEN)

        return NextResponse.json({
            success: true,
            settings,
            status: {
                accessTokenConfigured: hasAccessToken,
                configured: isAsanaContactConfigured(settings, { hasAccessToken })
            },
            ...(revealToken ? { accessTokenValue: process.env.ASANA_ACCESS_TOKEN || '' } : {})
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load Asana contact settings' },
            { status: 500 }
        )
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

        const settings = normalizeAsanaContactSettings(payload?.settings)
        const saved = await setSystemStateValue(ASANA_CONTACT_SETTINGS_KEY, settings)
        if (!saved) {
            return NextResponse.json({ error: 'Failed to save Asana contact settings' }, { status: 500 })
        }

        const hasAccessToken = Boolean(process.env.ASANA_ACCESS_TOKEN)

        return NextResponse.json({
            success: true,
            settings,
            status: {
                accessTokenConfigured: hasAccessToken,
                configured: isAsanaContactConfigured(settings, { hasAccessToken })
            }
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update Asana contact settings' },
            { status: 500 }
        )
    }
}