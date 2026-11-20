import { NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/auth'
import { getEquipmentAdminKey, setEquipmentFavorite } from '@/lib/equipmentStore'

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const supplierId = Number.parseInt(String(body?.supplier_id || ''), 10)
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
        return NextResponse.json({ error: 'Valid supplier_id is required' }, { status: 400 })
    }
    try {
        await setEquipmentFavorite({
            supplierId,
            adminKey: getEquipmentAdminKey(adminUser),
            favorite: body?.favorite !== false,
        })
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update favourite' }, { status: 400 })
    }
}