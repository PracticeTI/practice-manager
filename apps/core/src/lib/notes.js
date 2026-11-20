// Shared helpers for the Notes entity.
//
// A "note" is one clinical note handed to the practice by an external
// practice-management system (a Splose "notes" CSV export is the reference
// format): a title, the note body, the patient and practitioner it belongs to
// and the appointment it was written against.
//
// The body is stored exactly as the export serialised it (a ProseMirror/TipTap
// document) and flattened to plain text in `content_text`, which is what list
// views, previews and search use.
//
// When the imported template carries the note's creation time, that instant is
// kept in `created_at` instead of being replaced by the import time.
//
// Kept DB-agnostic and free of Node-only APIs so the CSV parser and the note
// rendering helpers can also run in the browser for import previews.

import { normalizeCsvHeader, parseCsv } from './csv.js'

export const DEFAULT_EXTERNAL_SOURCE = 'splose'

// Rows typed in through the API are not owned by an external system, so they
// get their own source and never collide with an imported id.
export const MANUAL_EXTERNAL_SOURCE = 'manual'

export const MAX_IMPORT_ROWS = 5000

// Note bodies are long; the flattened text only needs a sanity cap.
const MAX_CONTENT_TEXT_LENGTH = 200000

// ---------------------------------------------------------------------------
// Small shared coercions
// ---------------------------------------------------------------------------
export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableString(value, maxLength = 255) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : null
}

export function cleanOptionalText(value, maxLength = MAX_CONTENT_TEXT_LENGTH) {
    const text = String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n').trim()
    if (!text) return null
    return text.slice(0, maxLength)
}

export function toBool(value) {
    if (typeof value === 'boolean') return value
    const text = cleanString(value).toLowerCase()
    return ['1', 'true', 'yes', 'y', 'on'].includes(text)
}

export function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

export function validateId(rawId) {
    const parsed = Number.parseInt(String(rawId ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

// The export renders timestamps as ISO-8601 UTC. The zoneless variants an
// importer template can carry are accepted too and read as UTC, so the same
// file always imports the same instant.
function parseExportInstant(value) {
    const text = cleanString(value)
    if (!text) return null
    // Only the ISO date-first shape is understood; anything else would be
    // parsed in the server's local zone and shift between machines.
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null

    let normalized = text
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
        normalized = `${normalized.slice(0, 10)}T${normalized.slice(11)}`
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) {
        normalized = `${normalized}Z`
    }

    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Read an imported note timestamp as an ISO-8601 string, or null when the cell
 * is empty or not a date.
 */
export function parseImportedTimestamp(value) {
    return parseExportInstant(value)
}

// ---------------------------------------------------------------------------
// Note body
// ---------------------------------------------------------------------------

// The export serialises the body as a rich-text document. Anything that is not
// already a document (a bare array of nodes, a JSON string, or plain text) is
// wrapped so callers always deal with one shape. Normalising is idempotent.
function coerceContentObject(value) {
    if (value === null || value === undefined) return null

    if (typeof value === 'string') {
        const text = value.trim()
        if (!text) return null
        try {
            return coerceContentObject(JSON.parse(text))
        } catch {
            return noteDocumentFromText(value)
        }
    }

    if (Array.isArray(value)) {
        return value.length > 0 ? { type: 'doc', content: value } : null
    }

    if (typeof value !== 'object') return null

    const type = cleanString(value.type)
    if (Array.isArray(value.content)) return { ...value, type: type || 'doc' }
    return type ? value : null
}

/**
 * Wrap plain text in the document shape the `content` column stores: one
 * paragraph per line. Notes written in the app are plain text, so this is the
 * bridge between the composer and the renderer.
 */
export function noteDocumentFromText(text) {
    const lines = String(text === null || text === undefined ? '' : text).replace(/\r\n/g, '\n').split('\n')

    return {
        type: 'doc',
        content: lines.map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : [],
        })),
    }
}

export function normalizeNoteContent(value) {
    return coerceContentObject(value)
}

