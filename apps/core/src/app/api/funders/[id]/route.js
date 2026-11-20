import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { deleteFunder, getFunderById, updateFunder } from '@/lib/fundersStore'

/**
 * A single Funder record, addressed by numeric id.
 *
 * Any admin session may read it; only a superadmin may change it, so a domain
 * admin's `/admin/funders` library is read-only.
 */

function parseFunderId(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function requireSuperAdmin(adminUser) {
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(adminUser)) {
        return NextResponse.json({ success: false, error: 'Superadmin access required' }, { status: 403 })
    }
    return null
}

export async function GET(request, { params }) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const routeParams = await params
        const funderId = parseFunderId(routeParams?.id)
        if (!funderId) {
            return NextResponse.json({ success: false, error: 'Invalid funder id' }, { status: 400 })
        }

        const funder = await getFunderById(funderId)
        if (!funder) {
            return NextResponse.json({ success: false, error: 'Funder not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, funder })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load funder' },
            { status: 500 }
        )
    }
}

export async function PATCH(request, { params }) {
    const denied = requireSuperAdmin(await verifyAdminAuth(request))
    if (denied) return denied

    try {
        const routeParams = await params
        const funderId = parseFunderId(routeParams?.id)
        if (!funderId) {
            return NextResponse.json({ success: false, error: 'Invalid funder id' }, { status: 400 })
        }

        const body = await request.json().catch(() => ({}))
        const funder = await updateFunder(funderId, body)
        return NextResponse.json({ success: true, funder })
    } catch (error) {
        const message = error?.message || 'Failed to update funder'
        const status = message === 'Funder not found' ? 404 : 400
        return NextResponse.json({ success: false, error: message }, { status })
    }
}

export async function DELETE(request, { params }) {
    const denied = requireSuperAdmin(await verifyAdminAuth(request))
    if (denied) return denied

    try {
        const routeParams = await params
        const funderId = parseFunderId(routeParams?.id)
        if (!funderId) {
            return NextResponse.json({ success: false, error: 'Invalid funder id' }, { status: 400 })
        }

        const result = await deleteFunder(funderId)
        return NextResponse.json({ success: true, ...result })
    } catch (error) {
        const message = error?.message || 'Failed to delete funder'
        const status = message === 'Funder not found' ? 404 : 400
        return NextResponse.json({ success: false, error: message }, { status })
    }
}
