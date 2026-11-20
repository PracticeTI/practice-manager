import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { getEquipmentAdminKey, markEquipmentSupplierAdminDeleted, updateEquipmentSupplier } from '@/lib/equipmentStore'

function parseId(value) {
    const id = Number.parseInt(String(value || ''), 10)
    return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(request, context) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    if (body?.status === 'hidden' && !isSuperAdmin(adminUser)) {
        return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 })
    }
    const params = await Promise.resolve(context?.params)
    const id = parseId(params?.id)
    if (!id) return NextResponse.json({ error: 'Invalid supplier ID' }, { status: 400 })
    try {
        const supplier = await updateEquipmentSupplier(id, body)
        if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
        return NextResponse.json({ success: true, supplier })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update supplier' }, { status: 400 })
    }
}

export async function DELETE(request, context) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const params = await Promise.resolve(context?.params)
    const id = parseId(params?.id)
    if (!id) return NextResponse.json({ error: 'Invalid supplier ID' }, { status: 400 })
    try {
        // Soft delete scoped to this admin only; the record remains visible to other
        // admins/the public directory until a superadmin review tool hard-deletes it.
        await markEquipmentSupplierAdminDeleted({ supplierId: id, adminKey: getEquipmentAdminKey(adminUser) })
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete supplier' }, { status: 400 })
    }
}