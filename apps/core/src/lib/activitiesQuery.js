// Shared query building for the activity-trail endpoints: the domain-scoped
// `/api/database/activities` list and the superadmin `/api/settings/activities`
// list. Both accept the same filters, so the parsing and the SQL fragment live
// here rather than being duplicated per route.
//
// Kept free of database imports so the parsed shape can be unit tested.

import {
    normalizeActivityAction,
    normalizeActivityActorType,
    normalizeActivityEntityType,
} from './activityDisplay.js'

export const ACTIVITY_COLUMNS = [
    'id',
    'domain',
    'actor_type',
    'actor_id',
    'actor_name',
    'actor_role',
    'action',
    'entity_type',
    'entity_id',
    'entity_label',
    'patient_id',
    'patient_name',
    'deep_link',
    'summary',
    'metadata',
    'created_at',
]

export const ACTIVITY_LIST_LIMIT = 100
export const ACTIVITY_LIST_MAX_LIMIT = 500

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseLimit(rawValue, defaultValue = ACTIVITY_LIST_LIMIT, maxValue = ACTIVITY_LIST_MAX_LIMIT) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parseOffset(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Parse the query string shared by both activity list endpoints. */
export function parseActivityFilters(searchParams) {
    const get = (key) => String(searchParams?.get?.(key) ?? '').trim()

    const since = get('since')
    const sinceDate = since ? new Date(since) : null

    return {
        entityType: normalizeActivityEntityType(get('entity_type')),
        entityId: get('entity_id') || null,
        patientId: parsePositiveInt(get('patient_id')),
        action: normalizeActivityAction(get('action')),
        actorType: normalizeActivityActorType(get('actor_type')),
        actorId: get('actor_id') || null,
        since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate.toISOString() : null,
        limit: parseLimit(get('limit')),
        offset: parseOffset(get('offset')),
    }
}

/**
 * Build the `WHERE` fragment and its positional parameters. Omitting `domain`
 * lists every domain (the superadmin view).
 */
export function buildActivityWhere(filters = {}, { domain = null } = {}) {
    const clauses = []
    const params = []

    const add = (clause, value) => {
        params.push(value)
        clauses.push(clause.replace('$n', `$${params.length}`))
    }

    if (domain) add('domain = $n', domain)
    if (filters.entityType) add('entity_type = $n', filters.entityType)
    if (filters.entityId) add('entity_id = $n', filters.entityId)
    if (filters.patientId) add('patient_id = $n', filters.patientId)
    if (filters.action) add('action = $n', filters.action)
    if (filters.actorType) add('actor_type = $n', filters.actorType)
    if (filters.actorId) add('actor_id = $n', filters.actorId)
    if (filters.since) add('created_at >= $n', filters.since)

    return {
        clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        params,
    }
}

export function normalizeActivityDomain(value) {
    return String(value || '').trim().toLowerCase()
}
