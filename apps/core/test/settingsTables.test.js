import test from 'node:test'
import assert from 'node:assert/strict'

import { createSettingsTablesProbe, SETTINGS_TABLES } from '../src/lib/settingsTables.js'

/** A connection that records every statement and answers the existence probe. */
function fakeConnection({ present = false, failDdl = false, failProbe = false } = {}) {
    const statements = []
    return {
        statements,
        async query(sql) {
            statements.push(sql)
            if (sql.includes('to_regclass')) {
                if (failProbe) throw new Error('catalog unavailable')
                return {
                    rows: [Object.fromEntries(SETTINGS_TABLES.map((table) => [table, present]))],
                }
            }
            if (failDdl) throw new Error('permission denied for schema public')
            return { rows: [], rowCount: 0 }
        },
    }
}

function silentLogger() {
    const warnings = []
    return { warnings, warn: (message) => warnings.push(message) }
}

const ddlCount = (connection) => connection.statements.filter((sql) => !sql.includes('to_regclass')).length

test('probes a present pair of tables without issuing DDL', async () => {
    const connection = fakeConnection({ present: true })
    const probe = createSettingsTablesProbe({ logger: silentLogger() })

    assert.equal(await probe.ensure(connection), true)
    assert.equal(ddlCount(connection), 0)
    assert.equal(probe.isPresent(), true)
})

test('creates the tables when they are missing', async () => {
    const connection = fakeConnection({ present: false })
    const probe = createSettingsTablesProbe({ logger: silentLogger() })

    assert.equal(await probe.ensure(connection), true)
    assert.equal(ddlCount(connection), 4)
    assert.equal(probe.isPresent(), true)
})

test('caches a positive result so a warm process issues no further queries', async () => {
    const connection = fakeConnection({ present: true })
    const probe = createSettingsTablesProbe({ logger: silentLogger() })

    await probe.ensure(connection)
    const afterFirst = connection.statements.length

    assert.equal(await probe.ensure(connection), true)
    assert.equal(connection.statements.length, afterFirst)
})

test('retries a missing table instead of caching the failure', async () => {
    const connection = fakeConnection({ present: false, failDdl: true })
    const logger = silentLogger()
    const probe = createSettingsTablesProbe({ logger })

    assert.equal(await probe.ensure(connection), false)
    assert.equal(probe.isPresent(), false)
    assert.equal(logger.warnings.length, 1)

    // A later run in the same process re-probes, so db:prepare fixes it live.
    assert.equal(await probe.ensure(connection), false)
    assert.equal(logger.warnings.length, 1, 'warns once, not once per request')
})

test('treats an unreadable catalog as missing and reports the DDL failure once', async () => {
    const connection = fakeConnection({ present: false, failProbe: true, failDdl: true })
    const logger = silentLogger()
    const probe = createSettingsTablesProbe({ logger })

    assert.equal(await probe.ensure(connection), false)
    assert.equal(logger.warnings.length, 1)
    assert.match(logger.warnings[0], /db:prepare/)
})

test('rejects a caller that forgot the connection', async () => {
    const probe = createSettingsTablesProbe({ logger: silentLogger() })
    await assert.rejects(() => probe.ensure(null), /connection is required/)
})

test('reset clears cached state', async () => {
    const connection = fakeConnection({ present: true })
    const probe = createSettingsTablesProbe({ logger: silentLogger() })

    await probe.ensure(connection)
    probe.reset()

    assert.equal(probe.isPresent(), false)
    const afterFirst = connection.statements.length
    await probe.ensure(connection)
    assert.ok(connection.statements.length > afterFirst, 'probes again after reset')
})

test('shares one DDL run between concurrent first requests', async () => {
    const connection = fakeConnection({ present: false })
    const probe = createSettingsTablesProbe({ logger: silentLogger() })

    const results = await Promise.all([
        probe.ensure(connection),
        probe.ensure(connection),
        probe.ensure(connection),
    ])

    assert.deepEqual(results, [true, true, true])
    assert.equal(ddlCount(connection), 4, 'creates the tables once, not once per caller')
})

test('treats a duplicate-object error as another process winning the race', async () => {
    let attempts = 0
    const statements = []
    const connection = {
        async query(sql) {
            statements.push(sql)
            if (sql.includes('to_regclass')) {
                // Missing on the first probe, present after the DDL attempt.
                const present = attempts > 0
                return { rows: [Object.fromEntries(SETTINGS_TABLES.map((table) => [table, present]))] }
            }
            attempts += 1
            throw new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"')
        },
    }
    const logger = silentLogger()
    const probe = createSettingsTablesProbe({ logger })

    assert.equal(await probe.ensure(connection), true)
    assert.equal(logger.warnings.length, 0)
})
