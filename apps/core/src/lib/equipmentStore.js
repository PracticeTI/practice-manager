import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'
import {
    EQUIPMENT_BOOLEAN_FIELDS,
    EQUIPMENT_LIST_FIELDS,
    normalizeEquipmentSupplier,
} from '@/lib/equipmentDirectory'
import { ensureUniqueKeyOnColumns } from '@/lib/pgUniqueKeys'

const TEXT_FIELDS = [
    'supplier', 'description', 'ndis_status', 'product_catalogue_url', 'referral_contact',
    'typical_response_time', 'website_url', 'email', 'phone', 'trial_area',
    'last_verified_at', 'status', 'domain',
]

const WRITABLE_FIELDS = [...TEXT_FIELDS, ...EQUIPMENT_LIST_FIELDS, ...EQUIPMENT_BOOLEAN_FIELDS]

function serializeSupplier(value) {
    const supplier = normalizeEquipmentSupplier(value)
    const row = {}
    for (const field of TEXT_FIELDS) row[field] = String(supplier[field] || '').trim()
    for (const field of EQUIPMENT_LIST_FIELDS) row[field] = JSON.stringify(supplier[field])
    for (const field of EQUIPMENT_BOOLEAN_FIELDS) row[field] = Boolean(supplier[field])
    row.status = ['draft', 'archived', 'hidden', 'admin_added'].includes(row.status) ? row.status : 'published'
    return row
}

function parseSupplier(row) {
    if (!row) return null
    const parsed = { ...row }
    for (const field of EQUIPMENT_LIST_FIELDS) {
        try {
            parsed[field] = Array.isArray(row[field]) ? row[field] : JSON.parse(row[field] || '[]')
        } catch {
            parsed[field] = []
        }
    }
    return normalizeEquipmentSupplier(parsed)
}

/**
 * The database sync tools recreate tables from column definitions only, which drops the primary
 * key on the target database. PostgreSQL then refuses to create any foreign key that references
 * equipment_suppliers.id with:
 *   "there is no unique constraint matching given keys for referenced table \"equipment_suppliers\""
 * Repair the missing unique key before creating the dependent tables so the directory keeps working.
 */
async function ensureSupplierIdIsUnique(connection, dbType) {
    if (dbType !== 'postgresql') return true
    try {
        const result = await ensureUniqueKeyOnColumns(connection, {
            tableName: 'equipment_suppliers',
            columns: ['id'],
            preferPrimary: true,
        })
        if (!result.ensured) {
            const detail = (result.errors || []).join(' | ') || result.reason
            console.warn(`[equipmentStore] equipment_suppliers.id has no unique key and one could not be added (${detail})`)
        }
        return result.ensured
    } catch (error) {
        console.warn('[equipmentStore] Could not verify equipment_suppliers.id uniqueness:', error?.message || error)
        return false
    }
}

