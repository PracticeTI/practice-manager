// Repairs directory descriptions written before the descriptions had a first-party voice
// rule. Enrichment reads each practice's own website, and the model carried that provenance
// into the published prose — "The site says ...", "The site also lists ...", "X describes
// itself as ..." — which reads as second-hand and exposes the research process to readers.
//
// The rewrite itself lives in src/lib/descriptionTone.js, the same function the enrichment
// scripts now apply to model output before it is written. This script only exists to repair
// records created before that rule.
//
// Dry run by default. Rows whose rewrite still credits a source are reported and never
// written, so a description is either first-party or untouched.
//
// Usage:
//   node scripts/fix-provider-descriptions-tone.mjs                      # providers, dry run
//   node scripts/fix-provider-descriptions-tone.mjs --apply              # providers, write
//   node scripts/fix-provider-descriptions-tone.mjs --table suppliers --apply
//
// Config comes from .env.local. The admin API is reached on http://localhost:3000 with the
// local dev superadmin bypass token.

import fs from 'node:fs'
import path from 'node:path'
import { rewriteDescriptionTone } from '../src/lib/descriptionTone.js'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function loadEnv() {
    for (const file of ['.env.local', '.env']) {
        const filePath = path.join(ROOT, file)
        if (!fs.existsSync(filePath)) continue
        for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
            if (!match || process.env[match[1]] !== undefined) continue
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
        }
    }
}
loadEnv()

const BASE_URL = process.env.ENRICH_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.ENRICH_TOKEN || 'localhost-dev-admin-bypass-token'

const args = process.argv.slice(2)
const flagValue = (name, fallback) => {
    const index = args.indexOf(name)
    return index === -1 ? fallback : args[index + 1]
}
const APPLY = args.includes('--apply')

// The two public directories share this defect class but not their tables or routes.
const DIRECTORIES = {
    providers: { reviewPath: '/api/providers/review', patchPath: (id) => `/api/providers/${id}`, labelField: 'provider', collection: 'providers' },
    suppliers: { reviewPath: '/api/equipment/review', patchPath: (id) => `/api/equipment/${id}`, labelField: 'supplier', collection: 'suppliers' },
}

const TABLE = String(flagValue('--table', 'providers')).trim().toLowerCase()
const DIRECTORY = DIRECTORIES[TABLE]
if (!DIRECTORY) {
    console.error(`Unknown --table "${TABLE}". Expected one of: ${Object.keys(DIRECTORIES).join(', ')}`)
    process.exit(1)
}

const LOG_FILE = path.join(ROOT, 'local', `description-tone-${TABLE}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
        },
    })
    let data = null
    try {
        data = await response.json()
    } catch {
        // Non-JSON error bodies are surfaced through the status code below.
    }
    return { response, data }
}

// updateProvider/updateEquipment are full-record replaces, so the whole record goes back.
function writablePayload(record) {
    const payload = { ...record }
    for (const key of ['id', 'favorite_count', 'is_favorite', 'logo_url', 'created_at', 'updated_at']) delete payload[key]
    return payload
}

async function main() {
    const { response: listResponse, data } = await api(DIRECTORY.reviewPath)
    const records = data?.[DIRECTORY.collection]
    if (!listResponse.ok || !Array.isArray(records)) {
        console.error(`Failed to load ${TABLE} from ${BASE_URL}${DIRECTORY.reviewPath}: ${data?.error || `HTTP ${listResponse.status}`}`)
        console.error('Is the dev server running? (npm run dev)')
        process.exit(1)
    }

    console.log(`${APPLY ? 'Repairing' : 'Dry run over'} ${records.length} ${TABLE} -> ${LOG_FILE}`)

    const repaired = []
    const unresolved = []
    let written = 0

    for (const record of records) {
        const before = String(record.description || '')
        const result = rewriteDescriptionTone(before)
        if (!result.changed) continue

        const entry = {
            id: record.id,
            name: record[DIRECTORY.labelField],
            before,
            after: result.text,
            unresolved: result.unresolved,
        }

        if (result.unresolved) {
            // Never publish a description that still credits a website/page.
            unresolved.push(entry)
            fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ...entry, verdict: 'unresolved', applied: false })}\n`)
            continue
        }

        const patch = { ...writablePayload(record), description: result.text }
        if (APPLY) {
            const { response, data: patchData } = await api(DIRECTORY.patchPath(record.id), {
                method: 'PATCH',
                body: JSON.stringify(patch),
            })
            if (!response.ok) {
                entry.patchError = patchData?.error || `HTTP ${response.status}`
                unresolved.push(entry)
                fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ...entry, verdict: 'patch_failed', applied: false })}\n`)
                continue
            }
            written += 1
        }

        repaired.push(entry)
        fs.appendFileSync(LOG_FILE, `${JSON.stringify({ ...entry, verdict: 'repaired', applied: APPLY })}\n`)
        console.log(`  ${record.id} ${record[DIRECTORY.labelField]}\n    - ${before}\n    + ${result.text}`)
    }

    console.log(`\nchanged=${repaired.length + unresolved.length} repaired=${repaired.length} unresolved=${unresolved.length} written=${written}`)
    if (unresolved.length) {
        console.log('Needs a manual rewrite (left untouched):')
        for (const entry of unresolved) console.log(`  ${entry.id} ${entry.name}: ${entry.patchError || entry.after}`)
    }
    if (!APPLY && repaired.length) console.log('\nRe-run with --apply to write these changes.')
}

await main()
