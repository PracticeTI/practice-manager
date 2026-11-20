// Shared vocabulary and presentation helpers for the Activities audit trail.
//
// The `activities` table records who (human or agent) did what to a
// domain-scoped record, plus a deep link back to that record. This module owns
// the closed vocabularies (action / actor type / entity type) and the deep-link
// builder so the API route, the recorder and the admin page all agree on the
// same values. Pure and client-safe: no database or Node-only APIs.

export const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'import']

export const ACTIVITY_ACTOR_TYPES = ['human', 'agent', 'system']

// Records the audit trail currently covers. Each one opens inside the patient
// record it belongs to, so patients get their own deep link and everything else
// resolves through the patient id.
export const ACTIVITY_ENTITY_TYPES = [
    'patient',
    'case',
    'case_usage',
    'note',
    'form',
    'patient_file',
    'transcription',
    'appointment',
    'quote',
    'service_agreement',
]

const ENTITY_LABELS = {
    patient: 'Patient',
    case: 'Case',
    case_usage: 'Case usage',
    note: 'Note',
    form: 'Form',
    patient_file: 'File',
    transcription: 'Transcript',
    appointment: 'Appointment',
    quote: 'Quote',
    service_agreement: 'Service agreement',
}

// Tab key used by the admin patient modal for each associated record.
const ENTITY_TABS = {
    case: 'cases',
    case_usage: 'cases',
    note: 'notes',
    form: 'forms',
    patient_file: 'files',
    transcription: 'transcripts',
    appointment: 'appointments',
    quote: 'quotes',
    service_agreement: 'agreements',
}

const ACTION_LABELS = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    import: 'Imported',
}

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase()
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function normalizeActivityAction(value) {
    const action = normalizeKey(value)
    return ACTIVITY_ACTIONS.includes(action) ? action : null
}

export function normalizeActivityActorType(value) {
    const actorType = normalizeKey(value)
    return ACTIVITY_ACTOR_TYPES.includes(actorType) ? actorType : null
}

export function normalizeActivityEntityType(value) {
    const entityType = normalizeKey(value)
    return ACTIVITY_ENTITY_TYPES.includes(entityType) ? entityType : null
}

export function activityActionLabel(value) {
    const action = normalizeActivityAction(value)
    return action ? ACTION_LABELS[action] : ''
}

export function activityEntityLabel(value) {
    const entityType = normalizeActivityEntityType(value)
    return entityType ? ENTITY_LABELS[entityType] : ''
}

/**
 * Relative admin URL that opens the record an activity refers to. Returns null
 * when the activity has no id to focus, so callers render plain text instead of
 * a dead link.
 */
export function buildActivityDeepLink(entityType, entityId, { patientId = null } = {}) {
    const type = normalizeActivityEntityType(entityType)
    if (!type) return null

    if (type === 'patient') {
        const id = parsePositiveInt(entityId)
        return id ? `/admin/patients?patientId=${id}` : null
    }

    const numericPatientId = parsePositiveInt(patientId)
    const tab = ENTITY_TABS[type]
    if (!numericPatientId || !tab) return null

    const params = new URLSearchParams({ patientId: String(numericPatientId), tab })
    if (type === 'transcription') {
        const transcriptId = parsePositiveInt(entityId)
        if (transcriptId) params.set('transcriptionId', String(transcriptId))
    }
    return `/admin/patients?${params.toString()}`
}

export function activitySummaryText({ action, entityType, entityLabel } = {}) {
    const actionLabel = activityActionLabel(action)
    const typeLabel = activityEntityLabel(entityType)
    const name = String(entityLabel || '').trim()
    return [actionLabel, typeLabel, name].filter(Boolean).join(' ').trim()
}

/**
 * Human-readable roll-up of a CSV import summary. Every importer returns the
 * same shape (`total` / `inserted` / `updated` / `skipped`).
 */
export function describeImportSummary(summary = {}) {
    const inserted = Number(summary.inserted || 0)
    const updated = Number(summary.updated || 0)
    const skipped = Number(summary.skipped || 0)
    const total = Number(summary.total || 0)

    const parts = []
    if (inserted) parts.push(`${inserted} created`)
    if (updated) parts.push(`${updated} updated`)
    if (skipped) parts.push(`${skipped} skipped`)
    if (parts.length === 0) return `${total} row${total === 1 ? '' : 's'} processed`
    return parts.join(', ')
}

export function parseActivityMetadata(value) {
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

export function normalizeActivityRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        id: parsePositiveInt(row.id) ?? row.id,
        patient_id: parsePositiveInt(row.patient_id),
        actor_type: normalizeActivityActorType(row.actor_type) || 'system',
        action: normalizeActivityAction(row.action) || String(row.action || '').trim(),
        entity_type: normalizeActivityEntityType(row.entity_type) || String(row.entity_type || '').trim(),
        metadata: parseActivityMetadata(row.metadata),
    }
}