async function ensureTables(connection, dbType) {
    const supplierTable = `CREATE TABLE IF NOT EXISTS equipment_suppliers (
            id BIGSERIAL PRIMARY KEY, supplier TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            equipment_categories TEXT NOT NULL DEFAULT '[]', product_types TEXT NOT NULL DEFAULT '[]',
            professions TEXT NOT NULL DEFAULT '[]', ndis_status VARCHAR(40) NOT NULL DEFAULT '',
            geography TEXT NOT NULL DEFAULT '[]', home_trials BOOLEAN NOT NULL DEFAULT FALSE,
            hire_rental BOOLEAN NOT NULL DEFAULT FALSE, quotes BOOLEAN NOT NULL DEFAULT FALSE,
            product_catalogue_url TEXT NOT NULL DEFAULT '', referral_contact TEXT NOT NULL DEFAULT '',
            typical_response_time VARCHAR(120) NOT NULL DEFAULT '', funding TEXT NOT NULL DEFAULT '[]',
            specialist_equipment TEXT NOT NULL DEFAULT '[]', repairs BOOLEAN NOT NULL DEFAULT FALSE,
            website_url TEXT NOT NULL DEFAULT '', email VARCHAR(320) NOT NULL DEFAULT '', phone VARCHAR(80) NOT NULL DEFAULT '',
            brands TEXT NOT NULL DEFAULT '[]', delivery BOOLEAN NOT NULL DEFAULT FALSE, trial_area TEXT NOT NULL DEFAULT '',
            last_verified_at VARCHAR(32) NOT NULL DEFAULT '', status VARCHAR(24) NOT NULL DEFAULT 'published',
            domain VARCHAR(120) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
    const favoritesTable = `CREATE TABLE IF NOT EXISTS equipment_supplier_favorites (
            id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES equipment_suppliers(id) ON DELETE CASCADE,
            admin_key VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (supplier_id, admin_key)
        )`
    const adminDeletionsTable = `CREATE TABLE IF NOT EXISTS equipment_supplier_admin_deletions (
            id BIGSERIAL PRIMARY KEY, supplier_id BIGINT NOT NULL REFERENCES equipment_suppliers(id) ON DELETE CASCADE,
            admin_key VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (supplier_id, admin_key)
        )`

    // Lazy creation is only reachable while the connection owns the schema, so probe
    // first: a provisioned database then issues no DDL at all.
    const missing = await missingTables(connection, [
        'equipment_suppliers',
        'equipment_supplier_favorites',
        'equipment_supplier_admin_deletions',
    ])

    if (missing.includes('equipment_suppliers')) await connection.query(supplierTable)

    // Both tables below reference equipment_suppliers(id), which must be unique.
    if (await ensureSupplierIdIsUnique(connection, dbType)) {
        if (missing.includes('equipment_supplier_favorites')) await connection.query(favoritesTable)
        if (missing.includes('equipment_supplier_admin_deletions')) await connection.query(adminDeletionsTable)
    } else {
        console.warn('[equipmentStore] Skipping equipment_supplier_favorites and equipment_supplier_admin_deletions: equipment_suppliers.id is not unique. Favourites and admin soft-deletes will be unavailable until it is repaired.')
    }

    // CREATE TABLE IF NOT EXISTS won't add columns to a table that already exists, so backfill separately.
    const addDomainColumn = 'ALTER TABLE equipment_suppliers ADD COLUMN IF NOT EXISTS domain VARCHAR(120) NOT NULL DEFAULT \'\''
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

export function getEquipmentAdminKey(adminUser) {
    return String(adminUser?.username || `${adminUser?.role || 'admin'}:${adminUser?.domain || 'global'}`).trim().toLowerCase()
}

export async function listEquipmentSuppliers({ adminKey = '', includeUnpublished = false, favoritesOnly = false, excludeHidden = true, viewerDomain = '' } = {}) {
    return withConnection(async (connection, dbType) => {
        const params = []
        const nextPlaceholder = (value) => {
            params.push(value)
            return `$${params.length}`
        }

        const conditions = []
        if (!includeUnpublished) conditions.push("suppliers.status = 'published'")
        if (excludeHidden) conditions.push("suppliers.status <> 'hidden'")

        let mineExpression = 'FALSE'
        if (adminKey) {
            mineExpression = `EXISTS (SELECT 1 FROM equipment_supplier_favorites mine WHERE mine.supplier_id = suppliers.id AND mine.admin_key = ${nextPlaceholder(adminKey)})`
        }

        if (favoritesOnly && adminKey) {
            conditions.push(`EXISTS (SELECT 1 FROM equipment_supplier_favorites mine WHERE mine.supplier_id = suppliers.id AND mine.admin_key = ${nextPlaceholder(adminKey)})`)
        }

        // Admin-scoped soft delete: hide records this admin dismissed from their own admin view only.
        if (includeUnpublished && adminKey) {
            conditions.push(`NOT EXISTS (SELECT 1 FROM equipment_supplier_admin_deletions deleted_for_admin WHERE deleted_for_admin.supplier_id = suppliers.id AND deleted_for_admin.admin_key = ${nextPlaceholder(adminKey)})`)
        }

        // Admin-added records (pending superadmin hard-add) are scoped to the domain that added them.
        if (includeUnpublished && viewerDomain) {
            conditions.push(`(suppliers.status <> 'admin_added' OR suppliers.domain = ${nextPlaceholder(viewerDomain)})`)
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
        const sql = `SELECT suppliers.*,
            (SELECT COUNT(*) FROM equipment_supplier_favorites favorites WHERE favorites.supplier_id = suppliers.id) AS favorite_count,
            ${mineExpression} AS is_favorite
            FROM equipment_suppliers suppliers
            ${where}
            ORDER BY suppliers.supplier ASC`
        const result = await connection.query(sql, params)
        return result.rows.map(parseSupplier)
    })
}

export async function createEquipmentSupplier(value) {
    const row = serializeSupplier(value)
    if (!row.supplier) throw new Error('Supplier name is required')
    return withConnection(async (connection, dbType) => {
        const fields = WRITABLE_FIELDS
        const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ')
        const values = fields.map((field) => row[field])
        const sql = `INSERT INTO equipment_suppliers (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`
        const result = await connection.query(sql, values)
        return parseSupplier(result.rows[0])
    })
}

export async function updateEquipmentSupplier(id, value) {
    const row = serializeSupplier(value)
    if (!row.supplier) throw new Error('Supplier name is required')
    return withConnection(async (connection, dbType) => {
        const values = WRITABLE_FIELDS.map((field) => row[field])
        const assignments = WRITABLE_FIELDS.map((field, index) => `${field} = $${index + 1}`)
        const idPlaceholder = `$${values.length + 1}`
        const sql = `UPDATE equipment_suppliers SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = ${idPlaceholder} RETURNING *`
        const result = await connection.query(sql, [...values, id])
        return parseSupplier(result.rows[0])
    })
}

export async function setEquipmentSupplierStatus(id, status) {
    const normalizedStatus = String(status || '').trim().toLowerCase()
    if (!['published', 'draft', 'archived', 'hidden', 'admin_added'].includes(normalizedStatus)) {
        throw new Error('Invalid supplier status')
    }

    return withConnection(async (connection, dbType) => {
        const sql = `UPDATE equipment_suppliers SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`
        const result = await connection.query(sql, [id, normalizedStatus])
        return parseSupplier(result.rows[0])
    })
}

export async function deleteEquipmentSupplier(id) {
    return withConnection(async (connection, dbType) => {
        await connection.query('DELETE FROM equipment_suppliers WHERE id = $1', [id])
    })
}

export async function setEquipmentFavorite({ supplierId, adminKey, favorite }) {
    return withConnection(async (connection, dbType) => {
        if (favorite) {
            await connection.query(
                'INSERT INTO equipment_supplier_favorites (supplier_id, admin_key) VALUES ($1, $2) ON CONFLICT (supplier_id, admin_key) DO NOTHING',
                [supplierId, adminKey]
            )
        } else {
            await connection.query(
                'DELETE FROM equipment_supplier_favorites WHERE supplier_id = $1 AND admin_key = $2',
                [supplierId, adminKey]
            )
        }
    })
}

/**
 * Soft-delete a supplier from a single admin's own view. The record is not
 * removed and remains visible to other admins, the public directory, and any
 * future superadmin review tool that can hard-delete via deleteEquipmentSupplier.
 */
export async function markEquipmentSupplierAdminDeleted({ supplierId, adminKey }) {
    return withConnection(async (connection, dbType) => {
        await connection.query(
            'INSERT INTO equipment_supplier_admin_deletions (supplier_id, admin_key) VALUES ($1, $2) ON CONFLICT (supplier_id, admin_key) DO NOTHING',
            [supplierId, adminKey]
        )
    })
}

/**
 * List every admin-scoped soft deletion, joined with supplier info, for a
 * future superadmin review/hard-delete tool.
 */
export async function listEquipmentSupplierAdminDeletions() {
    return withConnection(async (connection, dbType) => {
        const sql = `SELECT deleted_for_admin.id, deleted_for_admin.supplier_id, deleted_for_admin.admin_key, deleted_for_admin.created_at,
            suppliers.supplier, suppliers.website_url, suppliers.status
            FROM equipment_supplier_admin_deletions deleted_for_admin
            JOIN equipment_suppliers suppliers ON suppliers.id = deleted_for_admin.supplier_id
            ORDER BY deleted_for_admin.created_at DESC`
        const result = await connection.query(sql)
        return result.rows
    })
}