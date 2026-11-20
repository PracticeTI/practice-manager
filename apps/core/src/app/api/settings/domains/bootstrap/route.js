import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getAllDomainSettings, getDomainSetting } from '@/lib/appSettings'
import { getDefaultWebsiteFeatureFlag } from '@/lib/domainFeatureFlags'


function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function sanitizeDomainForResponse(domainSettings) {
    const source = domainSettings && typeof domainSettings === 'object' ? domainSettings : {}
    const apiKey = String(source.aiApiKey || '').trim()
    return {
        ...source,
        hasAiApiKey: apiKey.length > 0,
        aiApiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}` : '',
        aiApiKey: '',
    }
}

function sanitizeDomainsMapForResponse(domains) {
    const source = domains && typeof domains === 'object' ? domains : {}
    return Object.entries(source).reduce((acc, [domainKey, settings]) => {
        acc[domainKey] = sanitizeDomainForResponse(settings)
        return acc
    }, {})
}

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    return authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
}

function resolveScopedDomain(adminUser, requestedDomain) {
    const requested = normalizeDomainKey(requestedDomain)

    if (isSuperAdmin(adminUser)) {
        return requested
    }

    const scopedDomain = normalizeDomainKey(adminUser?.domain)
    if (!scopedDomain) return ''

    if (requested && requested !== scopedDomain) {
        return null
    }

    return scopedDomain
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedDomain = searchParams.get('domain')
        const domain = resolveScopedDomain(adminUser, requestedDomain)
        if (domain === null) {
            return NextResponse.json({ error: 'Forbidden: cannot load requested domain' }, { status: 403 })
        }

        const domains = isSuperAdmin(adminUser)
            ? await getAllDomainSettings('management')
            : domain
                ? { [domain]: (await getDomainSetting(domain, 'management')) || {} }
                : {}

        return NextResponse.json({
            success: true,
            domains: sanitizeDomainsMapForResponse(domains),
            websiteEnabledDefault: getDefaultWebsiteFeatureFlag(),
            source: Object.keys(domains).length ? 'domain_settings' : 'default',
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load domain settings bootstrap' }, { status: 500 })
    }
}
