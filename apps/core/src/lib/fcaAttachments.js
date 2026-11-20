// Reference-file helpers for the FCA builder's Step 8 ("Report Focus & Attachments").
//
// Attached files are patient file-store rows (`patient_files`). A file is
// "attached" when it appears in the builder form data's `attachmentFiles`, and
// its extracted text (when the type can be read) is folded into
// `attachmentContext`, which rides along with the queued report as context for
// the worker.
//
// `attachmentContext` is the single source of truth: the per-file texts are
// parsed back out of it, so attachments survive a draft save/reload without a
// second copy of the text being stored.

/**
 * Per-file text cap; keeps one huge export from crowding out everything else.
 *
 * 60,000 characters is roughly 15,000 tokens - a fraction of a modern context window - and matches
 * the analyst's per-document cap, so a document reads the same whether it is attached to the report
 * or routed through reference documents.
 */
export const MAX_ATTACHMENT_TEXT_CHARS = 60000

/** Cap for the combined context block, which the worker reads as `additionalContext`. */
export const MAX_ATTACHMENT_CONTEXT_CHARS = 120000

/**
 * Appended by whichever layer cuts a document short.
 *
 * Both capping layers (`extractAttachmentText` and `serializeAttachmentContext`) use the same
 * 60,000-character limit, so the outer layer cannot tell a cut document from a naturally shorter
 * one - the layer that drops the characters has to say so, or the stored text simply ends
 * mid-sentence and reads as if that is where the document ended.
 */
export const ATTACHMENT_TRUNCATION_MARKER = '\n[truncated]'

/** Trim `text` to `limit`, reserving room for the marker so the result still fits the budget. */
export function truncateAttachmentText(text, limit) {
    const budget = Math.max(0, limit - ATTACHMENT_TRUNCATION_MARKER.length)
    return `${String(text || '').slice(0, budget).trimEnd()}${ATTACHMENT_TRUNCATION_MARKER}`
}

/** Marks the start of a section in `attachmentContext`. */
export const ATTACHMENT_SECTION_PREFIX = '=== Attached file:'

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const PDF_MIME_TYPE = 'application/pdf'

export const TEXT_LIKE_MIME_TYPES = new Set([
    'application/json',
    'application/ld+json',
    'application/xml',
    'application/x-ndjson',
    'application/csv',
    'application/x-yaml',
])

export const TEXT_LIKE_EXTENSIONS = new Set([
    'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'ndjson',
    'xml', 'html', 'htm', 'log', 'yaml', 'yml', 'sql',
])

/**
 * Consultation recordings. They are deliberately kept out of the file picker: a recording has no
 * readable text, so it cannot contribute context, and the consultation's content already reaches
 * the report through its transcript summary. The list covers the containers the transcriber
 * accepts, not just the `.webm` the browser recorder writes.
 */
export const RECORDING_EXTENSIONS = new Set([
    'webm', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr',
    'mp4', 'm4v', 'mov', 'mkv', 'avi',
])

function safeString(value) {
    return String(value ?? '').trim()
}

export function resolveFileExtension(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(safeString(fileName))
    return match ? match[1].toLowerCase() : ''
}

/**
 * How a stored file's text can be obtained.
 *
 * - `docx` needs the server-side mammoth conversion
 * - `pdf` needs the server-side PDF text layer extraction, which a scanned
 *   document may not have
 * - `text` is read straight from the bytes
 * - `binary` (images, recordings, and scans with no text layer) cannot be read,
 *   so it stays a named reference in the report context
 */
export function classifyAttachmentTextSource(mimeType, fileName) {
    const mime = safeString(mimeType).toLowerCase()
    const extension = resolveFileExtension(fileName)

    if (mime === DOCX_MIME_TYPE || extension === 'docx') return 'docx'
    if (mime === PDF_MIME_TYPE || extension === 'pdf') return 'pdf'
    if (mime.startsWith('text/') || TEXT_LIKE_MIME_TYPES.has(mime) || TEXT_LIKE_EXTENSIONS.has(extension)) return 'text'
    return 'binary'
}

export function isTextExtractable(mimeType, fileName) {
    return classifyAttachmentTextSource(mimeType, fileName) !== 'binary'
}

/**
 * Whether a file is a consultation recording.
 *
 * Compared with `isTextExtractable` this is narrower on purpose: PDFs and images are also
 * unreadable, but they are still worth attaching as a named reference, whereas a recording is not.
 */
export function isRecordingFile(mimeType, fileName) {
    const mime = safeString(mimeType).toLowerCase()
    if (mime.startsWith('audio/') || mime.startsWith('video/')) return true
    return RECORDING_EXTENSIONS.has(resolveFileExtension(fileName))
}

