import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { DEFAULT_BG_GRADIENT_TREATMENT, getDomainTemplateColors } from '@/lib/domainPageStyles'
import { getDomainSetting, getDomainSettings, setDomainSetting } from '@/lib/appSettings'

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

function normalizePaletteKey(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizeSettings(raw, domain) {
    const source = raw && typeof raw === 'object' ? raw : {}
    const colors = getDomainTemplateColors({ colors: source.colors }, domain)

    return {
        enabled: normalizeBoolean(source.enabled, false),
        editMode: normalizeBoolean(source.editMode, false),
        paletteKey: normalizePaletteKey(source.paletteKey),
        bgGradientTreatment: String(source.bgGradientTreatment || '').trim() || DEFAULT_BG_GRADIENT_TREATMENT,
        colors,
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

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const domain = normalizeDomainKey(searchParams.get('domain'))

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const settingsByKey = await getDomainSettings(domain, ['homepage_palette', 'management'])
        const management = settingsByKey.management && typeof settingsByKey.management === 'object'
            ? settingsByKey.management
            : null
        const resolvedSettings = settingsByKey.homepage_palette
            || (management?.homepagePalette && typeof management.homepagePalette === 'object'
                ? management.homepagePalette
                : null)
        const settings = normalizeSettings(resolvedSettings, domain)

        return NextResponse.json({ success: true, domain, settings })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load domain homepage palette settings' },
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

        const scopedAdminDomain = normalizeDomainKey(adminUser?.domain)
        if (!isSuperAdmin(adminUser) && scopedAdminDomain !== domain) {
            return NextResponse.json({ success: false, error: 'Unauthorized: domain scope mismatch' }, { status: 403 })
        }

        const nextSettings = {
            ...normalizeSettings(payload?.settings, domain),
            updatedAt: new Date().toISOString(),
        }

        const existing = await getDomainSetting(domain, 'management')
        const currentDomainEntry = existing && typeof existing === 'object' ? existing : {}

        const savedPalette = await setDomainSetting(domain, 'homepage_palette', nextSettings)
        const savedManagement = await setDomainSetting(domain, 'management', {
            ...currentDomainEntry,
            homepagePalette: nextSettings,
            updatedAt: new Date().toISOString(),
        })
        if (!savedPalette || !savedManagement) {
            return NextResponse.json({ success: false, error: 'Failed to save domain homepage palette settings' }, { status: 500 })
        }

        return NextResponse.json({ success: true, domain, settings: nextSettings })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to update domain homepage palette settings' },
            { status: 500 }
        )
    }
}