/**
 * Join the bodies of several notes into one plain-text blob.
 *
 * Callers that treat "the patient's notes" as a single body - the FCA builder
 * and the report workers - read the Notes entity this way instead of relying on
 * a denormalised copy on the patient record.
 */
export function joinNoteText(rows, separator = '\n\n') {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => cleanString(row?.content_text) || extractNoteText(row?.content))
        .filter((text) => text !== '')
        .join(separator)
}

// The text carried by inline nodes (text nodes, hard breaks, inline images).
function inlineText(nodes) {
    return (Array.isArray(nodes) ? nodes : []).map((node) => {
        if (!node || typeof node !== 'object') return ''
        if (typeof node.text === 'string') return node.text

        const type = cleanString(node.type)
        if (type === 'hardBreak') return '\n'
        if (type === 'image') return '[image]'
        if (Array.isArray(node.content)) return inlineText(node.content)
        return ''
    }).join('')
}

function normalizeHeadingLevel(attrs) {
    const level = Number.parseInt(String(attrs?.level ?? ''), 10)
    if (!Number.isFinite(level)) return 3
    return Math.min(Math.max(level, 1), 6)
}

const LIST_NODE_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

function pushBlocks(nodes, blocks, depth) {
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
        if (!node || typeof node !== 'object') return

        const type = cleanString(node.type)
        const children = Array.isArray(node.content) ? node.content : []

        switch (type) {
            case 'doc':
                pushBlocks(children, blocks, depth)
                return
            case 'heading':
                blocks.push({ kind: 'heading', level: normalizeHeadingLevel(node.attrs), text: inlineText(children) })
                return
            case 'codeBlock':
                blocks.push({ kind: 'code', text: inlineText(children) })
                return
            case 'blockquote':
                blocks.push({ kind: 'quote', text: inlineText(children) })
                return
            case 'horizontalRule':
                blocks.push({ kind: 'rule' })
                return
            case 'image':
                blocks.push({ kind: 'image', alt: cleanString(node.attrs?.alt) })
                return
            case 'table':
                blocks.push({
                    kind: 'table',
                    rows: children.map((row) => (Array.isArray(row?.content) ? row.content : [])
                        .map((cell) => inlineText(cell?.content))),
                })
                return
            case 'bulletList':
            case 'orderedList':
            case 'taskList': {
                const ordered = type === 'orderedList'
                children.forEach((item, index) => {
                    const itemChildren = Array.isArray(item?.content) ? item.content : []
                    // A nested list belongs to the item but must not be inlined
                    // into its text.
                    const nested = itemChildren.filter((child) => LIST_NODE_TYPES.has(cleanString(child?.type)))
                    const text = itemChildren
                        .filter((child) => !LIST_NODE_TYPES.has(cleanString(child?.type)))
                        .map((child) => inlineText(child?.content))
                        .filter((part) => cleanString(part) !== '')
                        .join(' ')

                    blocks.push({
                        kind: 'listItem',
                        ordered,
                        index: index + 1,
                        depth,
                        text,
                        checked: type === 'taskList' ? item?.attrs?.checked === true : null,
                    })

                    if (nested.length > 0) pushBlocks(nested, blocks, depth + 1)
                })
                return
            }
            case 'listItem':
            case 'taskItem':
                pushBlocks(children, blocks, depth)
                return
            default: {
                const text = inlineText(children)
                if (cleanString(text) !== '') blocks.push({ kind: 'paragraph', text })
            }
        }
    })
}

/**
 * Flatten a note body into renderable blocks, in document order.
 *
 * Blocks: `{ kind: 'heading', level, text }`, `{ kind: 'paragraph', text }`,
 * `{ kind: 'listItem', ordered, index, depth, text, checked }`,
 * `{ kind: 'quote'|'code', text }`, `{ kind: 'image', alt }`,
 * `{ kind: 'table', rows }`, `{ kind: 'rule' }`.
 */
export function buildNoteBlocks(content) {
    const doc = normalizeNoteContent(content)
    if (!doc) return []

    const blocks = []
    if (Array.isArray(doc.content)) pushBlocks(doc.content, blocks, 0)
    else pushBlocks([doc], blocks, 0)
    return blocks
}

