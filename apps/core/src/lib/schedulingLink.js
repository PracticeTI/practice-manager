// Resolves the native practitioner/location/service ids on appointment rows.
//
// Imported appointments carry the external system's text labels and external
// ids. This module maps those onto the native scheduling entities without ever
// creating entities implicitly: a new practitioner or service should be a
// deliberate admin action (or a migration run), not a side effect of an import.
//
// Kept free of `@/` imports so the migration script and the import route share
// exactly the same matching rules.

import { normalizeEntityName } from './scheduling.js'

function normalizedNameSql(column) {
    return `regexp_replace(LOWER(TRIM(COALESCE(${column}, ''))), '\\s+', ' ', 'g')`
}

function externalKey(domain, externalId) {
    return `${String(domain || '').toLowerCase()}::${String(externalId || '').trim().toLowerCase()}`
}

function nameKey(domain, name) {
    return `${String(domain || '').toLowerCase()}::${normalizeEntityName(name).toLowerCase()}`
}

function buildIndex(rows) {
    const byExternal = new Map()
    const byName = new Map()
    ;(rows || []).forEach((row) => {
        if (row.external_id) byExternal.set(externalKey(row.domain, row.external_id), row.id)
        if (row.name) byName.set(nameKey(row.domain, row.name), row.id)
    })
    return { byExternal, byName }
}

function resolveEntityId(index, { domain, externalId, name }) {
    if (externalId) {
        const match = index.byExternal.get(externalKey(domain, externalId))
        if (match) return match
    }
    return index.byName.get(nameKey(domain, name)) || null
}

async function linkField(connection, {
    domain,
    table,
    entityNameColumn,
    idColumn,
    externalColumn,
    nameColumn,
}) {
    const entities = await connection.query(
        `SELECT id, domain, external_id, ${entityNameColumn} AS name
         FROM ${table}
         WHERE domain = $1`,
        [domain]
    )
    const index = buildIndex(entities.rows)

    const keys = await connection.query(
        `SELECT DISTINCT ${externalColumn} AS external_id, ${nameColumn} AS name
         FROM appointments
         WHERE domain = $1 AND COALESCE(TRIM(${nameColumn}), '') <> ''`,
        [domain]
    )

    let linked = 0
    for (const key of keys.rows) {
        const id = resolveEntityId(index, {
            domain,
            externalId: key.external_id,
            name: key.name,
        })
        if (!id) continue

        if (key.external_id) {
            const result = await connection.query(
                `UPDATE appointments
                 SET ${idColumn} = $1
                 WHERE domain = $2
                   AND ${idColumn} IS NULL
                   AND ${externalColumn} = $3`,
                [id, domain, key.external_id]
            )
            linked += result.rowCount || 0
        }

        const byName = await connection.query(
            `UPDATE appointments
             SET ${idColumn} = $1
             WHERE domain = $2
               AND ${idColumn} IS NULL
               AND ${normalizedNameSql(nameColumn)} = $3`,
            [id, domain, normalizeEntityName(key.name).toLowerCase()]
        )
        linked += byName.rowCount || 0
    }

    return linked
}

/**
 * Link every appointment in `domain` to the matching native entities.
 * Returns counts keyed by entity type. Safe to run repeatedly.
 */
export async function linkAppointmentsToSchedulingEntities(connection, { domain } = {}) {
    if (!domain) throw new Error('domain is required')

    return {
        practitioner: await linkField(connection, {
            domain,
            table: 'practitioners',
            entityNameColumn: 'display_name',
            idColumn: 'practitioner_id',
            externalColumn: 'external_practitioner_id',
            nameColumn: 'practitioner',
        }),
        location: await linkField(connection, {
            domain,
            table: 'practice_locations',
            entityNameColumn: 'name',
            idColumn: 'location_id',
            externalColumn: 'external_location_id',
            nameColumn: 'location',
        }),
        service: await linkField(connection, {
            domain,
            table: 'services',
            entityNameColumn: 'name',
            idColumn: 'service_id',
            externalColumn: 'external_service_id',
            nameColumn: 'service',
        }),
    }
}
