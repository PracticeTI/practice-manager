import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getDomainSetting } from '@/lib/appSettings'
import {
    getDefaultAdminQuickActionsConfig,
    normalizeAdminQuickActionsConfig,
} from '@/lib/adminQuickActions'
import { normalizeDomainFeatureFlags } from '@/lib/domainFeatureFlags'
import { DEFAULT_DOMAIN_KEY } from '@/lib/domainMode'


function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return ''
    return authHeader.slice('Bearer '.length).trim()
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedDomainKey = String(searchParams.get('domainKey') || '').trim().toLowerCase()
        const scopedDomainKey = String(adminUser?.domain || '').trim().toLowerCase()

        if (!isSuperAdmin(adminUser) && !scopedDomainKey) {
            return NextResponse.json({ error: 'Unauthorized: admin domain scope required' }, { status: 403 })
        }

        const domainKey = isSuperAdmin(adminUser)
            ? (requestedDomainKey || DEFAULT_DOMAIN_KEY)
            : scopedDomainKey

        const domainSettings = (await getDomainSetting(domainKey, 'management')) || {}
        const quickActions = normalizeAdminQuickActionsConfig(domainSettings?.adminQuickActions)
        const quickActionsEnabled = normalizeDomainFeatureFlags(domainSettings, domainKey).quickActionsEnabled
        const homePageBlockEditorEnabled = domainSettings?.homePageBlockEditorEnabled === true
        const patientsEnabled = domainSettings?.patientsEnabled === true
        const docsCardEnabled = patientsEnabled && domainSettings?.docsCardEnabled !== false
        const recentUpdatesEnabled = domainSettings?.recentUpdatesEnabled !== false

        return NextResponse.json({
            success: true,
            domainKey,
            quickActions,
            quickActionsEnabled,
            homePageBlockEditorEnabled,
            patientsEnabled,
            docsCardEnabled,
            recentUpdatesEnabled,
            defaults: getDefaultAdminQuickActionsConfig(),
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load domain quick actions' }, { status: 500 })
    }
}
