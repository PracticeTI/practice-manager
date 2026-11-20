#!/usr/bin/env node

// Measures what row-level security actually does, per table, before anything is
// switched over.
//
// RLS only protects a query when three things line up:
//   1. the connection role is neither a superuser nor BYPASSRLS,
//   2. the table carries a policy,
//   3. the request set app.current_domain (withPostgresRlsContext).
//
// This script answers (1) and (2) as the runtime role, and — for each
// domain-scoped table — how many rows a request for domain A can see that belong
// to domain B. Anything above zero is unprotected; a table that shows zero rows
// for its own domain would deny everything.
//
// Read-only: every probe runs inside a transaction that is rolled back.
//
//   node --env-file=.env.local scripts/rls-verify.mjs --domain example
//   node --env-file=.env.local scripts/rls-verify.mjs --domain example --compare another-example
//   node --env-file=.env.local scripts/rls-verify.mjs --domain example-domain
//
// `--env <NAME>` reads the connection string from that variable, so a hosted URL
// never has to appear in shell history.
//
// Set POSTGRES_RLS_RUNTIME_ROLE to the role the app runs as; when the connection
// is allowed to assume it, the probe does `SET LOCAL ROLE` exactly as
// withPostgresRlsContext() does.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as PgClient } from 'pg'
import { isLocalPostgresConnectionString } from '../src/lib/supabaseRls.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')

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

function readArg(flag, fallback = '') {
    const index = process.argv.indexOf(flag)
    if (index === -1) return fallback
    return String(process.argv[index + 1] || '').trim() || fallback
}

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`
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

async function main() {
    loadEnvFile(path.join(workspaceRoot, '.env.local'))
    loadEnvFile(path.join(workspaceRoot, '.env'))

    const urlVar = readArg('--env', '')
    const connectionString = urlVar
        ? String(process.env[urlVar] || '').trim()
        : String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
    if (!connectionString) {
        throw new Error(urlVar ? `Missing ${urlVar} in the environment.` : 'Missing DATABASE_URL or POSTGRES_URL.')
    }
    console.log(`database        : ${urlVar || 'DATABASE_URL'}`)

    const ownDomain = readArg('--domain')
    if (!ownDomain) throw new Error('Pass --domain <key>, the tenant the request is scoped to.')
    const otherDomain = readArg('--compare', 'comparison-domain')
    const runtimeRole = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || '').trim()

    const client = new PgClient(buildPgConfig(connectionString))
    await client.connect()

    try {
        await client.query('BEGIN')

        if (runtimeRole) {
            await client.query(`SET LOCAL ROLE ${quoteIdentifier(runtimeRole)}`)
        }

        const role = (await client.query(
            `SELECT current_user AS name, r.rolsuper, r.rolbypassrls
             FROM pg_roles r WHERE r.rolname = current_user`
        )).rows[0]

        const enforced = !role?.rolsuper && !role?.rolbypassrls
        console.log(`connection role : ${role?.name} (superuser=${role?.rolsuper}, bypassrls=${role?.rolbypassrls})`)
        console.log(`rls enforced    : ${enforced ? 'yes' : 'NO — policies are inert for this role'}`)
        if (!enforced) {
            console.log('\nRun with the constrained runtime role (POSTGRES_RLS_RUNTIME_ROLE, or a DATABASE_URL\n' +
                'that logs in as it) or every result below reports the truth as seen by a bypassing role.')
        }

        const tables = (await client.query(
            `SELECT c.relname
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND EXISTS (
                 SELECT 1 FROM information_schema.columns col
                 WHERE col.table_schema = 'public' AND col.table_name = c.relname
                   AND col.column_name = 'domain'
               )
             ORDER BY c.relname`
        )).rows.map((row) => row.relname)

        await client.query('SELECT set_config($1, $2, true)', ['app.current_domain', ownDomain])
        await client.query('SELECT set_config($1, $2, true)', ['app.current_role', 'admin'])

        const results = []
        for (const table of tables) {
            const ident = `public.${quoteIdentifier(table)}`
            const stats = (await client.query(
                `SELECT
                   count(*)::int AS total,
                   count(*) FILTER (WHERE domain = $1)::int AS own,
                   count(*) FILTER (WHERE domain IS DISTINCT FROM $1)::int AS foreign_rows
                 FROM ${ident}`,
                [ownDomain]
            )).rows[0]

            const policy = (await client.query(
                `SELECT c.relrowsecurity AS enabled,
                        c.relforcerowsecurity AS forced,
                        (SELECT count(*)::int FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
                        (SELECT bool_or(p.qual = 'true') FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = $1) AS has_allow_all
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = $1`,
                [table]
            )).rows[0]

            let verdict
            if (stats.foreign_rows > 0) verdict = 'LEAK'
            else if (policy?.has_allow_all) verdict = 'allow-all'
            else if (!policy?.policies) verdict = 'deny-all'
            else if (stats.total > 0 && stats.own === 0) verdict = 'wrong-scope'
            else verdict = 'ok'

            results.push({ table, ...stats, ...policy, verdict })
        }

        const width = Math.max(...results.map((r) => r.table.length), 5)
        console.log(`\n${'table'.padEnd(width)}  rls  pol  allowAll  total  ${ownDomain.padEnd(12)}  foreign  verdict`)
        for (const row of results) {
            console.log(
                `${row.table.padEnd(width)}  ${row.enabled ? ' y ' : ' n '}  ${String(row.policies).padStart(3)}` +
                `  ${row.has_allow_all ? '    yes ' : '     no '}  ${String(row.total).padStart(5)}` +
                `  ${String(row.own).padStart(12)}  ${String(row.foreign_rows).padStart(7)}  ${row.verdict}`
            )
        }

        const leaking = results.filter((r) => r.verdict === 'LEAK' || r.verdict === 'allow-all')
        const denying = results.filter((r) => r.verdict === 'deny-all' || r.verdict === 'wrong-scope')

        console.log(`\n${results.length} domain-scoped tables.`)
        if (leaking.length) console.log(`  readable across domains: ${leaking.map((r) => r.table).join(', ')}`)
        if (denying.length) console.log(`  would return nothing:    ${denying.map((r) => r.table).join(', ')}`)
        if (!enforced) console.log('  (re-run as the constrained role — this role bypasses every policy)')

        await client.query('ROLLBACK')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => { })
        throw error
    } finally {
        await client.end().catch(() => { })
    }
}

main().catch((error) => {
    console.error(`rls-verify failed: ${error.message}`)
    process.exitCode = 1
})
