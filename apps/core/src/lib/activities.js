// Writes rows to the `activities` audit trail, and resolves who performed an
// action from the request's credentials.
//
// Recording is deliberately best-effort: an audit write must never fail the
// business operation that produced it, so every failure is logged and swallowed.
// Actor identity is derived from the service shared secret (agents / workers)
// or the admin JWT (humans); callers that already verified a token can pass the
// decoded user in to avoid a second verification.

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { verifyAdminToken, verifyServiceAuth } from '@/lib/auth'
import { ensureActivitiesTable } from '@/lib/activitiesTable'
import {
    buildActivityDeepLink,
    describeImportSummary,
    normalizeActivityAction,
    normalizeActivityActorType,
    normalizeActivityEntityType,
} from '@/lib/activityDisplay'

const SERVICE_ACTOR = { actorType: 'agent', actorId: 'service', actorName: 'Domain service', actorRole: null }
const SYSTEM_ACTOR = { actorType: 'system', actorId: null, actorName: 'System', actorRole: null }

// The schema is static, so the DDL only needs to run once per process.
let activitiesTableReady = false

async function ensureActivitiesReady() {
    if (activitiesTableReady) return
    await ensureActivitiesTable()
    activitiesTableReady = true
}

function normalizeText(value, maxLength = 255) {
    const text = String(value ?? '').trim()
    return text ? text.slice(0, maxLength) : null
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function bearerToken(request) {
    const header = request?.headers?.get?.('authorization') || ''
    if (!header.toLowerCase().startsWith('bearer ')) return ''
    return header.slice('bearer '.length).trim()
}

/** Build an actor descriptor from a decoded admin token payload. */
export function activityActorFromAdminUser(adminUser) {
    if (!adminUser || typeof adminUser !== 'object') return null

    const name = normalizeText(
        adminUser.username || adminUser.name || adminUser.email || adminUser.sub,
        160
    )
    if (!name) return null

    return {
        actorType: 'human',
        actorId: name,
        actorName: name,
        actorRole: normalizeText(adminUser.role, 64),
    }
}

/**
 * Resolve the actor for a request: a known admin user when the caller already
 * verified one, otherwise the service secret (agent) or the admin token (human).
 * Falls back to a neutral system actor so an unauthenticated legacy route still
 * produces a row.
 */
export async function resolveActivityActor(request, { adminUser = null } = {}) {
    const knownActor = activityActorFromAdminUser(adminUser)
    if (knownActor) return knownActor

    if (verifyServiceAuth(request)) return { ...SERVICE_ACTOR }

    const token = bearerToken(request)
    if (token) {
        const resolvedActor = activityActorFromAdminUser(await verifyAdminToken(token))
        if (resolvedActor) return resolvedActor
    }

    return { ...SYSTEM_ACTOR }
}

export function normalizeActivityActor(input) {
    if (!input || typeof input !== 'object') return { ...SYSTEM_ACTOR }

    const actorType = normalizeActivityActorType(input.actorType ?? input.actor_type ?? input.type) || 'human'
    const actorName = normalizeText(input.actorName ?? input.actor_name ?? input.name, 255)
    const actorId = normalizeText(input.actorId ?? input.actor_id ?? input.id, 160) || actorName

    return {
        actorType,
        actorId,
        actorName: actorName || (actorType === 'human' ? 'Unknown user' : actorType === 'agent' ? 'Agent' : 'System'),
        actorRole: normalizeText(input.actorRole ?? input.actor_role ?? input.role, 64),
    }
}

/**
 * Look up a patient's display name for the audit row. Best-effort: a missing
 * patient (or a database that does not answer) just leaves the name blank.
 */
export async function loadActivityPatientName(connection, patientId, domain) {
    const numericPatientId = parsePositiveInt(patientId)
    if (!connection?.query || !numericPatientId) return null

    try {
        const result = await connection.query(
            'SELECT patient_name FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
            [numericPatientId, String(domain || '').trim().toLowerCase()]
        )
        return normalizeText(result.rows?.[0]?.patient_name, 255)
    } catch {
        return null
    }
}

/**
 * Record one audit row for a bulk CSV import.
 *
 * A bulk import has no single record to focus, so the deep link lands on the
 * patient list rather than a specific record. Dry runs and imports that changed
 * nothing are skipped — the trail is for changes, and a preview is neither.
 */
export async function recordImportActivity({
    domain,
    entityType,
    summary,
    fileName = null,
    source = null,
    actor = null,
} = {}, { connection = null } = {}) {
    if (!summary || summary.dryRun === true) return null

    const inserted = Number(summary.inserted || 0)
    const updated = Number(summary.updated || 0)
    if (inserted + updated === 0) return null

    const errors = Array.isArray(summary.errors) ? summary.errors : []

    return recordActivity({
        domain,
        action: 'import',
        entityType,
        entityLabel: normalizeText(fileName, 255) || 'CSV import',
        deepLink: '/admin/patients',
        summary: describeImportSummary(summary),
        metadata: {
            total: Number(summary.total || 0),
            inserted,
            updated,
            unchanged: Number(summary.unchanged || 0),
            skipped: Number(summary.skipped || 0),
            error_count: errors.length,
            source: normalizeText(source, 64),
            file_name: normalizeText(fileName, 255),
        },
        actor,
    }, { connection })
}

/**
 * Append one audit-trail row. Returns the new activity id, or null when the
 * activity is incomplete or the write failed.
 */
export async function recordActivity({
    domain,
    action,
    entityType,
    entityId = null,
    entityLabel = null,
    patientId = null,
    patientName = null,
    deepLink = null,
    summary = null,
    metadata = null,
    actor = null,
} = {}, { connection = null } = {}) {
    let activeConnection = connection
    let ownsConnection = false

    try {
        const normalizedDomain = normalizeText(domain, 100)?.toLowerCase() || null
        const normalizedAction = normalizeActivityAction(action)
        const normalizedEntityType = normalizeActivityEntityType(entityType)
        if (!normalizedDomain || !normalizedAction || !normalizedEntityType) return null

        const normalizedPatientId = parsePositiveInt(patientId)
        const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : null
        const resolvedActor = normalizeActivityActor(actor)
        const resolvedDeepLink = normalizeText(
            deepLink || buildActivityDeepLink(normalizedEntityType, entityId, { patientId: normalizedPatientId }),
            2000
        )

        if (detectDatabaseType() !== 'postgresql') return null
        await ensureActivitiesReady()

        if (!activeConnection) {
            activeConnection = await getDatabaseConnection()
            ownsConnection = true
        }

        const result = await activeConnection.query(
            `INSERT INTO activities (
                domain, actor_type, actor_id, actor_name, actor_role,
                action, entity_type, entity_id, entity_label,
                patient_id, patient_name, deep_link, summary, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
             RETURNING id`,
            [
                normalizedDomain,
                resolvedActor.actorType,
                resolvedActor.actorId,
                resolvedActor.actorName,
                resolvedActor.actorRole,
                normalizedAction,
                normalizedEntityType,
                normalizeText(entityId, 160),
                normalizeText(entityLabel, 255),
                normalizedPatientId,
                normalizeText(patientName, 255),
                resolvedDeepLink,
                normalizeText(summary, 1000),
                normalizedMetadata === null ? null : JSON.stringify(normalizedMetadata),
            ]
        )

        return result.rows?.[0]?.id ?? null
    } catch (error) {
        console.error('Failed to record activity:', error?.message || error)
        return null
    } finally {
        if (ownsConnection && activeConnection?.end) {
            await activeConnection.end().catch(() => { })
        }
    }
}
