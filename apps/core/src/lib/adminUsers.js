/**
 * Admin users - DB helpers for role-based access control.
 *
 * Stores additional (non-superadmin) admin users in an `admin_users` table.
 * Superadmin credentials remain in environment variables (ADMIN_USERNAME /
 * ADMIN_PASSWORD).  Every DB-managed user carries an assignable role from
 * [`adminRoles.js`](./adminRoles.js); a role that requires a domain also stores
 * the domain that restricts which hostnames the admin can administer.
 *
 * Each user profile also carries an optional contact `email` and IANA
 * `timezone` (e.g. Australia/Sydney).
 */
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'
import { ADMIN_ROLE_DOMAIN_ADMIN, ADMIN_ROLE_LEGACY_ADMIN, DEFAULT_ADMIN_ROLE } from './adminRoles.js'

import { scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { getDatabaseConnection, detectDatabaseType } from '@/lib/database.js'

const scryptAsync = promisify(scrypt)

const ADMIN_USER_COLUMNS = 'id, username, role, domain, email, timezone, created_at'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

let legacyRoleNormalizationDone = false

/**
 * Return true when the value is an IANA time zone name the runtime understands.
 */
export function isValidAdminUserTimeZone(value) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value })
        return true
    } catch {
        return false
    }
}

/**
 * Validate and normalise admin user profile fields.
 *
 * Only the keys present on `input` are returned, so callers that omit a field
 * leave the stored value untouched. An empty string clears the column.
 * Returns `{ error }` when a supplied value is not usable.
 */
export function normalizeAdminUserProfile(input = {}) {
    const profile = {}

    if (Object.prototype.hasOwnProperty.call(input, 'email')) {
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
        if (email && !EMAIL_PATTERN.test(email)) {
            return { error: 'Email address is not valid' }
        }
        profile.email = email || null
    }

    if (Object.prototype.hasOwnProperty.call(input, 'timezone')) {
        const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : ''
        if (timezone && !isValidAdminUserTimeZone(timezone)) {
            return { error: 'Timezone must be a valid IANA time zone (e.g. Australia/Sydney)' }
        }
        profile.timezone = timezone || null
    }

    return profile
}

export async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex')
    const derivedKey = await scryptAsync(password, salt, 64)
    return `${salt}:${derivedKey.toString('hex')}`
}

export async function verifyPassword(password, storedHash) {
    const [salt, hashHex] = (storedHash || '').split(':')
    if (!salt || !hashHex) return false
    try {
        const derivedKey = await scryptAsync(password, salt, 64)
        const storedBuffer = Buffer.from(hashHex, 'hex')
        if (derivedKey.length !== storedBuffer.length) return false
        return timingSafeEqual(derivedKey, storedBuffer)
    } catch {
        return false
    }
}