function blockToText(block) {
    switch (block?.kind) {
        case 'heading':
        case 'paragraph':
        case 'code':
            return String(block.text || '')
        case 'quote':
            return cleanString(block.text) ? `> ${block.text}` : ''
        case 'image':
            return cleanString(block.alt) ? `[image: ${block.alt}]` : '[image]'
        case 'table':
            return (Array.isArray(block.rows) ? block.rows : [])
                .map((row) => (Array.isArray(row) ? row.join(' | ') : ''))
                .join('\n')
        case 'listItem': {
            const indent = '  '.repeat(Math.max(block.depth || 0, 0))
            const marker = block.ordered ? `${block.index}.` : '-'
            return cleanString(block.text) ? `${indent}${marker} ${block.text}` : ''
        }
        default:
            return ''
    }
}

/**
 * Flatten a note body into plain text (used for `content_text`, previews and
 * search).
 */
export function extractNoteText(content) {
    return buildNoteBlocks(content).map(blockToText).filter((part) => part !== '').join('\n')
}

export function countNoteWords(text) {
    const value = String(text === undefined || text === null ? '' : text).trim()
    if (!value) return 0
    return value.split(/\s+/).filter(Boolean).length
}

/**
 * The `content_text` projection for a note body.
 */
export function buildNoteContentText(content) {
    return cleanOptionalText(extractNoteText(content))
}

/**
 * True when a body carries nothing readable - an empty document, or one that
 * only held structural noise.
 */
