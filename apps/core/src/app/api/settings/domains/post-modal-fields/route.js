import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getAllDomainSettings, getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { DEFAULT_CONTENT_DOMAIN, VALID_DOMAIN_MODES } from '@/lib/domainMode'


const ALLOWED_DOMAINS = VALID_DOMAIN_MODES

function normalizeDomainKey(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized || normalized === 'core') return DEFAULT_CONTENT_DOMAIN
    return normalized
}

function isAllowedDomain(domainKey) {
    return ALLOWED_DOMAINS.includes(domainKey)
}

function normalizeVisibility(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
        description: source.description !== false,
        body: source.body !== false,
    }
}

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function sanitizeDomainsMap(domainsSettings) {
    const source = domainsSettings && typeof domainsSettings === 'object' ? domainsSettings : {}
    const result = {}

    for (const domainKey of ALLOWED_DOMAINS) {
        const domainSettings = source?.[domainKey] && typeof source[domainKey] === 'object'
            ? source[domainKey]
            : {}
        result[domainKey] = normalizeVisibility(domainSettings.postModalFieldVisibility)
    }

    return result
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        if (isSuperAdmin(adminUser)) {
            const domains = await getAllDomainSettings('management')
            return NextResponse.json({
                success: true,
                canManageAllDomains: true,
                postModalFieldVisibility: sanitizeDomainsMap(domains),
                source: Object.keys(domains).length ? 'domain_settings' : 'default',
            })
        }

        const scopedDomain = normalizeDomainKey(adminUser?.domain)
        if (!scopedDomain || !isAllowedDomain(scopedDomain)) {
            return NextResponse.json({ error: 'Unauthorized: admin domain scope required' }, { status: 403 })
        }

        const scopedSettings = await getDomainSetting(scopedDomain, 'management')
        const scopedVisibility = sanitizeDomainsMap({ [scopedDomain]: scopedSettings || {} })

        return NextResponse.json({
            success: true,
            canManageAllDomains: false,
            scopedDomain,
            postModalFieldVisibility: {
                [scopedDomain]: scopedVisibility[scopedDomain] || normalizeVisibility(null),
            },
            source: scopedSettings ? 'domain_settings' : 'default',
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load post modal field settings' }, { status: 500 })
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const normalizedDomainKey = normalizeDomainKey(payload?.domainKey)
        if (!normalizedDomainKey || !isAllowedDomain(normalizedDomainKey)) {
            return NextResponse.json({ error: 'Valid domainKey is required' }, { status: 400 })
        }

        const scopedDomain = normalizeDomainKey(adminUser?.domain)
        if (!isSuperAdmin(adminUser)) {
            if (!scopedDomain || !isAllowedDomain(scopedDomain)) {
                return NextResponse.json({ error: 'Unauthorized: admin domain scope required' }, { status: 403 })
            }
            if (normalizedDomainKey !== scopedDomain) {
                return NextResponse.json({ error: 'Unauthorized: domain scope mismatch' }, { status: 403 })
            }
        }

        const normalizedVisibility = normalizeVisibility(payload?.visibility)
        const existing = (await getDomainSetting(normalizedDomainKey, 'management')) || {}
        const merged = {
            ...existing,
            postModalFieldVisibility: normalizedVisibility,
            domainKey: normalizedDomainKey,
            updatedAt: new Date().toISOString(),
        }

        const ok = await setDomainSetting(normalizedDomainKey, 'management', merged)
        if (!ok) {
            return NextResponse.json({ error: 'Failed to persist post modal field settings' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            domainKey: normalizedDomainKey,
            visibility: normalizedVisibility,
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to save post modal field settings' }, { status: 500 })
    }
}