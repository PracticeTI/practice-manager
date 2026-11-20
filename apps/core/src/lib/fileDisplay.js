/**
 * Small presentational helpers shared by the Files page and the Files dashboard card.
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** `1536` -> `1.5 KB`. Sizes on the Files page are shown, never compared. */
export function formatFileSize(bytes) {
    const value = Number(bytes)
    if (!Number.isFinite(value) || value < 0) return ''
    if (value < 1024) return `${value} B`

    let size = value
    let unitIndex = 0
    while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
        size /= 1024
        unitIndex += 1
    }
    const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10
    return `${rounded} ${SIZE_UNITS[unitIndex]}`
}

/**
 * Who a stored file belongs to. Practice-level files have no patient, which is the
 * distinction the Files page filters on, so it gets a real label rather than a dash.
 *
 * Rows come from the API in its snake_case shape, and the dashboard card passes the
 * same rows through, so both spellings are read.
 */
export function describeFileOwner(file = {}) {
    const name = String(file.patientName || file.patient_name || '').trim()
    if (name) return name

    const numericPatientId = Number.parseInt(String(file.patientId ?? file.patient_id ?? ''), 10)
    if (Number.isFinite(numericPatientId) && numericPatientId > 0) return `Patient #${numericPatientId}`
    return 'Practice'
}

/** Deep link into a patient's Files tab, with an optional return path. */
export function buildPatientFilesHref(patientId, { returnTo } = {}) {
    const numericPatientId = Number.parseInt(String(patientId ?? ''), 10)
    if (!Number.isFinite(numericPatientId) || numericPatientId <= 0) return ''

    const params = new URLSearchParams({
        patientId: String(numericPatientId),
        tab: 'files',
    })
    const target = String(returnTo || '').trim()
    if (target) params.set('returnTo', target)
    return `/admin/patients?${params.toString()}`
}
