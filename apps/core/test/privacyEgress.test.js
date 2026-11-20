import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

// A static guard on the egress boundary.
//
// The privacy claim is only true while every model call goes through `src/lib/privacy`. This test
// fails when a new feature reaches a vendor directly, which is the failure mode that actually
// happens in practice: someone adds a `fetch` to `/chat/completions` and the review does not catch
// it. It reads source, so it needs no network and no database.

const SOURCE_ROOT = path.resolve(import.meta.dirname, '../src')

// Calls that reach a model vendor.
const VENDOR_MARKERS = [
    '/chat/completions',
    'audio/transcriptions',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
]

// Files allowed to call a vendor without the guard, each with the reason.
const ALLOWED = new Map([
    // The guard itself.
    ['src/lib/privacy/', 'the egress boundary'],
    // Wrappers that build a client or a URL, not a request carrying content.
    ['src/lib/ai/providers.js', 'provider catalogue: base URLs only'],
    ['src/lib/domainAiConfig.js', 'builds the chat-completions URL for callers, sends nothing'],
])

/** Drop comments so a documented endpoint is not mistaken for a request. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

async function listJsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue
            files.push(...await listJsFiles(full))
            continue
        }
        if (!/\.(js|jsx|mjs)$/.test(entry.name)) continue
        files.push(full)
    }
    return files
}

function relative(file) {
    return path.relative(path.dirname(SOURCE_ROOT), file).split(path.sep).join('/')
}

test('every module that talks to a model vendor goes through the privacy guard', async () => {
    const offenders = []

    for (const file of await listJsFiles(SOURCE_ROOT)) {
        const source = stripComments(await readFile(file, 'utf8'))
        const hits = VENDOR_MARKERS.filter((marker) => source.includes(marker))
        if (hits.length === 0) continue

        const name = relative(file)
        if ([...ALLOWED.keys()].some((allowed) => name.startsWith(allowed))) continue
        // Either the guard, or the redactor the FCA section writers call directly.
        if (source.includes('guardOutgoingChat')
            || source.includes('guardOutgoingText')
            || source.includes('deidentifyLlmText')) continue

        offenders.push(`${name} (${hits.join(', ')})`)
    }

    assert.deepEqual(
        offenders,
        [],
        'These modules call a model vendor without the privacy guard. Route the request through '
        + 'src/lib/privacy/egress.js so patient data cannot leave unredacted.'
    )
})

test('no module sends a patient name to a model as a literal prompt prefix', async () => {
    // The original leak shape: `content: \`Patient: ${patientName}\`` in a message. A document
    // header written locally is fine - it never leaves - so only message content is checked.
    const offenders = []

    for (const file of await listJsFiles(SOURCE_ROOT)) {
        const source = stripComments(await readFile(file, 'utf8'))
        // Only files that actually call a model: the same template literal is legitimate in a
        // display component or an email subject.
        const callsModel = source.includes('/chat/completions')
            || source.includes('generateChat')
            || source.includes('streamText')
            || source.includes('generateText')
        if (!callsModel) continue
        if (/content:\s*[`'"](?:Patient|Participant):\s*\$\{/.test(source)) {
            offenders.push(relative(file))
        }
    }

    assert.deepEqual(offenders, [], 'A patient name is interpolated straight into a prompt.')
})
