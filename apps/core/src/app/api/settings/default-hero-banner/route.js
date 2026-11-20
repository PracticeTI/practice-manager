import { NextResponse } from 'next/server'
import { getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { verifyAdminToken } from '@/lib/auth'

const DOMAIN = 'default'
const SETTING_KEY = 'hero_banner'

function normalizeImageUrl(rawValue) {
    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!trimmed) return ''
    if (/^[a-z]+:\/\//i.test(trimmed) || trimmed.startsWith('//')) return trimmed
    if (trimmed.startsWith('/')) return trimmed
    if (trimmed.startsWith('public/')) return `/${trimmed.slice('public/'.length)}`
    return `/${trimmed}`
}

function normalizeGradientEnabled(rawValue) {
    if (typeof rawValue === 'boolean') return rawValue
    if (typeof rawValue === 'string') {
        const normalized = rawValue.trim().toLowerCase()
        if (normalized === 'false') return false
        if (normalized === 'true') return true
    }
    return true
}

function normalizeHeroBannerSettings(rawValue) {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return {
            imageUrl: normalizeImageUrl(rawValue.imageUrl),
            gradientEnabled: normalizeGradientEnabled(rawValue.gradientEnabled)
        }
    }

    return {
        imageUrl: normalizeImageUrl(rawValue),
        gradientEnabled: true
    }
}

export async function GET() {
    try {
        const value = await getDomainSetting(DOMAIN, SETTING_KEY)
        const settings = normalizeHeroBannerSettings(value)
        return NextResponse.json({
            success: true,
            imageUrl: settings.imageUrl,
            gradientEnabled: settings.gradientEnabled
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load default hero banner image' },
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

        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: invalid admin token' }, { status: 401 })
        }

        const imageUrl = normalizeImageUrl(payload?.imageUrl)
        const gradientEnabled = normalizeGradientEnabled(payload?.gradientEnabled)
        const saved = await setDomainSetting(DOMAIN, SETTING_KEY, {
            imageUrl,
            gradientEnabled
        })
        if (!saved) {
            return NextResponse.json({ success: false, error: 'Failed to save default hero banner image' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            imageUrl,
            gradientEnabled
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to update default hero banner image' },
            { status: 500 }
        )
    }
}