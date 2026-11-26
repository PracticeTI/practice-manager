/**
 * Apply the SQL migrations in `packages/db/supabase/migrations`.
 *
 * The same files are replayed by Supabase branches and applied here for Docker, LAN and
 * desktop installs, so a migration may not depend on anything Supabase adds to a database.
 * Applied versions are recorded in `public.schema_migrations`, and a database that already
 * has the app's schema but no history — an install that predates migrations — adopts the
 * pending files instead of replaying them over existing tables.
 *
 * A Supabase branch has its own history in `supabase_migrations.schema_migrations`; when that
 * table exists, its versions count as applied so running this runner against a branch is a
 * no-op rather than a second attempt at the baseline.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

import { buildPgClientConfig } from './pgClientConfig.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION_FILE = /^(\d{14})_.+\.sql$/
const HISTORY_TABLE = 'public.schema_migrations'
/** A table every install has once the baseline has been applied. */
const SCHEMA_MARKER = 'public.patients'

/**
 * Directories that may hold the migrations, most specific first. `DB_MIGRATIONS_DIR` wins,
 * which is how a staged install points at its own copy.
 */
export function migrationDirectoryCandidates({ cwd = process.cwd(), env = process.env } = {}) {
    return [
        env.DB_MIGRATIONS_DIR,
        path.join(cwd, 'packages', 'db', 'supabase', 'migrations'),
        path.join(cwd, 'db-migrations'),
        path.join(cwd, 'apps', 'core', 'db-migrations'),
        path.resolve(cwd, '..', '..', 'packages', 'db', 'supabase', 'migrations'),
        path.resolve(HERE, '..', '..', '..', '..', 'packages', 'db', 'supabase', 'migrations'),
    ]
        .filter(Boolean)
        .map((candidate) => path.resolve(candidate))
}

export function resolveMigrationsDir(options = {}) {
    const candidates = migrationDirectoryCandidates(options)
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isDirectory()) return candidate
        } catch {
            // try the next one
        }
    }
    throw new Error(`No migrations directory found. Looked in:\n  ${candidates.join('\n  ')}`)
}

/** Migration files in apply order; `.gitkeep` and anything without a 14-digit version is ignored. */
export function listMigrations(dir) {
    const migrations = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const match = entry.name.match(MIGRATION_FILE)
        if (!match) continue
        migrations.push({ version: match[1], name: entry.name, file: path.join(dir, entry.name) })
    }

    migrations.sort((a, b) => a.version.localeCompare(b.version) || a.name.localeCompare(b.name))

    const seen = new Map()
    for (const migration of migrations) {
        const previous = seen.get(migration.version)
        if (previous) {
            throw new Error(`Duplicate migration version ${migration.version}: ${previous} and ${migration.name}`)
        }
        seen.set(migration.version, migration.name)
    }
    return migrations
}

async function readAppliedVersions(client) {
    const applied = new Set()
    const own = await client.query(`select version from ${HISTORY_TABLE}`)
    for (const row of own.rows) applied.add(String(row.version))

    const remote = await client.query(
        `select to_regclass('supabase_migrations.schema_migrations') is not null as present`
    )
    if (remote.rows[0]?.present) {
        const history = await client.query('select version from supabase_migrations.schema_migrations')
        for (const row of history.rows) applied.add(String(row.version))
    }
    return applied
}

async function schemaPresent(client) {
    const result = await client.query(`select to_regclass($1) is not null as present`, [SCHEMA_MARKER])
    return result.rows[0]?.present === true
}

async function record(client, migration, note) {
    await client.query(`insert into ${HISTORY_TABLE} (version, name) values ($1, $2) on conflict (version) do nothing`, [
        migration.version,
        note ? `${migration.name} (${note})` : migration.name,
    ])
}

/**
 * Apply every migration the database has no history for.
 *
 * @param {{
 *   connectionString?: string,
 *   dir?: string,
 *   adopt?: boolean,
 *   log?: (message: string) => void,
 * }} [options]
 * @returns {Promise<{ dir: string, applied: string[], adopted: string[] }>}
 */
export async function applyMigrations(options = {}) {
    const connectionString =
        options.connectionString || String(process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim()
    if (!connectionString) throw new Error('Missing POSTGRES_URL or DATABASE_URL')

    const dir = options.dir || resolveMigrationsDir()
    const migrations = listMigrations(dir)
    if (migrations.length === 0) throw new Error(`No migrations in ${dir}`)

    const log = typeof options.log === 'function' ? options.log : () => {}
    const adopt = options.adopt !== false

    const client = new Client({ ...buildPgClientConfig(connectionString), application_name: 'practice-manager-migrations' })
    await client.connect()

    try {
        await client.query(
            `create table if not exists ${HISTORY_TABLE} (
                version text primary key,
                name text not null,
                applied_at timestamptz not null default now()
            )`
        )

        const appliedVersions = await readAppliedVersions(client)
        const pending = migrations.filter((migration) => !appliedVersions.has(migration.version))
        if (pending.length === 0) {
            log(`up to date (${migrations.length} migration${migrations.length === 1 ? '' : 's'})`)
            return { dir, applied: [], adopted: [] }
        }

        if (adopt && appliedVersions.size === 0 && (await schemaPresent(client))) {
            const names = pending.map((migration) => migration.name)
            log(`existing schema with no migration history; adopting ${names.length} migration(s): ${names.join(', ')}`)
            await client.query('begin')
            try {
                for (const migration of pending) await record(client, migration, 'adopted')
                await client.query('commit')
            } catch (error) {
                await client.query('rollback').catch(() => {})
                throw error
            }
            return { dir, applied: [], adopted: names }
        }

        for (const migration of pending) {
            const sql = fs.readFileSync(migration.file, 'utf8')
            log(`applying ${migration.name}`)
            await client.query('begin')
            try {
                await client.query(sql)
                await record(client, migration)
                await client.query('commit')
            } catch (error) {
                await client.query('rollback').catch(() => {})
                const message = error?.message || String(error)
                throw new Error(`${migration.name} failed: ${message}`, { cause: error })
            }
        }

        return { dir, applied: pending.map((migration) => migration.name), adopted: [] }
    } finally {
        await client.end().catch(() => {})
    }
}
