#!/usr/bin/env node

// Installs the settings tables, row-level security policies for every table that
// had RLS enabled without a policy, and grants the runtime role the privileges RLS
// then checks. `npm run db:prepare` runs this against a deployment's database.
//
// Dry run by default: the DDL runs inside a transaction and is rolled back, so
// the SQL is validated without changing anything. Pass `--apply` to commit.
//
//   node --env-file=.env.local scripts/setup-rls-policies.mjs
//   node --env-file=.env.local scripts/setup-rls-policies.mjs --apply

// Run this as the schema owner. Policies are installed but never forced, so the
// owner connection keeps working; a forced policy set would lock it out.
//
// A pooled connection may arrive with a non-owner role already assumed (see
// ensureOwnerSession), so the script resets to the login role first and fails
// with a clear message when that login still cannot create in schema public.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as PgClient } from 'pg'
import { isLocalPostgresConnectionString } from '../src/lib/supabaseRls.js'
import { SETTINGS_TABLE_STATEMENTS } from '../src/lib/settingsTables.js'
import { IDENTITY_INDEX_STATEMENTS, IDENTITY_TABLE_STATEMENTS } from '../src/lib/identitySchema.js'
import {
    DIRECTORY_CHILD_TABLES,
    RLS_POLICY_TABLES,
    TENANT_SCOPED_TABLES,
    buildGrantStatements,
    buildPolicyStatements,
    quoteIdentifier,
} from '../src/lib/rlsPolicies.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')
const APPLY = process.argv.includes('--apply')

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf8')

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex <= 0) continue

        const key = trimmed.slice(0, eqIndex).trim()
        let value = trimmed.slice(eqIndex + 1).trim()
        if (!key) continue

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        if (!(key in process.env)) process.env[key] = value
    }
}

