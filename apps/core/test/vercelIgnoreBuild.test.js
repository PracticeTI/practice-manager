import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptName = 'check-docs-only-change.mjs'

/** A throwaway git project holding the script; `commit()` stages and commits files on top. */
function createProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-'))
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, 'scripts', scriptName), path.join(root, 'scripts', scriptName))

    const git = (...args) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
    }
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')

    const commit = (files) => {
        for (const [relativePath, contents] of Object.entries(files)) {
            const absolute = path.join(root, relativePath)
            fs.mkdirSync(path.dirname(absolute), { recursive: true })
            fs.writeFileSync(absolute, contents)
        }
        git('add', '-A')
        git('commit', '-q', '-m', 'change')
    }

    return { root, commit }
}

function runScript(root, cwd = root) {
    return spawnSync(process.execPath, [path.join(root, 'scripts', scriptName)], { cwd, encoding: 'utf8' })
}

test('skips the build for a documentation-only commit', () => {
    const project = createProject()
    project.commit({ 'package.json': '{}\n' })
    project.commit({ 'README.md': '# Readme\n', 'docs/roadmap/auth.md': '# Auth\n' })

    const result = runScript(project.root)

    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /skipping build/)
})

test('builds when the commit also changes the app', () => {
    const project = createProject()
    project.commit({ 'package.json': '{}\n' })
    project.commit({ 'docs/roadmap/auth.md': '# Auth\n', 'apps/core/package.json': '{}\n' })

    const result = runScript(project.root)

    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /apps\/core\/package\.json/)
})

test('builds on a workspace package change even from the app directory', () => {
    const project = createProject()
    project.commit({ 'package.json': '{}\n' })
    project.commit({ 'packages/ai/src/index.js': 'export {}\n' })
    // Vercel runs the command from the project's root directory, one level below the repository.
    const appRoot = path.join(project.root, 'apps/core')
    fs.mkdirSync(appRoot, { recursive: true })

    const result = runScript(project.root, appRoot)

    assert.equal(result.status, 1, result.stdout + result.stderr)
})

test('builds when there is no parent commit to diff against', () => {
    const project = createProject()
    project.commit({ 'docs/roadmap/auth.md': '# Auth\n' })

    const result = runScript(project.root)

    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /no parent commit/)
})
