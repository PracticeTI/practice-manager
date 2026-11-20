import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'
import {
    PROVIDER_BOOLEAN_FIELDS,
    PROVIDER_LIST_FIELDS,
    normalizeProvider,
} from '@/lib/providersDirectory'

const TEXT_FIELDS = [
    'provider', 'description', 'ndis_status', 'registration_body', 'typical_wait_time',
    'website_url', 'email', 'phone', 'last_verified_at', 'status', 'domain',
]

const WRITABLE_FIELDS = [...TEXT_FIELDS, ...PROVIDER_LIST_FIELDS, ...PROVIDER_BOOLEAN_FIELDS]

function serializeProvider(value) {
    const provider = normalizeProvider(value)
    const row = {}
    for (const field of TEXT_FIELDS) row[field] = String(provider[field] || '').trim()
    for (const field of PROVIDER_LIST_FIELDS) row[field] = JSON.stringify(provider[field])
    for (const field of PROVIDER_BOOLEAN_FIELDS) row[field] = Boolean(provider[field])
    row.status = ['draft', 'archived', 'hidden', 'admin_added'].includes(row.status) ? row.status : 'published'
    return row
}

function parseProvider(row) {
    if (!row) return null
    const parsed = { ...row }
    for (const field of PROVIDER_LIST_FIELDS) {
        try {
            parsed[field] = Array.isArray(row[field]) ? row[field] : JSON.parse(row[field] || '[]')
        } catch {
            parsed[field] = []
        }
    }
    return normalizeProvider(parsed)
}

