// Check that the documentation links on every Funder record are still live.
//
// Why: the NDIA republishes its pricing schedule and support catalogue each
// financial year under NEW media URLs, so the URLs a funder holds rot on a 1 July
// cadence. This script HEADs (and where needed GETs) each document URL and reports
// what it found, so a dead link is discovered before a quote cites it.
//
// "Blocked" (403/429) is reported separately from "Broken" (404/410/other 4xx):
// ndis.gov.au sits behind Cloudflare and refuses automated requests for
// `/media/*` downloads, so a 403 here usually means "a human can open this".
//
// Usage:
//   node scripts/check-funder-links.mjs                        # report only, DB records
//   node scripts/check-funder-links.mjs --apply                # record the results
//   node scripts/check-funder-links.mjs --registry             # check the built-in registry, no DB
//   node scripts/check-funder-links.mjs --only ndis --limit 5  # pilot a subset
//   node scripts/check-funder-links.mjs --concurrency 4 --timeout 15000
//   node scripts/check-funder-links.mjs --json                 # full result set as JSON
//
// Exits 1 when a link is Broken, so it can gate a release. Blocked/Redirected do
// not fail the run.
//
// Every run appends a JSONL row per document to local/funder-link-check-<ts>.jsonl
// (tracked, like the other local/*.jsonl logs) so link rot can be tracked over time.
//
// `--apply` writes only link_status / http_status / link_checked_at. It runs the
// UPDATE here rather than reusing src/lib/fundersStore.js because that module
// imports through the `@/` alias, which plain `node` cannot resolve.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
    DEFAULT_LINK_CHECK_CONCURRENCY,
    DEFAULT_LINK_CHECK_TIMEOUT_MS,
    checkFunderLinks,
    describeLinkCheckSummary,
    summarizeLinkCheck,
} from '../src/lib/funderLinkCheck.js'
import { BUILT_IN_FUNDER_SEEDS } from '../src/lib/funderRegistry.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

function loadEnvFiles() {
    for (const fileName of ['.env.local', '.env']) {
        const filePath = path.join(REPO_ROOT, fileName)
        if (!fs.existsSync(filePath)) continue

        for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
            const trimmed = String(line || '').trim()
            if (!trimmed || trimmed.startsWith('#')) continue

            const eqIndex = trimmed.indexOf('=')
            if (eqIndex <= 0) continue

            const key = trimmed.slice(0, eqIndex).trim()
            let value = trimmed.slice(eqIndex + 1).trim()
            if (!key || process.env[key] !== undefined) continue

            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1)
            }

            process.env[key] = value
        }
    }
}
loadEnvFiles()

function parseArgs(argv) {
    const args = {
        apply: false,
        registry: false,
        json: false,
        only: [],
        limit: 0,
        concurrency: DEFAULT_LINK_CHECK_CONCURRENCY,
        timeout: DEFAULT_LINK_CHECK_TIMEOUT_MS,
    }

    for (let i = 0; i < argv.length; i += 1) {
        const token = String(argv[i] || '').trim()

        if (token === '--apply') { args.apply = true; continue }
        if (token === '--registry') { args.registry = true; continue }
        if (token === '--json') { args.json = true; continue }

        const value = String(argv[i + 1] || '').trim()
        if (token === '--only') { args.only = value.split(',').map((key) => key.trim().toLowerCase()).filter(Boolean); i += 1; continue }
        if (token === '--limit') { args.limit = Number.parseInt(value, 10) || 0; i += 1; continue }
        if (token === '--concurrency') { args.concurrency = Number.parseInt(value, 10) || args.concurrency; i += 1; continue }
        if (token === '--timeout') { args.timeout = Number.parseInt(value, 10) || args.timeout; i += 1 }
    }

    return args
}

const args = parseArgs(process.argv.slice(2))

/** Keep the first `limit` documents across the funder list. */
function trimToLimit(funders, limit) {
    if (limit <= 0) return funders

    let remaining = limit
    const trimmed = []
    for (const funder of funders) {
        if (remaining <= 0) break
        const documents = (funder.documents || []).slice(0, remaining)
        remaining -= documents.length
        trimmed.push({ ...funder, documents })
    }
    return trimmed
}

async function connect() {
    const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
    if (!connectionString) throw new Error('Missing DATABASE_URL (or POSTGRES_URL)')

    const url = new URL(connectionString)
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(url.hostname)

    const client = new Client({
        connectionString,
        password: url.password || '',
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    })

    await client.connect()
    return client
}

