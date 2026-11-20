import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { createFunderDocument, listFunderDocuments } from '@/lib/fundersStore'

/**
 * The documents attached to a Funder.
 *
 * Any admin session may read them; only a superadmin may add one.
 */

function parseFunderId(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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

        const documents = await listFunderDocuments(funderId)
        return NextResponse.json({ success: true, documents })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load funder documents' },
            { status: 500 }
        )
    }
}

export async function POST(request, { params }) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(adminUser)) {
        return NextResponse.json({ success: false, error: 'Superadmin access required' }, { status: 403 })
    }

    try {
        const routeParams = await params
        const funderId = parseFunderId(routeParams?.id)
        if (!funderId) {
            return NextResponse.json({ success: false, error: 'Invalid funder id' }, { status: 400 })
        }

        const body = await request.json().catch(() => ({}))
        const document = await createFunderDocument(funderId, body)
        return NextResponse.json({ success: true, document }, { status: 201 })
    } catch (error) {
        const message = error?.message || 'Failed to create funder document'
        const status = message === 'Funder not found' ? 404 : 400
        return NextResponse.json({ success: false, error: message }, { status })
    }
}