/** Accepts either a `patient_files` API row (`file_name`) or a normalised entry (`fileName`). */
export function isRecordingAttachment(row) {
    const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {}
    return isRecordingFile(source.mimeType || source.mime_type, source.fileName || source.file_name)
}

/** Normalise a `patient_files` row (API shape) into the stored attachment shape. */
export function toAttachmentEntry(record) {
    const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {}
    const id = safeString(source.id)
    const fileName = safeString(source.fileName || source.file_name)

    if (!id || !fileName) return null

    const fileSize = Number(source.fileSize ?? source.file_size)

    return {
        id,
        fileName,
        mimeType: safeString(source.mimeType || source.mime_type),
        fileSize: Number.isFinite(fileSize) && fileSize >= 0 ? fileSize : 0,
        createdAt: safeString(source.createdAt || source.created_at),
    }
}

/** Normalise the `attachmentFiles` value restored from a draft or sent to the worker. */
export function normalizeAttachmentFiles(value) {
    if (!Array.isArray(value)) return []

    return value
        .map((item) => toAttachmentEntry(item))
        .filter(Boolean)
        .filter((file, index, files) => files.findIndex((other) => other.id === file.id) === index)
}

export function formatFileSize(bytes) {
    const size = Number(bytes)
    if (!Number.isFinite(size) || size <= 0) return '0 KB'
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function formatAttachmentDate(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
}

function readText(store, id) {
    if (!store) return ''
    if (typeof store.get === 'function') return safeString(store.get(id))
    return safeString(store[id])
}

function buildSectionHeader(file) {
    return `${ATTACHMENT_SECTION_PREFIX} ${file.fileName} | ${file.mimeType || 'unknown-type'} | file:${file.id} ===`
}

function readSectionId(headerLine) {
    const match = /file:([^|\s=]+)\s*=+\s*$/.exec(safeString(headerLine))
    return match ? match[1] : ''
}

/**
 * Build the `attachmentContext` block for the files that are attached and whose
 * text is known. Files with no readable text are skipped - their names still
 * reach the worker through `attachmentFiles`.
 */
export function serializeAttachmentContext(files, textsById) {
    const blocks = []
    let remaining = MAX_ATTACHMENT_CONTEXT_CHARS

    for (const file of normalizeAttachmentFiles(files)) {
        if (remaining <= 0) break

        const text = readText(textsById, file.id)
        if (!text) continue

        const limit = Math.min(MAX_ATTACHMENT_TEXT_CHARS, remaining)
        const body = text.length > limit ? truncateAttachmentText(text, limit) : text

        blocks.push(`${buildSectionHeader(file)}\n${body}`)
        remaining -= body.length
    }

    return blocks.join('\n\n')
}

/** Read the per-file texts back out of an `attachmentContext` block. */
export function parseAttachmentContext(context) {
    const texts = new Map()
    const raw = String(context || '').replace(/\r\n?/g, '\n')
    if (!raw.trim()) return texts

    let currentId = ''
    let buffer = []

    const flush = () => {
        if (!currentId) return
        texts.set(currentId, buffer.join('\n').trim())
    }

    for (const line of raw.split('\n')) {
        if (line.startsWith(ATTACHMENT_SECTION_PREFIX)) {
            flush()
            buffer = []
            currentId = readSectionId(line)
            continue
        }

        if (currentId) buffer.push(line)
    }

    flush()

    return texts
}

/**
 * Merge the file store with anything already attached, so attachments restored
 * from a draft that has since been deleted from the store are still visible.
 */
export function buildAttachmentRows(patientFiles, attachedFiles) {
    const rows = normalizeAttachmentFiles(patientFiles)
    const knownIds = new Set(rows.map((file) => file.id))

    for (const file of normalizeAttachmentFiles(attachedFiles)) {
        if (knownIds.has(file.id)) continue
        rows.push({ ...file, missing: true })
    }

    return rows
}

/**
 * Split Step 8's extracted file text out of the builder form data that is
 * queued for the worker: the text travels as queue context (`additionalContext`)
 * so it gets its own budget instead of being duplicated inside the builder
 * state.
 */
export function splitAttachmentContextFromBuilderFormData(builderFormData) {
    if (!builderFormData || typeof builderFormData !== 'object' || Array.isArray(builderFormData)) {
        return { formData: null, attachmentContext: '' }
    }

    const { attachmentContext = '', ...formData } = builderFormData

    return { formData, attachmentContext: safeString(attachmentContext) }
}
