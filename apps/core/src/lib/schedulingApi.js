import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import { parseMetadataValue, resolveRouteParams, validateId } from '@/lib/appointments'
import { findInvalidDomainReferences } from '@/lib/schedulingReferences'
import {
    normalizeAvailabilityExceptionFields,
    normalizeAvailabilityRuleFields,
    normalizeLocationFields,
    normalizePractitionerFields,
    normalizePractitionerServiceFields,
    normalizeServiceFields,
    normalizeWaitlistEntryFields,
} from '@/lib/scheduling'

// Route handlers for the native scheduling entities.
//
// Every resource is domain-scoped and uses the same shape as the existing
// `/api/database/*` routes: an admin bearer token resolves the domain, and each
// mutation is written to the activity log. The table and column names come from
// this module's allow-list, never from the request body.

const RESOURCES = {
    practitioners: {
        table: 'practitioners',
        entityType: 'practitioner',
        label: 'Practitioner',
        labelField: 'display_name',
        orderBy: 'display_name ASC, id ASC',
        searchColumns: ['display_name', 'email', 'discipline'],
        filters: { active: 'boolean', admin_user_id: 'integer' },
        parseCreate: (payload) => normalizePractitionerFields(payload, { requireName: true }),
        parseUpdate: (payload) => normalizePractitionerFields(payload, { requireName: false }),
        references: [
            { table: 'appointments', column: 'practitioner_id', label: 'appointments' },
            { table: 'practitioner_services', column: 'practitioner_id', label: 'service assignments' },
            { table: 'availability_rules', column: 'practitioner_id', label: 'availability rules' },
            { table: 'availability_exceptions', column: 'practitioner_id', label: 'availability exceptions' },
        ],
    },
    'practice-locations': {
        table: 'practice_locations',
        entityType: 'practice_location',
        label: 'Practice location',
        labelField: 'name',
        orderBy: 'name ASC, id ASC',
        searchColumns: ['name', 'suburb', 'postcode', 'address_line1'],
        filters: { active: 'boolean', location_type: 'text' },
        numericColumns: ['latitude', 'longitude'],
        parseCreate: (payload) => normalizeLocationFields(payload, { requireName: true }),
        parseUpdate: (payload) => normalizeLocationFields(payload, { requireName: false }),
        references: [
            { table: 'appointments', column: 'location_id', label: 'appointments' },
            { table: 'practitioners', column: 'default_location_id', label: 'practitioners' },
            { table: 'availability_rules', column: 'location_id', label: 'availability rules' },
        ],
    },
    services: {
        table: 'services',
        entityType: 'service',
        label: 'Service',
        labelField: 'name',
        orderBy: 'name ASC, id ASC',
        searchColumns: ['name', 'code', 'ndis_support_item_number', 'ndis_support_item_name'],
        filters: { active: 'boolean' },
        numericColumns: ['price'],
        parseCreate: (payload) => normalizeServiceFields(payload, { requireName: true }),
        parseUpdate: (payload) => normalizeServiceFields(payload, { requireName: false }),
        references: [
            { table: 'appointments', column: 'service_id', label: 'appointments' },
            { table: 'practitioner_services', column: 'service_id', label: 'practitioner assignments' },
        ],
    },
    'practitioner-services': {
        table: 'practitioner_services',
        entityType: 'practitioner_service',
        label: 'Practitioner service assignment',
        labelField: null,
        orderBy: 'practitioner_id ASC, service_id ASC',
        searchColumns: [],
        filters: { practitioner_id: 'integer', service_id: 'integer' },
        parseCreate: (payload) => normalizePractitionerServiceFields(payload),
        parseUpdate: (payload) => normalizePractitionerServiceFields(payload, { requireCore: false }),
        references: [],
    },
    'availability-rules': {
        table: 'availability_rules',
        entityType: 'availability_rule',
        label: 'Availability rule',
        labelField: null,
        orderBy: 'weekday ASC, start_time ASC, id ASC',
        searchColumns: [],
        filters: {
            active: 'boolean',
            practitioner_id: 'integer',
            location_id: 'integer',
            service_id: 'integer',
            weekday: 'integer',
        },
        parseCreate: (payload) => normalizeAvailabilityRuleFields(payload),
        parseUpdate: (payload) => normalizeAvailabilityRuleFields(payload, { requireCore: false }),
        references: [],
    },
    waitlist: {
        table: 'waitlist_entries',
        entityType: 'waitlist_entry',
        label: 'Waitlist entry',
        labelField: 'patient_name',
        orderBy: 'priority DESC, earliest_date ASC NULLS LAST, id ASC',
        searchColumns: ['patient_name', 'notes'],
        filters: {
            status: 'text',
            service_id: 'integer',
            practitioner_id: 'integer',
            location_id: 'integer',
        },
        parseCreate: (payload) => normalizeWaitlistEntryFields(payload, { requireName: true }),
        parseUpdate: (payload) => normalizeWaitlistEntryFields(payload, { requireName: false }),
        references: [],
    },
    'availability-exceptions': {
        table: 'availability_exceptions',
        entityType: 'availability_exception',
        label: 'Availability exception',
        labelField: null,
        orderBy: 'starts_at ASC, id ASC',
        searchColumns: [],
        filters: { practitioner_id: 'integer', exception_type: 'text' },
        range: { column: 'starts_at', endColumn: 'ends_at' },
        parseCreate: (payload) => normalizeAvailabilityExceptionFields(payload),
        parseUpdate: (payload) => normalizeAvailabilityExceptionFields(payload, { requireCore: false }),
        references: [],
    },
}

