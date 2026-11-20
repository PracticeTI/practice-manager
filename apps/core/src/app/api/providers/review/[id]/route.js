import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { setProviderStatus } from '@/lib/providersStore'

function parseId(value) {
    const id = Number.parseInt(String(value || ''), 10)
    return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(request, context) {
    const adminUser = await verifyAdminAuth(request)
    if (!isSuperAdmin(adminUser)) return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 })
    const params = await Promise.resolve(context?.params)
    const id = parseId(params?.id)
    if (!id) return NextResponse.json({ error: 'Invalid provider ID' }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    try {
        const provider = await setProviderStatus(id, body?.status)
        if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
        return NextResponse.json({ success: true, provider })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update provider status' }, { status: 400 })
    }
}
