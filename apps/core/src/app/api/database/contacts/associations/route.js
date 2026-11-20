import { NextResponse } from 'next/server'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { buildAssociationOptions } from '@/lib/contactAssociations'
import { listProviders } from '@/lib/providersStore'
import { listEquipmentSuppliers } from '@/lib/equipmentStore'
import { listFunders } from '@/lib/fundersStore'

/**
 * Association suggestions for the Contacts editor.
 *
 * The association field stays free text, so this endpoint only ever supplies
 * type-ahead candidates drawn from the directories the platform already keeps:
 * allied health providers, equipment suppliers and funding bodies. A directory
 * that is missing or broken is skipped rather than failing the whole lookup, so
 * one absent table can't leave the editor without suggestions from the others.
 */
async function safeList(loader) {
    try {
        const rows = await loader()
        return Array.isArray(rows) ? rows : []
    } catch (error) {
        console.warn('[contacts/associations] lookup source unavailable:', error?.message || error)
        return []
    }
}

export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }

    const [providers, suppliers, funders] = await Promise.all([
        safeList(() => listProviders()),
        safeList(() => listEquipmentSuppliers()),
        safeList(() => listFunders({ includeUnpublished: false })),
    ])

    return NextResponse.json({
        success: true,
        associations: buildAssociationOptions({ providers, suppliers, funders }),
    })
}
