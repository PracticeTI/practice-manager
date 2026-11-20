export function  normalizeStringArray(value) {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(
        value
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ))
}

export function  normalizeOptionalStringId(value) {
    return String(value || '').trim()
}

export function  normalizeLookupText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

export function  normalizeObjectKeys(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeObjectKeys(item))
    }

    if (!value || typeof value !== 'object') {
        return value
    }

    return Object.keys(value)
        .sort((a, b) => a.localeCompare(b))
        .reduce((acc, key) => {
            acc[key] = normalizeObjectKeys(value[key])
            return acc
        }, {})
}

export function  safeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function  sanitizeModalErrorMessage(message, fallbackMessage) {
    const text = String(message || '').trim()
    if (!text) {
        return String(fallbackMessage || 'Something went wrong').trim() || 'Something went wrong'
    }

    const lowerText = text.toLowerCase()
    if (lowerText.includes('failed to fetch') || lowerText.includes('networkerror') || lowerText.includes('unexpected end of json input')) {
        return String(fallbackMessage || 'Something went wrong').trim() || 'Something went wrong'
    }

    return text
}

export function  formatDraftTimestamp(value) {
    const timestamp = String(value || '').trim()
    if (!timestamp) return ''
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return ''

    return date.toLocaleString('en-AU', {
        timeZone: 'Australia/Melbourne',
        timeZoneName: 'short',
    })
}

export function  toLocalDatetimeInput(value) {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''

    const pad = (num) => String(num).padStart(2, '0')
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function  toIsoOrNull(localValue) {
    const text = String(localValue || '').trim()
    if (!text) return null
    const date = new Date(text)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function  formatBillingAmount(value) {
    if (value === null || value === undefined || value === '') return '-'

    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return '-'

    const absoluteLabel = Math.abs(numericValue).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

    return `${numericValue < 0 ? '-$' : '$'}${absoluteLabel}`
}

export function  formatApproximateFileSize(value) {
    const bytes = Number(value || 0)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

    const units = ['B', 'KB', 'MB', 'GB']
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const amount = bytes / (1024 ** unitIndex)
    const rounded = unitIndex === 0 || amount >= 10 ? Math.round(amount) : Math.round(amount * 10) / 10
    return `${rounded} ${units[unitIndex]}`
}
