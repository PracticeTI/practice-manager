import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { deleteFunderDocument, updateFunderDocument } from '@/lib/fundersStore'

/**
 * A single document on a Funder. Read-only for domain admins: both verbs here are
 * writes, so both require a superadmin.
 */

function parseId(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function resolveIds(params) {
    const routeParams = await params
    return {
        funderId: parseId(routeParams?.id),
        documentId: parseId(routeParams?.documentId),
    }
}

async function requireSuperAdmin(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(adminUser)) {
        return NextResponse.json({ success: false, error: 'Superadmin access required' }, { status: 403 })
    }
    return null
}

export async function PATCH(request, { params }) {
    const denied = await requireSuperAdmin(request)
    if (denied) return denied

    try {
        const { funderId, documentId } = await resolveIds(params)
        if (!funderId || !documentId) {
            return NextResponse.json({ success: false, error: 'Invalid funder or document id' }, { status: 400 })
        }

        const body = await request.json().catch(() => ({}))
        const document = await updateFunderDocument(funderId, documentId, body)
        return NextResponse.json({ success: true, document })
    } catch (error) {
        const message = error?.message || 'Failed to update funder document'
        const status = message === 'Document not found' ? 404 : 400
        return NextResponse.json({ success: false, error: message }, { status })
    }
}

export async function DELETE(request, { params }) {
    const denied = await requireSuperAdmin(request)
    if (denied) return denied

    try {
        const { funderId, documentId } = await resolveIds(params)
        if (!funderId || !documentId) {
            return NextResponse.json({ success: false, error: 'Invalid funder or document id' }, { status: 400 })
        }

        const result = await deleteFunderDocument(funderId, documentId)
        return NextResponse.json({ success: true, ...result })
    } catch (error) {
        const message = error?.message || 'Failed to delete funder document'
        const status = message === 'Document not found' ? 404 : 400
        return NextResponse.json({ success: false, error: message }, { status })
    }
}
