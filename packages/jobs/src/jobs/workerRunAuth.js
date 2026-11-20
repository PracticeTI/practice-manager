function resolveWorkerRunToken() {
    const configured = String(process.env.WORKER_RUN_TOKEN || '').trim()
    if (configured) return configured

    const fallback = String(process.env.CORE_BACKEND_SECRET || '').trim()
    if (fallback) return fallback

    return ''
}

export function isWorkerRunAuthorized(request) {
    const token = resolveWorkerRunToken()
    if (!token) {
        return true
    }

    const authHeader = request.headers.get('authorization') || ''
    const headerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''

    return Boolean(headerToken) && headerToken === token
}
