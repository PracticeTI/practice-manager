import { VALID_DOMAIN_MODES } from '@/lib/domainMode'

export function normalizeImageDomain(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return VALID_DOMAIN_MODES.includes(normalized) ? normalized : null
}

export function withImageDomain(metadata = {}, domain) {
    const normalizedDomain = normalizeImageDomain(domain)
    if (!normalizedDomain) return metadata || {}

    return {
        ...(metadata || {}),
        domain: normalizedDomain
    }
}

export function getScopedImageStateKey(baseKey, domain) {
    const normalizedDomain = normalizeImageDomain(domain)
    return normalizedDomain ? `${baseKey}:${normalizedDomain}` : baseKey
}

function buildDomainExpression(dbType, metadataOnly) {
    return metadataOnly
        ? `LOWER(COALESCE("metadata"->>'domain', ''))`
        : `LOWER(COALESCE("attributes"->>'domain', "metadata"->>'domain', ''))`
}

export function buildImageDomainClause({
    dbType,
    domain,
    includeLegacy = false,
    metadataOnly = false,
    paramIndex = 1
}) {
    const normalizedDomain = normalizeImageDomain(domain)
    if (!normalizedDomain) {
        return { clause: '', params: [] }
    }

    const expression = buildDomainExpression(dbType, metadataOnly)
    const valueRef = `LOWER($${paramIndex})`
    const clause = includeLegacy
        ? `(${expression} = ${valueRef} OR ${expression} = '')`
        : `${expression} = ${valueRef}`

    return {
        clause,
        params: [normalizedDomain]
    }
}