import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { setEquipmentSupplierStatus } from '@/lib/equipmentStore'

function parseId(value) {
    const id = Number.parseInt(String(value || ''), 10)
    return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(request, context) {
    const adminUser = await verifyAdminAuth(request)
    if (!isSuperAdmin(adminUser)) return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 })

    const params = await Promise.resolve(context?.params)
    const id = parseId(params?.id)
    if (!id) return NextResponse.json({ error: 'Invalid supplier ID' }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    if (body?.status !== 'hidden') return NextResponse.json({ error: 'Only hidden status can be set from review' }, { status: 400 })

    try {
        const supplier = await setEquipmentSupplierStatus(id, 'hidden')
        if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
        return NextResponse.json({ success: true, supplier })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to hide supplier' }, { status: 400 })
    }
}