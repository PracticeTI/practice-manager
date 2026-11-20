import { NextResponse } from 'next/server'
import { getDomainSetting } from '@/lib/appSettings'

/**
 * Public per-domain flag endpoint for the floating "Admin" link.
 *
 * The flag itself is managed from /domains (Domain Settings → Features) and is
 * persisted inside `domain_management_settings_v1[domain].adminFloatingLinkEnabled`.
 * It is intentionally off unless explicitly enabled for that domain.
 */


function normalizeDomainKey(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return /^[a-z0-9_-]+$/.test(normalized) ? normalized : ''
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1') return true
        if (normalized === 'false' || normalized === '0') return false
    }
    return fallback
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const domain = normalizeDomainKey(searchParams.get('domain'))

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const domainEntry = await getDomainSetting(domain, 'management')

        return NextResponse.json({
            success: true,
            domain,
            adminFloatingLinkEnabled: normalizeBoolean(domainEntry?.adminFloatingLinkEnabled, false),
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load domain admin link settings' },
            { status: 500 }
        )
    }
}