async function ensureAdminUsersTable(client, dbType) {
    await whenTablesMissing(client, ['admin_users'], async () => {
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'admin',
                domain VARCHAR(100),
                email VARCHAR(255),
                timezone VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `)
    })

    // Add the profile columns to tables created before they existed. An `ALTER`
    // needs table ownership even when the column is already there, so a constrained
    // runtime role has to skip it — the read that follows fails loudly if a column
    // really is missing.
    await runOptionalDdl(client, 'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email VARCHAR(255)')
    await runOptionalDdl(client, 'ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)')

    await renameLegacyDomainAdmins(client)
}

/**
 * Rows created before roles were assignable stored every domain-scoped admin as
 * `admin`. Rename them to `domain_admin` once per process so the stored role
 * matches the registry the picker reads from. The `WHERE` clause makes the
 * statement a no-op on every later call and on every other instance.
 */
async function renameLegacyDomainAdmins(client) {
    if (legacyRoleNormalizationDone) return

    try {
        const result = await client.query(
            `UPDATE admin_users SET role = $1 WHERE role = $2`,
            [ADMIN_ROLE_DOMAIN_ADMIN, ADMIN_ROLE_LEGACY_ADMIN]
        )
        legacyRoleNormalizationDone = true
        if ((result.rowCount ?? 0) > 0) {
            console.log(`[admin-users] renamed ${result.rowCount} legacy '${ADMIN_ROLE_LEGACY_ADMIN}' role(s) to '${ADMIN_ROLE_DOMAIN_ADMIN}'`)
        }
    } catch (error) {
        // A constrained runtime role cannot write outside its own request; the
        // owner runs the rename on the next privileged deploy. Stop retrying and
        // say so once rather than on every admin lookup.
        if (error?.code === '42501') {
            legacyRoleNormalizationDone = true
            console.warn(`[admin-users] skipped legacy role rename, run as the table owner (npm run db:prepare)`)
            return
        }
        throw error
    }
}

async function releaseClient(client, dbType) {
    try {
        await client.end()
    } catch {
        // Ignore close errors
    }
}

export async function findAdminUserByUsername(username) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') return null

    const client = await getDatabaseConnection()
    try {
        await ensureAdminUsersTable(client, dbType)
        const result = await client.query(
            'SELECT id, username, password_hash, role, domain, email, timezone FROM admin_users WHERE username = $1',
            [username]
        )
        return result.rows[0] || null
    } finally {
        await releaseClient(client, dbType)
    }
}

export async function listAdminUsers() {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') return []

    const client = await getDatabaseConnection()
    try {
        await ensureAdminUsersTable(client, dbType)
        const result = await client.query(
            `SELECT ${ADMIN_USER_COLUMNS} FROM admin_users ORDER BY created_at ASC`
        )
        return result.rows
    } finally {
        await releaseClient(client, dbType)
    }
}

export async function findAdminUserById(id) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') return null

    const client = await getDatabaseConnection()
    try {
        await ensureAdminUsersTable(client, dbType)
        const result = await client.query(
            `SELECT ${ADMIN_USER_COLUMNS} FROM admin_users WHERE id = $1`,
            [id]
        )
        return result.rows[0] || null
    } finally {
        await releaseClient(client, dbType)
    }
}

export async function createAdminUser({
    username,
    password,
    role = DEFAULT_ADMIN_ROLE,
    domain = null,
    email = null,
    timezone = null,
}) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        throw new Error('Database not configured or unsupported type for admin users')
    }

    const passwordHash = await hashPassword(password)
    const client = await getDatabaseConnection()
    try {
        await ensureAdminUsersTable(client, dbType)
        const result = await client.query(
            `INSERT INTO admin_users (username, password_hash, role, domain, email, timezone)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${ADMIN_USER_COLUMNS}`,
            [username, passwordHash, role, domain, email, timezone]
        )
        return result.rows[0]
    } finally {
        await releaseClient(client, dbType)
    }
}

/**
 * Update the profile fields of a single admin user.
 *
 * Only the keys present on `fields` are written; omit a key to leave the
 * stored value untouched. `role` and `domain` must already be resolved as a pair
 * (see `resolveAdminRoleAssignment`). Returns the updated user, or null when no
 * fields were supplied or the user does not exist.
 */
export async function updateAdminUser(id, fields = {}) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        throw new Error('Database not configured or unsupported type for admin users')
    }

    const assignments = []
    const values = []

    for (const column of ['role', 'domain', 'email', 'timezone']) {
        if (Object.prototype.hasOwnProperty.call(fields, column)) {
            values.push(fields[column])
            assignments.push(`${column} = $${values.length}`)
        }
    }

    if (assignments.length === 0) return null

    values.push(id)
    const client = await getDatabaseConnection()
    try {
        await ensureAdminUsersTable(client, dbType)
        const result = await client.query(
            `UPDATE admin_users SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING ${ADMIN_USER_COLUMNS}`,
            values
        )
        return result.rows[0] || null
    } finally {
        await releaseClient(client, dbType)
    }
}

export async function deleteAdminUser(id) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        throw new Error('Database not configured or unsupported type for admin users')
    }

    const client = await getDatabaseConnection()
    try {
        const result = await client.query(
            'DELETE FROM admin_users WHERE id = $1 RETURNING id',
            [id]
        )
        return (result.rowCount ?? 0) > 0
    } finally {
        await releaseClient(client, dbType)
    }
}
