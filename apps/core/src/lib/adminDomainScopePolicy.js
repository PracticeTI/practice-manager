export function normalizeAdminDomain(value) {
    return String(value || '').trim().toLowerCase()
}

export function selectAdminDomainScope(adminUser, requestedDomain, hasSuperAdminAccess) {
    if (!adminUser) {
        return { error: 'Unauthorized: valid admin token required', status: 401 }
    }

    const normalizedRequestedDomain = normalizeAdminDomain(requestedDomain)
    const adminDomain = normalizeAdminDomain(adminUser?.domain)

    if (!hasSuperAdminAccess) {
        if (!adminDomain) {
            return { error: 'Forbidden: admin domain scope is missing', status: 403 }
        }
        if (normalizedRequestedDomain && normalizedRequestedDomain !== adminDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { adminUser, domain: adminDomain }
    }

    const domain = normalizedRequestedDomain || adminDomain
    if (!domain) {
        return { error: 'domain is required', status: 400 }
    }

    return { adminUser, domain }
}