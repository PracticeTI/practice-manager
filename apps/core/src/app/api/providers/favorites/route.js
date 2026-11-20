import { NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/auth'
import { getProviderAdminKey, setProviderFavorite } from '@/lib/providersStore'

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const providerId = Number.parseInt(String(body?.provider_id || ''), 10)
    if (!Number.isInteger(providerId) || providerId <= 0) {
        return NextResponse.json({ error: 'Valid provider_id is required' }, { status: 400 })
    }
    try {
        await setProviderFavorite({
            providerId,
            adminKey: getProviderAdminKey(adminUser),
            favorite: body?.favorite !== false,
        })
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update favourite' }, { status: 400 })
    }
}
