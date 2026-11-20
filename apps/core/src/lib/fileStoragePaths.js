/**
 * Object keys for files stored outside the database.
 *
 * A key is built once, when the file is uploaded, and stored on the row so a read
 * never has to guess where the bytes went. The shape keeps every practice's files
 * in its own namespace - shared buckets hold more than one practice - and keeps a
 * patient's files together so a backup or a patient export can copy one prefix.
 */

const MAX_FILE_NAME_LENGTH = 120
const FALLBACK_FILE_NAME = 'file'

/**
 * Reduce an uploaded name to something safe in a directory listing and a URL.
 * Path separators and control characters go, because the name becomes a path
 * segment; the original name stays on the row for display and download.
 */
export function sanitizeStorageFileName(value) {
    const name = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()

    const withoutTraversal = name
        .replace(/^[.\s-]+/, '')
        .replace(/\.{2,}/g, '.')
        .trim() || FALLBACK_FILE_NAME
    if (withoutTraversal.length <= MAX_FILE_NAME_LENGTH) return withoutTraversal
    return withoutTraversal.slice(-MAX_FILE_NAME_LENGTH).replace(/^[.-]+/, '') || FALLBACK_FILE_NAME
}

/** Practice keys are hostname-shaped; keep one from escaping its prefix. */
export function sanitizeStorageDomain(value) {
    const domain = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .replace(/^\.+/, '')
    return domain || 'default'
}

function joinKeyPrefix(prefix) {
    const normalized = String(prefix || '').replace(/^\/+|\/+$/g, '')
    return normalized ? `${normalized}/` : ''
}

/**
 * `domains/<domain>/patients/<patientId>/<fileId>-<name>` for a patient file and
 * `domains/<domain>/practice/<fileId>-<name>` for a practice-level one. The row id
 * makes the key unique even when two uploads share a name.
 */
export function buildFileStorageKey({ domain, patientId, fileId, fileName, prefix = '' }) {
    const normalizedFileId = String(fileId ?? '').trim()
    if (!normalizedFileId) throw new Error('A file id is required to build a storage key')

    const safeName = sanitizeStorageFileName(fileName)
    const numericPatientId = Number.parseInt(String(patientId ?? ''), 10)
    const ownerPath = Number.isFinite(numericPatientId) && numericPatientId > 0
        ? `patients/${numericPatientId}`
        : 'practice'

    return `${joinKeyPrefix(prefix)}domains/${sanitizeStorageDomain(domain)}/${ownerPath}/${normalizedFileId}-${safeName}`
}

/** Where a practice's files live inside a shared bucket or storage root. */
export function buildFileStorageDomainPrefix({ domain, prefix = '' }) {
    return `${joinKeyPrefix(prefix)}domains/${sanitizeStorageDomain(domain)}/`
}
