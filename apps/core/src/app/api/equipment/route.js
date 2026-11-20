import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import {
    createEquipmentSupplier,
    getEquipmentAdminKey,
    listEquipmentSuppliers,
} from '@/lib/equipmentStore'

export async function GET(request) {
    try {
        const adminUser = await verifyAdminAuth(request)
        const { searchParams } = new URL(request.url)
        const includeUnpublished = searchParams.get('admin') === '1' && Boolean(adminUser)
        const favoritesOnly = searchParams.get('favorites') === '1' && Boolean(adminUser)
        const viewerDomain = includeUnpublished && adminUser && !isSuperAdmin(adminUser) ? String(adminUser.domain || '') : ''
        const suppliers = await listEquipmentSuppliers({
            adminKey: adminUser ? getEquipmentAdminKey(adminUser) : '',
            includeUnpublished,
            favoritesOnly,
            viewerDomain,
        })
        return NextResponse.json({ success: true, suppliers })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load equipment suppliers' }, { status: 500 })
    }
}

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    try {
        const supplier = await createEquipmentSupplier(await request.json())
        return NextResponse.json({ success: true, supplier }, { status: 201 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create supplier' }, { status: 400 })
    }
}