export function isEmptyNoteContent(content) {
    const blocks = buildNoteBlocks(content)
    if (blocks.length === 0) return true

    return !blocks.some((block) => {
        if (block.kind === 'image') return true
        if (block.kind === 'rule') return false
        if (block.kind === 'table') {
            return (block.rows || []).some((row) => (row || []).some((cell) => cleanString(cell) !== ''))
        }
        return cleanString(block.text) !== ''
    })
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export const NOTE_COLUMN_KEYS = [
    'external_id',
    'external_source',
    'title',
    'draft',
    'content',
    'content_text',
    'patient_id',
    'patient_name',
    'external_patient_id',
    'external_appointment_id',
    'practitioner_name',
    'external_practitioner_id',
    'created_at',
    'metadata',
]

// Maps both the raw export headers and friendlier header names onto the
// canonical note field names. Keys are the output of `normalizeCsvHeader`.
const CSV_HEADER_ALIASES = new Map([
    ['id', 'external_id'],
    ['note id', 'external_id'],
    ['external id', 'external_id'],
    ['title', 'title'],
    ['note title', 'title'],
    ['draft', 'draft'],
    ['is draft', 'draft'],
    ['created at', 'created_at'],
    ['created', 'created_at'],
    ['created on', 'created_at'],
    ['created date', 'created_at'],
    ['date created', 'created_at'],
    ['content', 'content'],
    ['note content', 'content'],
    ['note', 'content'],
    ['patient name', 'patient_name'],
    ['client name', 'patient_name'],
    ['patient', 'patient_name'],
    ['patient id', 'external_patient_id'],
    ['client id', 'external_patient_id'],
    ['practitioner name', 'practitioner_name'],
    ['practitioner', 'practitioner_name'],
    ['author', 'practitioner_name'],
    ['practitioner id', 'external_practitioner_id'],
    ['author id', 'external_practitioner_id'],
    ['appointment id', 'external_appointment_id'],
    ['appointment', 'external_appointment_id'],
])

function lookupHeaderAlias(rawHeader) {
    return CSV_HEADER_ALIASES.get(normalizeCsvHeader(rawHeader)) || null
}

/**
 * Parse a CSV document into note-shaped records.
 * Returns { records, unknownHeaders, rowCount }.
 */
export function parseNoteCsv(text) {
    const rows = parseCsv(text)
    if (rows.length === 0) {
        return { records: [], unknownHeaders: [], rowCount: 0 }
    }

    const [headerRow, ...dataRows] = rows
    const columnMap = []
    const unknownHeaders = []
    const seenHeaders = new Set()

    headerRow.forEach((rawHeader) => {
        const canonicalMatch = lookupHeaderAlias(rawHeader)
        columnMap.push(canonicalMatch || null)
        const label = cleanString(rawHeader)
        if (!canonicalMatch && label && !seenHeaders.has(label)) {
            seenHeaders.add(label)
            unknownHeaders.push(label)
        }
    })

    const records = dataRows.map((cells, index) => {
        const raw = {}
        columnMap.forEach((canonicalHeader, columnIndex) => {
            if (!canonicalHeader) return
            raw[canonicalHeader] = cells[columnIndex]
        })
        return { rowNumber: index + 2, raw }
    })

    return { records, unknownHeaders, rowCount: dataRows.length }
}

/**
 * Normalise the raw CSV cells into the canonical note record shape.
 */
export function normalizeNoteRecord(raw) {
    return {
        external_id: cleanNullableString(raw?.external_id, 120),
        external_source: cleanNullableString(raw?.external_source, 64),
        title: cleanNullableString(raw?.title, 255),
        draft: toBool(raw?.draft),
        content: normalizeNoteContent(raw?.content),
        content_text: buildNoteContentText(raw?.content),
        patient_name: cleanNullableString(raw?.patient_name, 255),
        external_patient_id: cleanNullableString(raw?.external_patient_id, 120),
        external_appointment_id: cleanNullableString(raw?.external_appointment_id, 120),
        practitioner_name: cleanNullableString(raw?.practitioner_name, 255),
        external_practitioner_id: cleanNullableString(raw?.external_practitioner_id, 120),
        created_at: parseImportedTimestamp(raw?.created_at),
    }
}

/**
 * Provenance for the external note, kept in the `metadata` column.
 */
export function buildNoteProvenance(record, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE
    const blocks = buildNoteBlocks(record?.content)

    return {
        sploseNote: {
            externalId: record?.external_id || null,
            externalSource: normalizedSource,
            title: record?.title || null,
            draft: record?.draft === true,
            practitionerName: record?.practitioner_name || null,
            externalPractitionerId: record?.external_practitioner_id || null,
            externalAppointmentId: record?.external_appointment_id || null,
            blockCount: blocks.length,
            wordCount: countNoteWords(record?.content_text || extractNoteText(record?.content)),
        },
    }
}

/**
 * Turn one parsed CSV row into the note shape used by the create/update paths
 * of the import pipeline.
 */
export function mapCsvRowToNote(raw, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE
    const record = normalizeNoteRecord({ ...raw, external_source: normalizedSource })

    return {
        ...record,
        external_source: normalizedSource,
        patient_id: null,
        metadata: buildNoteProvenance(record, { source: normalizedSource }),
    }
}

/**
 * Merge an imported metadata projection over the metadata already stored on a
 * note row. Untouched keys are preserved.
 */
export function mergeNoteMetadata(existing, incoming) {
    const base = parseMetadataValue(existing) || {}
    if (!incoming || typeof incoming !== 'object') return base

    return {
        ...base,
        sploseNote: {
            ...(parseMetadataValue(base.sploseNote) || {}),
            ...(parseMetadataValue(incoming.sploseNote) || {}),
        },
    }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const MUTABLE_FIELD_VALIDATORS = {
    external_id: (value) => cleanNullableString(value, 120),
    external_source: (value) => cleanString(value).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE,
    title: (value) => cleanNullableString(value, 255),
    draft: (value) => toBool(value),
    patient_id: (value) => validateId(value),
    patient_name: (value) => cleanNullableString(value, 255),
    external_patient_id: (value) => cleanNullableString(value, 120),
    external_appointment_id: (value) => cleanNullableString(value, 120),
    practitioner_name: (value) => cleanNullableString(value, 255),
    external_practitioner_id: (value) => cleanNullableString(value, 120),
}

/**
 * Validate + normalise the mutable note fields present in a payload.
 * A `content` field also refreshes the flattened `content_text` projection.
 * Returns { updates, errors } where each update is { key, value }.
 */
export function resolveNoteUpdates(payload) {
    const updates = []
    const errors = []

    Object.keys(MUTABLE_FIELD_VALIDATORS).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(payload || {}, key)) return
        updates.push({ key, value: MUTABLE_FIELD_VALIDATORS[key](payload[key]) })
    })

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'content')) {
        const content = normalizeNoteContent(payload.content)
        updates.push({ key: 'content', value: content })
        updates.push({ key: 'content_text', value: buildNoteContentText(content) })
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Build the list/detail SELECT.
 *
 * `compact` controls how much of the body comes back:
 * - `preview` drops the (potentially large) document and truncates the
 *   flattened text - the dashboard card only needs a summary.
 * - `text` drops the document but keeps the whole flattened text, which is what
 *   callers that treat the patient's notes as one blob need.
 * - anything else (the default) returns the full row.
 */
export function buildNoteSelect({ compact = false } = {}) {
    const mode = compact === 'text' ? 'text' : compact ? 'preview' : 'full'

    return `
        SELECT
            n.id, n.domain, n.external_id, n.external_source, n.title, n.draft,
            ${mode === 'full' ? 'n.content' : 'NULL AS content'},
            ${mode === 'preview' ? 'LEFT(n.content_text, 400)' : 'n.content_text'} AS content_text,
            n.patient_id, n.patient_name, n.external_patient_id,
            n.external_appointment_id, n.practitioner_name, n.external_practitioner_id,
            n.metadata, n.created_at, n.updated_at,
            pt.patient_name AS linked_patient_name
        FROM notes n
        LEFT JOIN patients pt ON pt.id = n.patient_id AND pt.domain = n.domain
    `
}

/**
 * Newest note first. The reference export has no date column, but the external
 * ids are issued in ascending order, so they order the list in practice. A
 * template that does carry `Created At` keeps that instant on the row (see
 * `parseImportedTimestamp`) without changing this ordering.
 */
export function noteOrderExpression() {
    return `(CASE WHEN n.external_id ~ '^[0-9]+$' THEN n.external_id::BIGINT END) DESC NULLS LAST, n.id DESC`
}

export function normalizeNoteRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        draft: row.draft === true || toBool(row.draft),
        content: parseMetadataValue(row.content) || normalizeNoteContent(row.content),
        metadata: parseMetadataValue(row.metadata),
    }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = sortKeys(value[key])
            return acc
        }, {})
    }
    return value
}

