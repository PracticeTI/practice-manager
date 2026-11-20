import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getDomainSetting, setDomainSetting } from '@/lib/appSettings'

const DOMAIN = 'default'
const SETTING_KEY = 'hero_thumbnail'

async function authorizeRequest(request, payload) {
    const authHeader = request.headers.get('authorization') || ''
    const adminTokenFromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    const adminToken =
        (typeof payload?.adminToken === 'string' ? payload.adminToken.trim() : '') ||
        adminTokenFromHeader

    const adminUser = await verifyAdminToken(adminToken)
    return {
        adminUser,
        adminToken
    }
}

export async function GET() {
    try {
        const value = await getDomainSetting(DOMAIN, SETTING_KEY)
        const settings = value && typeof value === 'object' ? value : {}
        const imageDataUrl = String(settings.imageDataUrl || '').trim()
        const thumbnailPath = String(settings.thumbnailPath || '').trim()
        const thumbnailUrl = String(settings.thumbnailUrl || '').trim()

        return NextResponse.json({
            success: true,
            thumbnailPath,
            thumbnailUrl: imageDataUrl || thumbnailUrl,
            updatedAt: String(settings.updatedAt || '')
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load default hero thumbnail settings' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const { adminUser } = await authorizeRequest(request, payload)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: invalid admin token' }, { status: 401 })
        }

        const imageDataUrl = String(payload?.imageDataUrl || '').trim()
        if (!imageDataUrl.startsWith('data:image/png;base64,')) {
            return NextResponse.json(
                { success: false, error: 'imageDataUrl must be a PNG data URL.' },
                { status: 400 }
            )
        }

        const base64Data = imageDataUrl.slice('data:image/png;base64,'.length)
        if (!base64Data) {
            return NextResponse.json({ success: false, error: 'Missing PNG image data.' }, { status: 400 })
        }

        const buffer = Buffer.from(base64Data, 'base64')
        if (!buffer || buffer.length === 0) {
            return NextResponse.json({ success: false, error: 'Failed to decode PNG image data.' }, { status: 400 })
        }

        const updatedAt = new Date().toISOString()
        const viewportWidth = Number(payload?.viewportWidth)
        await setDomainSetting(DOMAIN, SETTING_KEY, {
            // Keep image bytes in system_settings so the preview is independent of blob/filesystem storage.
            imageDataUrl,
            thumbnailPath: '',
            thumbnailUrl: '',
            contentType: 'image/png',
            bytes: buffer.length,
            viewportWidth: Number.isFinite(viewportWidth) ? viewportWidth : null,
            updatedAt
        })

        return NextResponse.json({
            success: true,
            thumbnailPath: '',
            thumbnailUrl: imageDataUrl,
            bytes: buffer.length,
            updatedAt
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to save default hero thumbnail' },
            { status: 500 }
        )
    }
}