async function ensureTables(connection, dbType) {
    const providerTable = `CREATE TABLE IF NOT EXISTS allied_health_providers (
            id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            professions TEXT NOT NULL DEFAULT '[]', service_types TEXT NOT NULL DEFAULT '[]',
            age_groups TEXT NOT NULL DEFAULT '[]', ndis_status VARCHAR(40) NOT NULL DEFAULT '',
            funding TEXT NOT NULL DEFAULT '[]', geography TEXT NOT NULL DEFAULT '[]',
            languages_spoken TEXT NOT NULL DEFAULT '[]', telehealth BOOLEAN NOT NULL DEFAULT FALSE,
            home_visits BOOLEAN NOT NULL DEFAULT FALSE, bulk_billing BOOLEAN NOT NULL DEFAULT FALSE,
            accepting_new_clients BOOLEAN NOT NULL DEFAULT FALSE, referral_required BOOLEAN NOT NULL DEFAULT FALSE,
            registration_body VARCHAR(120) NOT NULL DEFAULT '', typical_wait_time VARCHAR(120) NOT NULL DEFAULT '',
            website_url TEXT NOT NULL DEFAULT '', email VARCHAR(320) NOT NULL DEFAULT '', phone VARCHAR(80) NOT NULL DEFAULT '',
            last_verified_at VARCHAR(32) NOT NULL DEFAULT '', status VARCHAR(24) NOT NULL DEFAULT 'published',
            domain VARCHAR(120) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
    const favoritesTable = `CREATE TABLE IF NOT EXISTS allied_health_provider_favorites (
            id BIGSERIAL PRIMARY KEY, provider_id BIGINT NOT NULL REFERENCES allied_health_providers(id) ON DELETE CASCADE,
            admin_key VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (provider_id, admin_key)
        )`
    const adminDeletionsTable = `CREATE TABLE IF NOT EXISTS allied_health_provider_admin_deletions (
            id BIGSERIAL PRIMARY KEY, provider_id BIGINT NOT NULL REFERENCES allied_health_providers(id) ON DELETE CASCADE,
            admin_key VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (provider_id, admin_key)
        )`

    const required = ['allied_health_providers', 'allied_health_provider_favorites', 'allied_health_provider_admin_deletions']
    if ((await missingTables(connection, required)).length > 0) {
        await connection.query(providerTable)
        await connection.query(favoritesTable)
        await connection.query(adminDeletionsTable)
    }

    // CREATE TABLE IF NOT EXISTS won't add columns to a table that already exists, so backfill separately.
    const addDomainColumn = 'ALTER TABLE allied_health_providers ADD COLUMN IF NOT EXISTS domain VARCHAR(120) NOT NULL DEFAULT \'\''
    await runOptionalDdl(connection, addDomainColumn)
}

async function withConnection(callback) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') throw new Error('Relational database required')
    const connection = await getDatabaseConnection()
    try {
        await ensureTables(connection, dbType)
        return await callback(connection, dbType)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}

export function getProviderAdminKey(adminUser) {
    return String(adminUser?.username || `${adminUser?.role || 'admin'}:${adminUser?.domain || 'global'}`).trim().toLowerCase()
}

export async function listProviders({ adminKey = '', includeUnpublished = false, favoritesOnly = false, excludeHidden = true, viewerDomain = '' } = {}) {
    return withConnection(async (connection, dbType) => {
        const params = []
        const nextPlaceholder = (value) => {
            params.push(value)
            return `$${params.length}`
        }

        const conditions = []
        if (!includeUnpublished) conditions.push("providers.status = 'published'")
        if (excludeHidden) conditions.push("providers.status <> 'hidden'")

        let mineExpression = 'FALSE'
        if (adminKey) {
            mineExpression = `EXISTS (SELECT 1 FROM allied_health_provider_favorites mine WHERE mine.provider_id = providers.id AND mine.admin_key = ${nextPlaceholder(adminKey)})`
        }

        if (favoritesOnly && adminKey) {
            conditions.push(`EXISTS (SELECT 1 FROM allied_health_provider_favorites mine WHERE mine.provider_id = providers.id AND mine.admin_key = ${nextPlaceholder(adminKey)})`)
        }

        // Admin-scoped soft delete: hide records this admin dismissed from their own admin view only.
        if (includeUnpublished && adminKey) {
            conditions.push(`NOT EXISTS (SELECT 1 FROM allied_health_provider_admin_deletions deleted_for_admin WHERE deleted_for_admin.provider_id = providers.id AND deleted_for_admin.admin_key = ${nextPlaceholder(adminKey)})`)
        }

        // Admin-added records (pending superadmin hard-add) are scoped to the domain that added them.
        if (includeUnpublished && viewerDomain) {
            conditions.push(`(providers.status <> 'admin_added' OR providers.domain = ${nextPlaceholder(viewerDomain)})`)
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
        const sql = `SELECT providers.*,
            (SELECT COUNT(*) FROM allied_health_provider_favorites favorites WHERE favorites.provider_id = providers.id) AS favorite_count,
            ${mineExpression} AS is_favorite
            FROM allied_health_providers providers
            ${where}
            ORDER BY providers.provider ASC`
        const result = await connection.query(sql, params)
        return result.rows.map(parseProvider)
    })
}

export async function createProvider(value) {
    const row = serializeProvider(value)
    if (!row.provider) throw new Error('Provider name is required')
    return withConnection(async (connection, dbType) => {
        const fields = WRITABLE_FIELDS
        const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ')
        const values = fields.map((field) => row[field])
        const sql = `INSERT INTO allied_health_providers (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`
        const result = await connection.query(sql, values)
        return parseProvider(result.rows[0])
    })
}

export async function updateProvider(id, value) {
    const row = serializeProvider(value)
    if (!row.provider) throw new Error('Provider name is required')
    return withConnection(async (connection, dbType) => {
        const values = WRITABLE_FIELDS.map((field) => row[field])
        const assignments = WRITABLE_FIELDS.map((field, index) => `${field} = $${index + 1}`)
        const idPlaceholder = `$${values.length + 1}`
        const sql = `UPDATE allied_health_providers SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = ${idPlaceholder} RETURNING *`
        const result = await connection.query(sql, [...values, id])
        return parseProvider(result.rows[0])
    })
}

export async function setProviderStatus(id, status) {
    const normalizedStatus = String(status || '').trim().toLowerCase()
    if (!['published', 'draft', 'archived', 'hidden', 'admin_added'].includes(normalizedStatus)) {
        throw new Error('Invalid provider status')
    }

    return withConnection(async (connection, dbType) => {
        const sql = `UPDATE allied_health_providers SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`
        const result = await connection.query(sql, [id, normalizedStatus])
        return parseProvider(result.rows[0])
    })
}

export async function deleteProvider(id) {
    return withConnection(async (connection, dbType) => {
        await connection.query('DELETE FROM allied_health_providers WHERE id = $1', [id])
    })
}

export async function setProviderFavorite({ providerId, adminKey, favorite }) {
    return withConnection(async (connection, dbType) => {
        if (favorite) {
            await connection.query(
                'INSERT INTO allied_health_provider_favorites (provider_id, admin_key) VALUES ($1, $2) ON CONFLICT (provider_id, admin_key) DO NOTHING',
                [providerId, adminKey]
            )
        } else {
            await connection.query(
                'DELETE FROM allied_health_provider_favorites WHERE provider_id = $1 AND admin_key = $2',
                [providerId, adminKey]
            )
        }
    })
}

/**
 * Soft-delete a provider from a single admin's own view. The record is not
 * removed and remains visible to other admins, the public directory, and any
 * future superadmin review tool that can hard-delete via deleteProvider.
 */
export async function markProviderAdminDeleted({ providerId, adminKey }) {
    return withConnection(async (connection, dbType) => {
        await connection.query(
            'INSERT INTO allied_health_provider_admin_deletions (provider_id, admin_key) VALUES ($1, $2) ON CONFLICT (provider_id, admin_key) DO NOTHING',
            [providerId, adminKey]
        )
    })
}

/**
 * List every admin-scoped soft deletion, joined with provider info, for a
 * future superadmin review/hard-delete tool.
 */
export async function listProviderAdminDeletions() {
    return withConnection(async (connection, dbType) => {
        const sql = `SELECT deleted_for_admin.id, deleted_for_admin.provider_id, deleted_for_admin.admin_key, deleted_for_admin.created_at,
            providers.provider, providers.website_url, providers.status
            FROM allied_health_provider_admin_deletions deleted_for_admin
            JOIN allied_health_providers providers ON providers.id = deleted_for_admin.provider_id
            ORDER BY deleted_for_admin.created_at DESC`
        const result = await connection.query(sql)
        return result.rows
    })
}