function serializeJsonValue(value) {
    const parsed = typeof value === 'object' && value !== null ? value : parseMetadataValue(value)
    if (!parsed) return ''
    return JSON.stringify(sortKeys(parsed))
}

function normalizeComparableValue(key, value) {
    if (key === 'metadata' || key === 'content') {
        return serializeJsonValue(value)
    }
    if (key === 'created_at') {
        // The driver hands back a Date while the CSV carries text, so both
        // sides are compared as instants rather than as strings.
        return value instanceof Date
            ? (Number.isNaN(value.getTime()) ? '' : value.toISOString())
            : (parseImportedTimestamp(value) || '')
    }
    if (key === 'patient_id') {
        const id = validateId(value)
        return id === null ? '' : String(id)
    }
    if (key === 'draft') {
        return toBool(value) ? 'true' : 'false'
    }
    if (key === 'content_text') {
        return String(value === undefined || value === null ? '' : value)
    }
    return cleanString(value)
}

/**
 * Compare an incoming note field set with a stored row. Only changed fields are
 * returned, so a repeat import does not touch unchanged rows (and therefore
 * does not bump updated_at).
 */
export function diffNoteFields(existing, incoming) {
    const changed = []

    NOTE_COLUMN_KEYS.forEach((key) => {
        const stored = normalizeComparableValue(key, existing?.[key])
        const next = normalizeComparableValue(key, incoming?.[key])
        if (stored !== next) {
            changed.push({ key, value: incoming?.[key] === undefined ? null : incoming[key] })
        }
    })

    return changed
}
