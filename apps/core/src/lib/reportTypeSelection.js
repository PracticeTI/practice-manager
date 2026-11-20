export function isOtf10ReportType(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized.includes('otf10')
        || normalized.includes('home-services-review')
        || normalized.includes('home services review')
}

// The NDIS Functional Capacity Assessment is the one report type with a builder
// (the step-by-step FCA Builder on /admin/reports), so callers use this to decide
// whether a report can be built/edited by hand or is worker-generated only.
// Both the configured id and its display name carry the phrase, matching the
// `isOtf10ReportType` shape: callers pass the id and the name separately.
export function isNdisFcaReportType(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized.includes('ndis-functional-capacity-assessment')
        || normalized.includes('functional capacity assessment')
}

export function selectHsrReportType(reportTypes, deletedReportMetadata = {}) {
    const configuredTypes = Array.isArray(reportTypes)
        ? reportTypes.filter((item) => item && typeof item === 'object' && item.isActive !== false)
        : []
    const requestedTypeId = String(deletedReportMetadata?.reportTypeId || '').trim()
    const requestedType = configuredTypes.find((item) => (
        requestedTypeId && String(item?.id || '').trim() === requestedTypeId
    ))

    if (requestedType && (
        isOtf10ReportType(requestedType.id)
        || isOtf10ReportType(requestedType.name)
    )) {
        return requestedType
    }

    return configuredTypes.find((item) => (
        isOtf10ReportType(item?.id)
        || isOtf10ReportType(item?.name)
    )) || null
}