/** Funders straight from the registry — no database required. */
function fundersFromRegistry() {
    return BUILT_IN_FUNDER_SEEDS.map((funder) => ({
        key: funder.key,
        name: funder.name,
        // `id` is null: registry documents have no database row to record against.
        documents: (funder.documents || []).map((document) => ({ ...document, id: null })),
    }))
}

/** Funders from the database, with their documents attached. */
async function fundersFromDatabase(connection) {
    const funderResult = await connection.query(
        'SELECT id, key, name FROM funders ORDER BY sort_order ASC, name ASC'
    )
    const documentResult = await connection.query(
        `SELECT id, funder_id, title, url, doc_type, link_status
           FROM funder_documents
          ORDER BY funder_id ASC, position ASC, id ASC`
    )

    const documentsByFunder = new Map()
    for (const row of documentResult.rows || []) {
        const key = String(row.funder_id)
        if (!documentsByFunder.has(key)) documentsByFunder.set(key, [])
        documentsByFunder.get(key).push(row)
    }

    return (funderResult.rows || []).map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        documents: documentsByFunder.get(String(row.id)) || [],
    }))
}

let connection = null

async function loadFunders() {
    if (args.registry) return { funders: fundersFromRegistry(), source: 'registry' }

    try {
        connection = await connect()
        const funders = await fundersFromDatabase(connection)
        if (funders.length > 0) return { funders, source: 'database' }

        console.log('No funders in the database yet (open /admin/funders once to seed them) — falling back to the built-in registry.')
        return { funders: fundersFromRegistry(), source: 'registry' }
    } catch (error) {
        if (error?.code !== '42P01') throw error
        console.log('The funders table does not exist yet (open /admin/funders once to create and seed it) — falling back to the built-in registry.')
        return { funders: fundersFromRegistry(), source: 'registry' }
    }
}

async function recordResults(results) {
    const writable = results.filter((result) => result.documentId)
    for (const result of writable) {
        await connection.query(
            `UPDATE funder_documents
                SET link_status = $2, http_status = $3, link_checked_at = $4
              WHERE id = $1`,
            [result.documentId, result.status, result.httpStatus, result.checkedAt]
        )
    }
    return writable.length
}

async function main() {
    const loaded = await loadFunders()
    const source = loaded.source
    let funders = loaded.funders

    if (args.only.length > 0) {
        funders = funders.filter((funder) => args.only.includes(String(funder.key).toLowerCase()))
    }
    funders = trimToLimit(funders, args.limit)

    const targetCount = funders.reduce((total, funder) => total + (funder.documents || []).length, 0)
    if (targetCount === 0) {
        console.log('Nothing to check.')
        return 0
    }

    console.log(`Checking ${targetCount} link(s) across ${funders.length} funder(s) from the ${source} (concurrency ${args.concurrency}, timeout ${args.timeout}ms)…`)

    const results = await checkFunderLinks({
        funders,
        concurrency: args.concurrency,
        timeoutMs: args.timeout,
    })
    const summary = summarizeLinkCheck(results)

    if (!args.json) {
        for (const result of results) {
            const code = result.httpStatus ? ` ${result.httpStatus}` : ''
            const suffix = result.error
                ? ` — ${result.error}`
                : result.finalUrl && result.status === 'redirect'
                    ? ` → ${result.finalUrl}`
                    : ''
            console.log(`  [${result.status.padEnd(8)}]${code.padStart(5)}  ${result.url}${suffix}`)
        }
        console.log('')
        console.log(describeLinkCheckSummary(summary))
    }

    // Link rot is tracked over time, so every run leaves an audit trail.
    const logDir = path.join(REPO_ROOT, 'local')
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, `funder-link-check-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
    fs.writeFileSync(
        logPath,
        `${results.map((result) => JSON.stringify({ source, ...result })).join('\n')}\n`,
        'utf8'
    )

    let applied = 0
    if (args.apply) {
        if (source !== 'database') {
            console.log('--apply needs database rows; nothing was written (run with a seeded database).')
        } else {
            applied = await recordResults(results)
            console.log(`Recorded ${applied} link status(es).`)
        }
    }

    if (args.json) {
        console.log(JSON.stringify({ source, summary, applied, logPath, results }, null, 2))
    } else {
        console.log(`Log: ${path.relative(REPO_ROOT, logPath)}`)
    }

    return summary.broken > 0 ? 1 : 0
}

let exitCode = 0
try {
    exitCode = await main()
} catch (error) {
    console.error(error?.message || error)
    exitCode = 1
} finally {
    if (connection) await connection.end().catch(() => { })
}

process.exit(exitCode)