async function existingTables(client, tables) {
    const result = await client.query(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1)`,
        [tables]
    )
    return new Set(result.rows.map((row) => row.relname))
}

async function tablesWithDomainColumn(client, tables) {
    if (tables.length === 0) return new Set()
    const result = await client.query(
        `SELECT table_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'domain'
           AND table_name = ANY($1)`,
        [tables]
    )
    return new Set(result.rows.map((row) => row.table_name))
}

async function roleExists(client, role) {
    const result = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    return result.rows.length > 0
}

// This script's DDL — CREATE TABLE, ALTER TABLE, CREATE POLICY, GRANT — needs the
// table owner. A pooled connection can arrive with `role` already set, either from
// `ALTER ROLE ... SET role` or as the residue of another client's session-level
// `SET ROLE` on a transaction-mode pooler (Supabase, pgbouncer). Then `current_user`
// is the constrained runtime role and every statement fails with
// "permission denied for schema public" — or worse, on a pooler that recycles
// sessions, succeeds on one run and fails on the next.
const IDENTITY_SQL = `
  SELECT current_user AS current_user,
         session_user AS session_user,
         current_setting('role') AS assumed_role
`

async function ensureOwnerSession(client) {
    const { rows } = await client.query(IDENTITY_SQL)
    const identity = rows[0] || {}

    if (identity.current_user && identity.current_user !== identity.session_user) {
        await client.query('RESET ROLE')
        console.log(
            `Connection arrived as ${identity.current_user} (assumed role ${identity.assumed_role}, ` +
            `login ${identity.session_user}); reset to the login role for owner DDL.`
        )
    }

    const canCreate = await client.query(
        `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS allowed, current_user AS name`
    )
    const session = canCreate.rows[0] || {}
    if (session.allowed !== true) {
        throw new Error(
            `Connected as ${session.name || 'unknown'}, which cannot create objects in schema public. ` +
            'Run this script as the schema owner (the login user, not the constrained runtime role).'
        )
    }

    return session.name
}

// Hosted poolers require TLS and present a certificate chain Node will not
// verify, which is how the application itself connects (see lib/database.js).
// Local Postgres has no TLS, so it keeps the plain config.
function buildPgConfig(connectionString) {
    const parsed = new URL(connectionString)
    const isLocal = isLocalPostgresConnectionString(connectionString)

    return {
        connectionString,
        password: parsed.password || '',
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    }
}

// Sequences the runtime role needs USAGE on to INSERT: the ones owned by the table
// (`SERIAL`/`IDENTITY`), plus the ones a column default calls nextval() on without
// an ownership link. `admin_users` and `equipment_suppliers` were created the second
// way, so an ownership-only query left their inserts failing with "permission denied
// for sequence admin_users_id_seq" once the app ran as the constrained role.
async function ownedSequences(client, tables) {
    const result = await client.query(
        `SELECT DISTINCT s.relname AS sequence_name
         FROM pg_class s
         JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
         JOIN pg_class t ON t.oid = d.refobjid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE s.relkind = 'S'
           AND n.nspname = 'public'
           AND t.relname = ANY($1)
         UNION
         SELECT DISTINCT s.relname
         FROM pg_attrdef ad
         JOIN pg_class t ON t.oid = ad.adrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_depend d
           ON d.classid = 'pg_attrdef'::regclass
          AND d.objid = ad.oid
          AND d.refclassid = 'pg_class'::regclass
         JOIN pg_class s ON s.oid = d.refobjid AND s.relkind = 'S'
         WHERE n.nspname = 'public'
           AND t.relname = ANY($1)
         ORDER BY 1`,
        [tables]
    )
    return result.rows.map((row) => row.sequence_name)
}

async function policyCounts(client, tables) {
    const result = await client.query(
        `SELECT tablename, COUNT(*)::int AS policy_count
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1)
         GROUP BY tablename`,
        [tables]
    )
    return new Map(result.rows.map((row) => [row.tablename, row.policy_count]))
}

async function main() {
    loadEnvFile(path.join(workspaceRoot, '.env.local'))
    loadEnvFile(path.join(workspaceRoot, '.env'))

    const connectionString = String(process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim()
    if (!connectionString) {
        throw new Error('Missing POSTGRES_URL or DATABASE_URL in environment.')
    }

    const runtimeRole = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || 'practice_manager_app').trim()

    const client = new PgClient(buildPgConfig(connectionString))
    await client.connect()

    try {
        // Owner DDL, so drop any role the pooler assumed before touching anything.
        await ensureOwnerSession(client)

        // The settings tables hold the app's own configuration, and their policies are
        // part of this set. Create them first so one command provisions schema and
        // policies together; both statements are idempotent.
        for (const statement of SETTINGS_TABLE_STATEMENTS) {
            await client.query(statement)
        }

        const present = await existingTables(client, RLS_POLICY_TABLES)
        const installed = RLS_POLICY_TABLES.filter((table) => present.has(table))
        const missing = RLS_POLICY_TABLES.filter((table) => !present.has(table))

        if (installed.length === 0) {
            throw new Error('None of the target tables exist. Start the application once so it creates its schema.')
        }

        const tenantInstalled = TENANT_SCOPED_TABLES.filter((table) => present.has(table))
        const withDomain = await tablesWithDomainColumn(client, tenantInstalled)
        const withoutDomain = tenantInstalled.filter((table) => !withDomain.has(table))
        if (withoutDomain.length > 0) {
            throw new Error(
                `Tenant-scoped tables are missing a domain column: ${withoutDomain.join(', ')}. ` +
                'Fix the schema before installing domain policies.'
            )
        }

        const orphanedChildren = DIRECTORY_CHILD_TABLES.filter(
            (entry) => present.has(entry.table) && !present.has(entry.parentTable)
        )
        if (orphanedChildren.length > 0) {
            throw new Error(
                `Child tables are missing their parent table: ${orphanedChildren
                    .map((entry) => `${entry.table} -> ${entry.parentTable}`)
                    .join(', ')}`
            )
        }

        const policyStatements = buildPolicyStatements({ role: runtimeRole }).filter((statement) => {
            const match = statement.match(/public\."([^"]+)"/)
            return !match || present.has(match[1])
        })

        console.log(`Installing policies for ${installed.length} of ${RLS_POLICY_TABLES.length} tables.`)
        if (missing.length > 0) {
            console.log(`Skipping ${missing.length} table(s) that do not exist yet: ${missing.join(', ')}`)
        }

        await client.query('BEGIN')
        let inTransaction = new Map()
        try {
            // The identity model is additive and has no policies or grants yet, so it
            // is not part of the RLS set. Create it in the owner pass anyway, inside
            // the transaction so a dry run changes nothing: nothing in the runtime
            // may need the owner credential to add it later.
            for (const statement of [...IDENTITY_TABLE_STATEMENTS, ...IDENTITY_INDEX_STATEMENTS]) {
                await client.query(statement)
            }

            for (const statement of policyStatements) {
                await client.query(statement)
            }

            if (await roleExists(client, runtimeRole)) {
                const sequences = await ownedSequences(client, installed)
                for (const statement of buildGrantStatements(runtimeRole, { tables: installed, sequences })) {
                    await client.query(statement)
                }
                console.log(`Granted table and sequence access to ${quoteIdentifier(runtimeRole)}.`)
            } else {
                console.log(`Runtime role ${quoteIdentifier(runtimeRole)} does not exist; skipped grants.`)
            }

            const pending = await policyCounts(client, installed)
            const withoutPolicies = installed.filter((table) => !pending.get(table))
            if (withoutPolicies.length > 0) {
                throw new Error(`Policy installation left tables unprotected: ${withoutPolicies.join(', ')}`)
            }
            inTransaction = pending

            if (APPLY) {
                await client.query('COMMIT')
            } else {
                await client.query('ROLLBACK')
            }
        } catch (error) {
            await client.query('ROLLBACK').catch(() => { })
            throw error
        }

        const counts = APPLY ? await policyCounts(client, installed) : inTransaction
        for (const table of installed) {
            console.log(`  ${table}: ${counts.get(table) || 0} policy(ies)`)
        }

        console.log(APPLY ? 'Committed policy set and grants.' : 'Dry run complete; re-run with --apply to commit. No changes were applied.')

        console.log(
            'Next: adopt withPostgresRlsContext in each tenant route before pointing DATABASE_URL ' +
            'at a role with NOSUPERUSER NOBYPASSRLS. See docs/postgres-rls-rollout.md.'
        )
    } finally {
        await client.end()
    }
}

main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
})
