#!/usr/bin/env node
/**
 * Create every table a fresh install needs.
 *
 *   npm run db:init
 *
 * Idempotent: the helpers only create what is missing, so this is safe on every start.
 * Exits non-zero when any step fails, so a container entrypoint can refuse to serve a
 * half-built database.
 */

import { SCHEMA_STEPS, bootstrapSchema } from '../src/lib/schemaBootstrap.js'

console.log(`[db:init] applying ${SCHEMA_STEPS.length} schema steps`)

const { applied, failed } = await bootstrapSchema({ log: (message) => console.log(`[db:init] ${message}`) })

if (failed.length > 0) {
  console.error(`[db:init] ${applied.length} applied, ${failed.length} failed:`)
  for (const failure of failed) console.error(`  - ${failure.name}: ${failure.error}`)
  process.exit(1)
}

console.log(`[db:init] ${applied.length}/${SCHEMA_STEPS.length} steps applied`)
