import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { listMigrations, migrationDirectoryCandidates, resolveMigrationsDir } from '../src/lib/migrations.js'

function tempDir(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-migrations-'))
    for (const [name, contents] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), contents)
    }
    return dir
}

test('lists versioned SQL files in order and ignores everything else', () => {
    const dir = tempDir({
        '20260101000000_first.sql': 'select 1;',
        '20260301000000_second.sql': 'select 2;',
        '20260201000000_middle.sql': 'select 3;',
        '.gitkeep': '',
        'notes.md': 'not a migration',
        '2026_short.sql': 'not a migration',
    })

    assert.deepEqual(
        listMigrations(dir).map((migration) => migration.name),
        ['20260101000000_first.sql', '20260201000000_middle.sql', '20260301000000_second.sql']
    )
})

test('refuses two files that share a version', () => {
    const dir = tempDir({
        '20260101000000_a.sql': 'select 1;',
        '20260101000000_b.sql': 'select 2;',
    })

    assert.throws(() => listMigrations(dir), /Duplicate migration version 20260101000000/)
})

test('DB_MIGRATIONS_DIR wins over the repository layout', () => {
    const dir = tempDir({ '20260101000000_only.sql': 'select 1;' })
    const resolved = resolveMigrationsDir({ cwd: os.tmpdir(), env: { DB_MIGRATIONS_DIR: dir } })

    assert.equal(resolved, path.resolve(dir))
    assert.equal(migrationDirectoryCandidates({ cwd: os.tmpdir(), env: { DB_MIGRATIONS_DIR: dir } })[0], path.resolve(dir))
})

test('finds the repository migrations from the repo root', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const resolved = resolveMigrationsDir({ cwd: repoRoot, env: {} })

    assert.equal(resolved, path.join(repoRoot, 'packages', 'db', 'supabase', 'migrations'))
    assert.ok(listMigrations(resolved).length >= 1)
})
