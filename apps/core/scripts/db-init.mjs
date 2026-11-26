#!/usr/bin/env node
/**
 * Bring a database up to the schema in `packages/db/supabase/migrations`.
 *
 *   npm run db:init                # apply pending migrations
 *   npm run db:init -- --bootstrap # also run the legacy per-table steps, to check the
 *                                  # migrations cover everything they used to create
 *
 * Idempotent: applied versions are recorded in `public.schema_migrations`, and a database
 * that already has the schema but no history adopts the pending files instead of replaying
 * them over existing tables. Exits non-zero on failure, so a container entrypoint can refuse
 * to serve a half-built database.
 */

import { applyMigrations } from '../src/lib/migrations.js'

const withBootstrap = process.argv.includes('--bootstrap')

const result = await applyMigrations({ log: (message) => console.log(`[db:init] ${message}`) })
console.log(
  `[db:init] migrations: ${result.applied.length} applied, ${result.adopted.length} adopted (${result.dir})`
)

if (withBootstrap) {
  // Imported here so the normal path does not pull in the table modules (and the overlay
  // registry they read) just to apply SQL.
  const { SCHEMA_STEPS, bootstrapSchema } = await import('../src/lib/schemaBootstrap.js')
  console.log(`[db:init] --bootstrap: running ${SCHEMA_STEPS.length} legacy schema steps`)

  const { applied, failed } = await bootstrapSchema({ log: (message) => console.log(`[db:init] ${message}`) })

  if (failed.length > 0) {
    console.error(`[db:init] ${applied.length} applied, ${failed.length} failed:`)
    for (const failure of failed) console.error(`  - ${failure.name}: ${failure.error}`)
    process.exit(1)
  }

  console.log(`[db:init] ${applied.length}/${SCHEMA_STEPS.length} legacy steps applied`)
}