function getResource(resourceKey) {
    const resource = RESOURCES[resourceKey]
    if (!resource) {
        throw new Error(`Unknown scheduling resource: ${resourceKey}`)
    }
    return resource
}

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parseBooleanFilter(value) {
    const text = String(value || '').toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(text)) return true
    if (['false', '0', 'no', 'n'].includes(text)) return false
    return null
}

function parseTimestampFilter(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function serializeValue(value) {
    if (value !== null && typeof value === 'object') return JSON.stringify(value)
    return value === undefined ? null : value
}

function normalizeRow(row, resource) {
    if (!row || typeof row !== 'object') return row
    const normalized = { ...row }
    ;(resource.numericColumns || []).forEach((column) => {
        if (normalized[column] !== null && normalized[column] !== undefined) {
            normalized[column] = Number(normalized[column])
        }
    })
    normalized.metadata = parseMetadataValue(normalized.metadata)
    return normalized
}

function isDuplicateError(error) {
    return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message || '')
}

function isConstraintError(error) {
    return error?.code === '23514' || /violates check constraint/i.test(error?.message || '')
}

const CONSTRAINT_MESSAGES = {
    availability_rules_time_order: 'end_time must be after start_time',
    availability_rules_weekday_range: 'weekday must be between 0 and 6',
    availability_exceptions_time_order: 'ends_at must be after starts_at',
    services_duration_positive: 'duration_minutes must be greater than 0',
}

function constraintMessage(error) {
    const message = String(error?.message || '')
    for (const [constraint, friendly] of Object.entries(CONSTRAINT_MESSAGES)) {
        if (message.includes(constraint)) return friendly
    }
    return 'The record violates a scheduling constraint'
}

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

async function requireDomain(request, requestedDomain) {
    const context = await resolveAdminDomainScope(request, requestedDomain)
    if (context?.error) return { error: jsonError(context.error, context.status) }
    return { context, domain: context.domain }
}

