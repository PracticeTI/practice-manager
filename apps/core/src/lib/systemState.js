/**
 * System-wide key/value settings.
 *
 * Kept as the module name its callers already import, now backed by
 * `system_settings` (see lib/appSettings.js). The old `system_state` table is gone:
 * it mixed system-wide values with per-domain ones, which meant the per-domain half
 * could never be protected by row-level security.
 *
 * Prefer `getSystemSetting`/`setSystemSetting` from lib/appSettings.js in new code.
 * These helpers remain for the admin System State screen, which lists and edits raw
 * rows.
 */

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import {
    deleteSystemSetting,
    getSystemSetting,
    setSystemSetting,
} from '@/lib/appSettings'
import { SYSTEM_SETTINGS_TABLE_STATEMENT } from './settingsTables.js'

function parseSystemStateValue(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }
    return value
}

async function ensureSystemStateTable(connection) {
    await connection.query(SYSTEM_SETTINGS_TABLE_STATEMENT)
}

export async function getSystemStateValue(key) {
    return getSystemSetting(key)
}

export async function setSystemStateValue(key, value) {
    return setSystemSetting(key, value)
}

export async function deleteSystemStateValue(key) {
    return deleteSystemSetting(key)
}

function normalizeListOptions(options = {}) {
    const limit = Number.parseInt(options.limit, 10)
    const offset = Number.parseInt(options.offset, 10)
    const query = String(options.query || '').trim()

    return {
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
        offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
        query,
    }
}

export async function listSystemStateRecords(options = {}) {
    let connection = null
    try {
        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') return []

        const { limit, offset, query } = normalizeListOptions(options)
        connection = await getDatabaseConnection()
        await ensureSystemStateTable(connection)

        const params = query ? [`%${query}%`, limit, offset] : [limit, offset]
        const whereClause = query ? 'WHERE key ILIKE $1 OR value ILIKE $1' : ''
        const limitParam = query ? '$2' : '$1'
        const offsetParam = query ? '$3' : '$2'
        const result = await connection.query(`
                SELECT key, value, created_at, updated_at
                FROM system_settings
                ${whereClause}
                ORDER BY updated_at DESC NULLS LAST, key ASC
                LIMIT ${limitParam} OFFSET ${offsetParam}
            `, params)
        return (result.rows || []).map((row) => ({
            id: row.key,
            key: row.key,
            value: row.value,
            parsedValue: parseSystemStateValue(row.value),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }))
    } catch {
        return []
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function countSystemStateRecords(options = {}) {
    let connection = null
    try {
        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') return 0

        const { query } = normalizeListOptions(options)
        connection = await getDatabaseConnection()
        await ensureSystemStateTable(connection)

        const result = await connection.query(
            `SELECT COUNT(*)::int AS count FROM system_settings ${query ? 'WHERE key ILIKE $1 OR value ILIKE $1' : ''}`,
            query ? [`%${query}%`] : []
        )
        return Number(result.rows?.[0]?.count || 0)
    } catch {
        return 0
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
