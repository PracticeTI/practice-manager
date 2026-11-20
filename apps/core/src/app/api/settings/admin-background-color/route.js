import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getDomainSetting, getDomainSettings, setDomainSetting } from '@/lib/appSettings'

function normalizeDomainKey(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return /^[a-z0-9_-]+$/.test(normalized) ? normalized : ''
}

function normalizeHexColor(value, fallback = '#f8fafc') {
    const trimmed = String(value || '').trim()
    if (!trimmed) return fallback

    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
        return withHash.toLowerCase()
    }

    if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
        const [, red, green, blue] = withHash
        return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
    }

    return fallback
}

function normalizeSettings(raw, domain) {
    const source = raw && typeof raw === 'object' ? raw : {}
    return {
        color: normalizeHexColor(source.color),
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    }
}

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

async function getHomepageBackgroundColor(domain) {
    const settings = await getDomainSettings(domain, ['homepage_palette', 'management'])
    const management = settings.management && typeof settings.management === 'object' ? settings.management : null
    const palette = settings.homepage_palette || management?.homepagePalette || null

    return palette?.colors?.backgroundColor || '#f8fafc'
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const domain = normalizeDomainKey(searchParams.get('domain'))

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const adminColorSettings = await getDomainSetting(domain, 'admin_background_color')

        const settings = normalizeSettings(adminColorSettings, domain)

        // Get the homepage background color as fallback
        const homepageBackgroundColor = await getHomepageBackgroundColor(domain)

        return NextResponse.json({
            success: true,
            domain,
            settings,
            defaultColor: homepageBackgroundColor
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load admin background color settings' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const domain = normalizeDomainKey(payload?.domain)
        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: invalid admin token' }, { status: 401 })
        }

        const scopedAdminDomain = String(adminUser?.domain || '').trim().toLowerCase()
        if (!isSuperAdmin(adminUser) && scopedAdminDomain !== domain) {
            return NextResponse.json({ success: false, error: 'Unauthorized: domain scope mismatch' }, { status: 403 })
        }

        const nextSettings = {
            ...normalizeSettings(payload?.settings, domain),
            updatedAt: new Date().toISOString(),
        }

        const saved = await setDomainSetting(domain, 'admin_background_color', nextSettings)
        if (!saved) {
            return NextResponse.json({ success: false, error: 'Failed to save admin background color settings' }, { status: 500 })
        }

        return NextResponse.json({ success: true, domain, settings: nextSettings })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to update admin background color settings' },
            { status: 500 }
        )
    }
}