export function createSchedulingCollectionHandlers(resourceKey) {
    const resource = getResource(resourceKey)

    async function GET(request) {
        if (detectDatabaseType() !== 'postgresql') {
            return jsonError('Relational database required')
        }

        try {
            const { searchParams } = new URL(request.url)
            const scoped = await requireDomain(request, searchParams.get('domain'))
            if (scoped.error) return scoped.error
            const { domain } = scoped

            await ensureSchedulingTables()

            const params = [domain]
            const where = ['domain = $1']
            const addParam = (value) => {
                params.push(value)
                return `$${params.length}`
            }

            Object.entries(resource.filters || {}).forEach(([key, type]) => {
                const raw = searchParams.get(key)
                if (raw === null || raw === '') return
                if (type === 'boolean') {
                    const value = parseBooleanFilter(raw)
                    if (value !== null) where.push(`active = ${addParam(value)}`)
                    return
                }
                if (type === 'integer') {
                    const value = Number.parseInt(raw, 10)
                    if (Number.isFinite(value)) where.push(`${key} = ${addParam(value)}`)
                    return
                }
                where.push(`${key} = ${addParam(String(raw).toLowerCase())}`)
            })

            if (resource.range) {
                const from = parseTimestampFilter(searchParams.get('from'))
                const to = parseTimestampFilter(searchParams.get('to'))
                if (from) where.push(`${resource.range.endColumn} > ${addParam(from)}`)
                if (to) where.push(`${resource.range.column} < ${addParam(to)}`)
            }

            const search = String(searchParams.get('q') || '').trim().toLowerCase()
            if (search && resource.searchColumns.length > 0) {
                const placeholder = addParam(`%${search}%`)
                const clauses = resource.searchColumns.map(
                    (column) => `LOWER(COALESCE(${column}::text, '')) LIKE ${placeholder}`
                )
                where.push(`(${clauses.join(' OR ')})`)
            }

            const limit = parseLimit(searchParams.get('limit'))

            let connection = null
            try {
                connection = await getDatabaseConnection()
                const result = await connection.query(
                    `SELECT * FROM ${resource.table}
                     WHERE ${where.join(' AND ')}
                     ORDER BY ${resource.orderBy}
                     LIMIT ${limit}`,
                    params
                )
                return NextResponse.json({
                    success: true,
                    data: (result.rows || []).map((row) => normalizeRow(row, resource)),
                })
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        } catch (error) {
            return jsonError(error?.message || `Failed to load ${resource.label.toLowerCase()}s`, 500)
        }
    }

    async function POST(request) {
        if (detectDatabaseType() !== 'postgresql') {
            return jsonError('Relational database required')
        }

        try {
            const payload = await request.json().catch(() => ({}))
            const { searchParams } = new URL(request.url)
            const scoped = await requireDomain(request, searchParams.get('domain') || payload?.domain)
            if (scoped.error) return scoped.error
            const { context, domain } = scoped

            const { fields, errors } = resource.parseCreate(payload)
            if (errors.length > 0) return jsonError(errors[0])
            if (Object.keys(fields).length === 0) {
                return jsonError('No fields provided')
            }

            await ensureSchedulingTables()

            const keys = ['domain', ...Object.keys(fields)]
            const values = [domain, ...Object.values(fields).map(serializeValue)]
            const placeholders = keys.map((_key, index) => `$${index + 1}`)

            let connection = null
            try {
                connection = await getDatabaseConnection()

                const referenceErrors = await findInvalidDomainReferences(connection, domain, fields)
                if (referenceErrors.length > 0) return jsonError(referenceErrors[0])

                const result = await connection.query(
                    `INSERT INTO ${resource.table} (${keys.join(', ')})
                     VALUES (${placeholders.join(', ')})
                     RETURNING *`,
                    values
                )
                const row = result.rows?.[0]

                await recordActivity({
                    domain,
                    action: 'create',
                    entityType: resource.entityType,
                    entityId: row?.id,
                    entityLabel: (resource.labelField && row?.[resource.labelField]) || resource.label,
                    actor: activityActorFromAdminUser(context.adminUser),
                }, { connection })

                return NextResponse.json(
                    { success: true, data: normalizeRow(row, resource) },
                    { status: 201 }
                )
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        } catch (error) {
            if (isDuplicateError(error)) {
                return jsonError(`A ${resource.label.toLowerCase()} with that identifier already exists`, 409)
            }
            if (isConstraintError(error)) return jsonError(constraintMessage(error), 400)
            return jsonError(error?.message || `Failed to create ${resource.label.toLowerCase()}`, 500)
        }
    }

    return { GET, POST }
}

export function createSchedulingItemHandlers(resourceKey) {
    const resource = getResource(resourceKey)

    async function loadRecord(connection, id, domain) {
        const result = await connection.query(
            `SELECT * FROM ${resource.table} WHERE id = $1 AND domain = $2 LIMIT 1`,
            [id, domain]
        )
        return result.rows?.[0] || null
    }

    async function GET(request, { params }) {
        if (detectDatabaseType() !== 'postgresql') {
            return jsonError('Relational database required')
        }

        const routeParams = await resolveRouteParams(params)
        const id = validateId(routeParams?.id)
        if (!id) return jsonError(`Invalid ${resource.label.toLowerCase()} id`)

        try {
            const { searchParams } = new URL(request.url)
            const scoped = await requireDomain(request, searchParams.get('domain'))
            if (scoped.error) return scoped.error
            const { domain } = scoped

            await ensureSchedulingTables()

            let connection = null
            try {
                connection = await getDatabaseConnection()
                const row = await loadRecord(connection, id, domain)
                if (!row) return jsonError(`${resource.label} not found`, 404)
                return NextResponse.json({ success: true, data: normalizeRow(row, resource) })
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        } catch (error) {
            return jsonError(error?.message || `Failed to load ${resource.label.toLowerCase()}`, 500)
        }
    }

    async function PATCH(request, { params }) {
        if (detectDatabaseType() !== 'postgresql') {
            return jsonError('Relational database required')
        }

        const routeParams = await resolveRouteParams(params)
        const id = validateId(routeParams?.id)
        if (!id) return jsonError(`Invalid ${resource.label.toLowerCase()} id`)

        try {
            const payload = await request.json().catch(() => ({}))
            const { searchParams } = new URL(request.url)
            const scoped = await requireDomain(request, searchParams.get('domain') || payload?.domain)
            if (scoped.error) return scoped.error
            const { context, domain } = scoped

            const { fields, errors } = resource.parseUpdate(payload)
            if (errors.length > 0) return jsonError(errors[0])
            if (Object.keys(fields).length === 0) return jsonError('No updatable fields provided')

            await ensureSchedulingTables()

            let connection = null
            try {
                connection = await getDatabaseConnection()
                const existing = await loadRecord(connection, id, domain)
                if (!existing) return jsonError(`${resource.label} not found`, 404)

                const referenceErrors = await findInvalidDomainReferences(connection, domain, fields)
                if (referenceErrors.length > 0) return jsonError(referenceErrors[0])

                const entries = Object.entries(fields)
                const values = entries.map(([, value]) => serializeValue(value))
                const setClauses = entries.map(([key], index) => `${key} = $${index + 1}`)
                const idPlaceholder = `$${values.length + 1}`
                const domainPlaceholder = `$${values.length + 2}`

                const result = await connection.query(
                    `UPDATE ${resource.table}
                     SET ${setClauses.join(', ')}, updated_at = NOW()
                     WHERE id = ${idPlaceholder} AND domain = ${domainPlaceholder}
                     RETURNING *`,
                    [...values, id, domain]
                )
                const row = result.rows?.[0]

                await recordActivity({
                    domain,
                    action: 'update',
                    entityType: resource.entityType,
                    entityId: id,
                    entityLabel: (resource.labelField && row?.[resource.labelField]) || resource.label,
                    actor: activityActorFromAdminUser(context.adminUser),
                }, { connection })

                return NextResponse.json({ success: true, data: normalizeRow(row, resource) })
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        } catch (error) {
            if (isDuplicateError(error)) {
                return jsonError(`A ${resource.label.toLowerCase()} with that identifier already exists`, 409)
            }
            if (isConstraintError(error)) return jsonError(constraintMessage(error), 400)
            return jsonError(error?.message || `Failed to update ${resource.label.toLowerCase()}`, 500)
        }
    }

    async function DELETE(request, { params }) {
        if (detectDatabaseType() !== 'postgresql') {
            return jsonError('Relational database required')
        }

        const routeParams = await resolveRouteParams(params)
        const id = validateId(routeParams?.id)
        if (!id) return jsonError(`Invalid ${resource.label.toLowerCase()} id`)

        try {
            const { searchParams } = new URL(request.url)
            const scoped = await requireDomain(request, searchParams.get('domain'))
            if (scoped.error) return scoped.error
            const { context, domain } = scoped

            await ensureSchedulingTables()

            let connection = null
            try {
                connection = await getDatabaseConnection()
                const existing = await loadRecord(connection, id, domain)
                if (!existing) return jsonError(`${resource.label} not found`, 404)

                for (const reference of resource.references || []) {
                    const result = await connection.query(
                        `SELECT COUNT(*)::int AS total FROM ${reference.table}
                         WHERE domain = $1 AND ${reference.column} = $2`,
                        [domain, id]
                    )
                    const total = Number(result.rows?.[0]?.total || 0)
                    if (total > 0) {
                        return jsonError(
                            `${resource.label} is referenced by ${total} ${reference.label}. Deactivate it instead of deleting.`,
                            409
                        )
                    }
                }

                await connection.query(
                    `DELETE FROM ${resource.table} WHERE id = $1 AND domain = $2`,
                    [id, domain]
                )

                await recordActivity({
                    domain,
                    action: 'delete',
                    entityType: resource.entityType,
                    entityId: id,
                    entityLabel: (resource.labelField && existing?.[resource.labelField]) || resource.label,
                    actor: activityActorFromAdminUser(context.adminUser),
                }, { connection })

                return NextResponse.json({ success: true })
            } finally {
                if (connection?.end) await connection.end().catch(() => { })
            }
        } catch (error) {
            return jsonError(error?.message || `Failed to delete ${resource.label.toLowerCase()}`, 500)
        }
    }

    return { GET, PATCH, DELETE }
}
