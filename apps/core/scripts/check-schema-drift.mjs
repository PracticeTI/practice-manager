#!/usr/bin/env node
/**
 * Refuse a schema change that landed in a table initialiser but not in a migration.
 *
 *   npm run db:check-drift
 *
 * Runs against a database already built from `packages/db/supabase/migrations` (CI creates an
 * empty one). It snapshots the catalog, runs the legacy per-table initialisers, snapshots again,
 * and fails on any difference except the per-user permissive queue policies the bootstrap adds
 * for a local owner. A Supabase preview branch and a fresh install are built from the migrations
 * alone, so anything only the initialisers create would be missing there.
 *
 * Exits non-zero on drift or a failed initialiser, so the CI `Schema` job can gate a pull request.
 */

import { Client } from 'pg'

import { applyMigrations } from '../src/lib/migrations.js'
import { buildPgClientConfig } from '../src/lib/pgClientConfig.js'
import { describeDrift, diffSchemas, snapshotSchema } from '../src/lib/schemaDrift.js'

const asJson = process.argv.includes('--json')

function fail(message) {
    console.error(`[db:check-drift] ${message}`)
    process.exitCode = 1
}

const connectionString = String(process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim()
if (!connectionString) {
    fail('Missing POSTGRES_URL or DATABASE_URL')
} else {
    const migrationResult = await applyMigrations({
        connectionString,
        log: (message) => console.log(`[db:check-drift] ${message}`),
    })
    if (asJson) console.error(`[db:check-drift] migrations: ${migrationResult.applied.length} applied, ${migrationResult.adopted.length} adopted`)

    const client = new Client({
        ...buildPgClientConfig(connectionString),
        application_name: 'practice-manager-schema-drift',
    })
    await client.connect()

    try {
        const before = await snapshotSchema(client)
        const currentUser = (await client.query('select current_user as role')).rows[0].role

        const { SCHEMA_STEPS, bootstrapSchema } = await import('../src/lib/schemaBootstrap.js')
        console.log(`[db:check-drift] running ${SCHEMA_STEPS.length} legacy schema steps as ${currentUser}`)
        const { applied, failed } = await bootstrapSchema({ log: (message) => console.log(`[db:check-drift] ${message}`) })

        if (failed.length > 0) {
            for (const failure of failed) console.error(`[db:check-drift] failed ${failure.name}: ${failure.error}`)
            fail(`${applied.length}/${SCHEMA_STEPS.length} legacy steps applied`)
        } else {
            const after = await snapshotSchema(client)
            const drift = diffSchemas(before, after, { currentUser })

            if (drift.unexpected.length > 0) {
                if (asJson) {
                    console.log(
                        JSON.stringify(
                            {
                                drift: true,
                                added: drift.added.map((object) => `${object.kind} ${object.key}`),
                                removed: drift.removed.map((object) => `${object.kind} ${object.key}`),
                                changed: drift.changed.map(({ after: next }) => `${next.kind} ${next.key}`),
                            },
                            null,
                            2
                        )
                    )
                } else {
                    for (const line of describeDrift(drift)) console.error(`[db:check-drift]   ${line}`)
                }
                fail(
                    'the legacy initialisers create objects the migrations do not. ' +
                        'Add a migration in packages/db/supabase/migrations: a preview branch and a fresh install are built from those files alone.'
                )
            } else {
                if (asJson) {
                    console.log(JSON.stringify({ drift: false, allowed: drift.allowed.length }, null, 2))
                } else {
                    console.log(
                        `[db:check-drift] no drift (${applied.length}/${SCHEMA_STEPS.length} legacy steps, ` +
                            `${drift.allowed.length} per-user queue policies ignored)`
                    )
                }
            }
        }
    } finally {
        await client.end().catch(() => {})
    }
}
