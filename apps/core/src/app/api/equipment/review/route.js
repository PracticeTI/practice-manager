import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { listEquipmentSupplierAdminDeletions, listEquipmentSuppliers } from '@/lib/equipmentStore'

export async function GET(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!isSuperAdmin(adminUser)) return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 })

    try {
        const [suppliers, deletions] = await Promise.all([
            listEquipmentSuppliers({ includeUnpublished: true, excludeHidden: false }),
            listEquipmentSupplierAdminDeletions(),
        ])
        return NextResponse.json({ success: true, suppliers, deletions })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load equipment review data' }, { status: 500 })
    }
}