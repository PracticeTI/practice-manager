import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** The sync script plus the module it shares with the overlay guard. */
const scriptSources = ['sync-private-overlay.mjs', 'private-overlay-paths.mjs'].map((name) =>
    path.join(repoRoot, 'scripts', name)
)

/** A throwaway project whose scripts/ holds a copy of the real sync script. */
function createProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-overlay-'))
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    for (const scriptSource of scriptSources) {
        fs.copyFileSync(scriptSource, path.join(root, 'scripts', path.basename(scriptSource)))
    }
    return root
}

function writeOverlayTree(overlayRoot) {
    fs.mkdirSync(path.join(overlayRoot, 'lib'), { recursive: true })
    fs.mkdirSync(path.join(overlayRoot, 'app/acme'), { recursive: true })
    fs.mkdirSync(path.join(overlayRoot, 'public/acme'), { recursive: true })
    fs.writeFileSync(
        path.join(overlayRoot, 'lib/privateDomains.data.js'),
        "export const PRIVATE_DOMAINS = [{ key: 'acme', label: 'Acme' }]\n"
    )
    fs.writeFileSync(path.join(overlayRoot, 'lib/landings.json'), '{"acme":"@/components/AcmeLanding"}\n')
    fs.writeFileSync(path.join(overlayRoot, 'app/acme/page.jsx'), 'export default function Page() { return null }\n')
    fs.writeFileSync(path.join(overlayRoot, 'public/acme/logo.png'), 'png\n')
}

function runScript(root, args = [], env = {}) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/sync-private-overlay.mjs'), ...args], {
        cwd: root,
        env: { ...process.env, PRIVATE_OVERLAY_REQUIRED: '', ...env },
        encoding: 'utf8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('mounts the submodule overlay and generates both bridge modules', () => {
    const root = createProject()
    writeOverlayTree(path.join(root, 'src/private/overlay'))

    const { status, stdout } = runScript(root)

    assert.equal(status, 0, stdout)
    const registry = fs.readFileSync(path.join(root, 'src/lib/privateDomains.js'), 'utf8')
    assert.match(registry, /from '\.\/privateDomains\.data\.js'/)
    assert.match(registry, /export const PRIVATE_DOMAINS = /)
    assert.match(registry, /export const PRIVATE_PUBLIC_API_ROUTES = /)
    assert.match(
        fs.readFileSync(path.join(root, 'src/components/privateLandings.jsx'), 'utf8'),
        /"acme": \(\) => import\('@\/components\/AcmeLanding'\)/
    )
    assert.equal(fs.readFileSync(path.join(root, 'src/app/acme/page.jsx'), 'utf8').trim(), 'export default function Page() { return null }')
    assert.equal(fs.readFileSync(path.join(root, 'public/acme/logo.png'), 'utf8').trim(), 'png')

    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.private-overlay.json'), 'utf8'))
    assert.ok(manifest.files.includes('src/app/acme/page.jsx'))
})

test('writes empty stubs when no overlay source is available', () => {
    const root = createProject()

    const { status, stdout } = runScript(root)

    assert.equal(status, 0, stdout)
    assert.match(fs.readFileSync(path.join(root, 'src/lib/privateDomains.js'), 'utf8'), /export const PRIVATE_DOMAINS = \[\]/)
    assert.match(
        fs.readFileSync(path.join(root, 'src/components/privateLandings.jsx'), 'utf8'),
        /export const PRIVATE_LANDING_COMPONENTS = \{\}/
    )
    // globals.css imports this file, so every mode has to write it.
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/app/private-overlay-sources.css'), 'utf8'), /@source/)
})

test('registers mounted overlay markup as Tailwind sources', () => {
    const root = createProject()
    writeOverlayTree(path.join(root, 'src/private/overlay'))

    const { status, stdout } = runScript(root)

    assert.equal(status, 0, stdout)
    const sources = fs.readFileSync(path.join(root, 'src/app/private-overlay-sources.css'), 'utf8')
    // The copies are gitignored, so Tailwind only sees them through an explicit @source.
    assert.match(sources, /^@source "\.\/acme\/page\.jsx";$/m)
    assert.doesNotMatch(sources, /logo\.png|landings\.json/)
})

test('refuses to build silently without an overlay when PRIVATE_OVERLAY_REQUIRED is set', () => {
    const root = createProject()

    const { status, stderr } = runScript(root, [], { PRIVATE_OVERLAY_REQUIRED: '1' })

    assert.equal(status, 1)
    assert.match(stderr, /PRIVATE_OVERLAY_REQUIRED/)
    assert.equal(fs.existsSync(path.join(root, 'src/lib/privateDomains.js')), false)
})

test('mounts an overlay supplied through PRIVATE_OVERLAY_DIR', () => {
    const root = createProject()
    const suppliedOverlay = path.join(root, 'supplied-overlay')
    writeOverlayTree(suppliedOverlay)

    const { status, stdout } = runScript(root, [], {
        PRIVATE_OVERLAY_DIR: suppliedOverlay,
        PRIVATE_OVERLAY_REQUIRED: '1',
    })

    assert.equal(status, 0, stdout)
    assert.match(fs.readFileSync(path.join(root, 'src/lib/privateDomains.js'), 'utf8'), /privateDomains\.data\.js/)
    assert.equal(fs.existsSync(path.join(root, 'src/app/acme/page.jsx')), true)
})

test('fails when PRIVATE_OVERLAY_DIR points at a missing directory', () => {
    const root = createProject()

    const { status, stderr } = runScript(root, [], { PRIVATE_OVERLAY_DIR: 'does-not-exist' })

    assert.equal(status, 1)
    assert.match(stderr, /PRIVATE_OVERLAY_DIR/)
})

test('--clean removes the mounted overlay and regenerates empty stubs', () => {
    const root = createProject()
    writeOverlayTree(path.join(root, 'src/private/overlay'))
    assert.equal(runScript(root).status, 0)

    const { status, stdout } = runScript(root, ['--clean'])

    assert.equal(status, 0, stdout)
    assert.equal(fs.existsSync(path.join(root, 'src/app/acme/page.jsx')), false)
    assert.equal(fs.existsSync(path.join(root, 'public/acme/logo.png')), false)
    assert.equal(fs.existsSync(path.join(root, 'src/lib/privateDomains.data.js')), false)
    assert.equal(fs.existsSync(path.join(root, '.private-overlay.json')), false)
    assert.match(fs.readFileSync(path.join(root, 'src/lib/privateDomains.js'), 'utf8'), /export const PRIVATE_DOMAINS = \[\]/)

    assert.equal(runScript(root, ['--check']).status, 0)
})

test('--check fails while overlay files remain in the tree', () => {
    const root = createProject()
    writeOverlayTree(path.join(root, 'src/private/overlay'))
    assert.equal(runScript(root).status, 0)

    const { status, stdout } = runScript(root, ['--check'])

    assert.equal(status, 1)
    assert.match(stdout, /private overlay files/)
})
