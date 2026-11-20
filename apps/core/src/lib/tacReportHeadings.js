export function isTacSectionLabel(value) {
    return /^section\s+\d+$/i.test(String(value || '').trim())
}

export function normalizeTacHeading(value) {
    return String(value || '').trim().toUpperCase()
}