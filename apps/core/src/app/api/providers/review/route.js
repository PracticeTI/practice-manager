import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { listProviderAdminDeletions, listProviders } from '@/lib/providersStore'

export async function GET(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!isSuperAdmin(adminUser)) return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 })

    try {
        const [providers, deletions] = await Promise.all([
            listProviders({ includeUnpublished: true, excludeHidden: false }),
            listProviderAdminDeletions(),
        ])
        return NextResponse.json({ success: true, providers, deletions })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load provider review data' }, { status: 500 })
    }
}
