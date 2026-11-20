export function getReportDisplayTimestamp(report) {
    const source = report && typeof report === 'object' && !Array.isArray(report) ? report : {}
    const status = String(source.status || '').trim().toLowerCase()
    const generatedAt = String(source.generatedAt || '').trim()
    const createdAt = String(source.createdAt || '').trim()
    const updatedAt = String(source.updatedAt || '').trim()
    const fallbackTimestamp = String(source.timestamp || '').trim()

    if (generatedAt) return generatedAt

    if (status === 'queued' || status === 'creating' || status === 'processing' || status === 'waiting') {
        return createdAt || updatedAt || fallbackTimestamp
    }

    return updatedAt || createdAt || fallbackTimestamp
}
