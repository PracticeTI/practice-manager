function normalizeEmail(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase().slice(0, 100)
}

function parsePayloadJson(payloadJson) {
    if (!payloadJson) return {}
    if (typeof payloadJson === 'object' && !Array.isArray(payloadJson)) return payloadJson

    try {
        const parsed = JSON.parse(String(payloadJson || '{}'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function toIsoString(value) {
    if (!value) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function normalizeRecentEmailRows(rows, domainKey, recipient) {
    const normalizedDomain = normalizeDomain(domainKey)
    const normalizedRecipient = normalizeEmail(recipient)

    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            const payload = parsePayloadJson(row?.payload_json)
            const payloadDomain = normalizeDomain(payload?.domain)
            const payloadSubject = String(payload?.subject || '').trim()
            const payloadName = String(payload?.name || '').trim()

            return {
                id: row?.id ?? null,
                category: String(row?.category || '').trim().toLowerCase() || 'generic',
                status: String(row?.status || '').trim().toLowerCase() || 'queued',
                toEmail: normalizeEmail(row?.to_email),
                subject: String(row?.subject || '').trim() || payloadSubject || null,
                contactName: payloadName || null,
                payloadDomain: payloadDomain || normalizeDomain(row?.domain),
                createdAt: toIsoString(row?.created_at),
            }
        })
        .filter((row) => {
            if (row.category !== 'contact_form') return false
            if (row.payloadDomain) return row.payloadDomain === normalizedDomain
            return Boolean(normalizedRecipient && row.toEmail === normalizedRecipient)
        })
        .sort((a, b) => {
            const aTime = new Date(a?.createdAt || 0).getTime()
            const bTime = new Date(b?.createdAt || 0).getTime()
            return bTime - aTime
        })
        .slice(0, 3)
}