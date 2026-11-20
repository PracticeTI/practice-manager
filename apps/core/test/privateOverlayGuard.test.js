import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const guardSources = ['check-private-files.mjs', 'private-overlay-paths.mjs'].map((name) =>
    path.join(repoRoot, 'scripts', name)
)

/** A throwaway git project holding a copy of the guard, an ignore list and an overlay tree. */
function createProject({ ignore = [], overlayFiles = [] } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-guard-'))
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    for (const source of guardSources) {
        fs.copyFileSync(source, path.join(root, 'scripts', path.basename(source)))
    }
    fs.writeFileSync(path.join(root, '.gitignore'), `${ignore.join('\n')}\n`)

    for (const relativePath of overlayFiles) {
        const absolute = path.join(root, 'src/private/overlay', relativePath)
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        fs.writeFileSync(absolute, 'png\n')
    }

    spawnSync('git', ['init', '-q'], { cwd: root })
    return root
}

function runGuard(root, args = []) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-private-files.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('passes when the ignore list covers every path the overlay writes', () => {
    const root = createProject({
        ignore: ['public/acme/'],
        overlayFiles: ['public/acme/logo.png'],
    })

    const guard = runGuard(root)

    assert.equal(guard.status, 0, guard.stderr)
})

test('fails on an overlay folder the ignore list does not cover', () => {
    const root = createProject({
        ignore: ['public/acme/'],
        overlayFiles: ['public/acme/logo.png', 'docs/acme/brief.md'],
    })

    const guard = runGuard(root)

    assert.equal(guard.status, 1)
    assert.match(guard.stderr, /docs\/acme\/brief\.md is written by the private overlay/)
    assert.doesNotMatch(guard.stderr, /public\/acme\/logo\.png/)
})

test('fails on a tracked file the ignore list excludes', () => {
    const root = createProject({ ignore: ['public/acme/'] })
    fs.mkdirSync(path.join(root, 'public/acme'), { recursive: true })
    fs.writeFileSync(path.join(root, 'public/acme/logo.png'), 'png\n')
    spawnSync('git', ['add', '-f', 'public/acme/logo.png'], { cwd: root })

    const guard = runGuard(root)

    assert.equal(guard.status, 1)
    assert.match(guard.stderr, /public\/acme\/logo\.png is tracked but ignored/)
})
