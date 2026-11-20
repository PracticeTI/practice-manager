import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { ADMIN_DOMAIN_COOKIE, normalizeAdminDomainKey } from '@/lib/adminDomainCookie'
import { getDomainSetting } from '@/lib/appSettings'
import { DEFAULT_DOMAIN_KEY, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { normalizeDomainFeatureFlags } from '@/lib/domainFeatureFlags'
import {
    PRACTICE_SEARCH_ENTITY_TYPES,
    PRACTICE_SEARCH_MIN_QUERY_LENGTH,
    normalizePracticeSearchLimit,
} from '@/lib/practiceSearchCatalog'
import { resolvePracticeSearchAdminKey, searchPracticeRecords } from '@/lib/practiceSearch'

export const runtime = 'nodejs'


function getBearerToken(request) {
    const authHeader = request.headers.get('authorization') || ''
    return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
}

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

/**
 * Resolve the practice domain whose data the header search should look at,
 * mirroring how the admin portal itself resolves its active domain
 * (see `src/app/admin/layout.jsx`): a domain-scoped admin always uses their own
 * domain, otherwise the session's admin domain cookie, otherwise the
 * hostname-scoped mode.
 */
function resolveSearchDomainKey(adminUser, request) {
    const assignedDomain = normalizeDomainKey(adminUser?.domain)
    if (assignedDomain) return assignedDomain

    const cookieDomain = normalizeAdminDomainKey(request.cookies?.get?.(ADMIN_DOMAIN_COOKIE)?.value)
    if (cookieDomain) return cookieDomain

    return normalizeDomainKey(resolveDomainModeFromHeaders(request.headers)) || DEFAULT_DOMAIN_KEY
}

/**
 * The entity types this practice actually has turned on. A type is in scope only
 * when the admin header search is enabled for the domain AND the entity's own
 * feature flag is on, so the box never offers something the admin cannot open.
 */
function resolveEnabledEntityTypes(domainSettings, domainKey) {
    const directoryFlags = normalizeDomainFeatureFlags(domainSettings, domainKey)

    return PRACTICE_SEARCH_ENTITY_TYPES.filter((entityType) => {
        if (entityType.featureFlagKey === 'patientsEnabled') {
            return domainSettings?.patientsEnabled === true
        }
        return directoryFlags[entityType.featureFlagKey] === true
    })
}

/**
 * GET /api/admin/practice-search
 *
 * Without `?q=` this reports whether the header search is available for the
 * current practice and which entity types it covers (used to render the box).
 * With `?q=` it returns the matching Patients/Providers/Suppliers records.
 *
 * `?limit=` raises the per-type result count for the full results page
 * (`/admin/search`); it is clamped by `normalizePracticeSearchLimit`.
 */
export async function GET(request) {
    const adminUser = await verifyAdminToken(getBearerToken(request))
    if (!adminUser) {
        return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const query = String(searchParams.get('q') || '').trim()
        const limitPerType = normalizePracticeSearchLimit(searchParams.get('limit'))
        const domainKey = resolveSearchDomainKey(adminUser, request)

        const domainSettings = (await getDomainSetting(domainKey, 'management')) || {}
        const flags = normalizeDomainFeatureFlags(domainSettings, domainKey)
        const enabledEntityTypes = flags.practiceSearchEnabled === true
            ? resolveEnabledEntityTypes(domainSettings, domainKey)
            : []

        const enabled = enabledEntityTypes.length > 0
        const entityTypes = enabledEntityTypes.map((entityType) => ({
            key: entityType.key,
            label: entityType.label,
        }))

        if (!enabled || query.length < PRACTICE_SEARCH_MIN_QUERY_LENGTH) {
            return NextResponse.json({
                success: true,
                enabled,
                domainKey,
                query,
                entityTypes,
                results: [],
            })
        }

        const { results, searchedTypes, typeErrors } = await searchPracticeRecords({
            query,
            domainKey,
            adminKey: resolvePracticeSearchAdminKey(adminUser),
            entityTypeKeys: enabledEntityTypes.map((entityType) => entityType.key),
            limitPerType,
        })

        return NextResponse.json({
            success: true,
            enabled,
            domainKey,
            query,
            entityTypes,
            searchedTypes,
            results,
            // Per-type failures are reported but never fail the whole search.
            typeErrors: typeErrors.length ? typeErrors : undefined,
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Practice search failed' },
            { status: 500 }
        )
    }
}
