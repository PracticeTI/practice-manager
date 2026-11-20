#!/usr/bin/env node

// Reports which API routes touch tenant tables and whether they bind the request's
// domain before querying.
//
// RLS only filters a query when the connection has app.current_domain bound (see
// lib/domainScopedConnection.js). A route that opens a plain connection runs as
// whatever role the deployment logs in as, so it bypasses every policy. This walks
// src/app/api and classifies each route.js:
//
//   bound     uses getDomainBoundConnection / openDomainScopedConnection /
//             withPostgresRlsContext / applySessionRlsContext
//   operator  schema and bulk-maintenance routes that intentionally run as the owner
//   unwired   touches a tenant table with a plain connection — the remaining work
//
// The classification itself lives in lib/rlsRouteCoverage.js, which the build config
// also uses to capture the same list for the admin RLS panel.
//
//   node scripts/rls-coverage.mjs
//   node scripts/rls-coverage.mjs --unwired
//   node scripts/rls-coverage.mjs --json
//   node scripts/rls-coverage.mjs --fail-on-unwired

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectRouteCoverage } from '../src/lib/rlsRouteCoverageFiles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(__dirname, '..', 'src', 'app', 'api')

const { total, bound, operator, unwired } = collectRouteCoverage(apiRoot)
const routes = [...bound, ...operator, ...unwired].sort((a, b) => a.route.localeCompare(b.route))

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, bound, operator, unwired }, null, 2))
    process.exit(0)
}

const onlyUnwired = process.argv.includes('--unwired')
const shown = onlyUnwired ? unwired : routes

for (const entry of shown) {
    console.log(`${entry.status.padEnd(9)} ${entry.route.padEnd(52)} ${entry.tables.join(', ')}`)
}

console.log('')
console.log(`tenant-table routes: ${total}`)
console.log(`  bound    : ${bound.length}`)
console.log(`  operator : ${operator.length}`)
console.log(`  unwired  : ${unwired.length}`)

if (process.argv.includes('--fail-on-unwired') && unwired.length > 0) {
    console.error('\nUnwired routes would run unconstrained under a constrained login role.')
    process.exitCode = 1
}
