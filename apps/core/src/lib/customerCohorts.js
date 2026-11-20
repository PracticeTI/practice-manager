export const CUSTOMER_COHORTS_SETTINGS_KEY = 'customer_cohort_settings_v1'

function normalizeString(value) {
    return String(value || '').trim()
}

function normalizeMarkupPercent(value) {
    const parsed = Number.parseFloat(String(value ?? '').trim())
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.round(parsed * 100) / 100)
}

export function normalizeCustomerCohortKey(value) {
    return normalizeString(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export function normalizeCustomerCohort(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const key = normalizeCustomerCohortKey(source.key || source.id || source.name)
    const label = normalizeString(source.label || source.name || key)

    return {
        key,
        label: label || key,
        usageMarkupPercent: normalizeMarkupPercent(source.usageMarkupPercent),
        notes: normalizeString(source.notes),
        updatedAt: normalizeString(source.updatedAt) || null,
    }
}

export function normalizeCustomerCohorts(value) {
    const source = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? Object.values(value) : [])

    const seenKeys = new Set()
    const cohorts = []

    for (const item of source) {
        const normalized = normalizeCustomerCohort(item)
        if (!normalized.key || seenKeys.has(normalized.key)) {
            continue
        }

        seenKeys.add(normalized.key)
        cohorts.push(normalized)
    }

    return cohorts
}

export function getCustomerCohortByKey(cohorts, cohortKey) {
    const normalizedKey = normalizeCustomerCohortKey(cohortKey)
    if (!normalizedKey) return null

    return normalizeCustomerCohorts(cohorts).find((cohort) => cohort.key === normalizedKey) || null
}

export function resolveDomainUsageMarkupPercent(domainSettings, cohorts) {
    const normalizedSettings = domainSettings && typeof domainSettings === 'object' ? domainSettings : {}
    const customerCohortKey = normalizeCustomerCohortKey(normalizedSettings.customerCohortKey)
    const cohort = getCustomerCohortByKey(cohorts, customerCohortKey)

    return {
        customerCohortKey,
        customerCohort: cohort,
        usageMarkupPercent: cohort?.usageMarkupPercent || 0,
    }
}