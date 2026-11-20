import test from 'node:test'
import assert from 'node:assert/strict'

import { satisfiesRange } from '../src/version.js'
import { describeConnectionString, redactConnectionString, runPreflight } from '../src/preflight.js'
import { provisionDatabase, withDatabaseName } from '../src/setup.js'

const VALID_URL = 'postgresql://practice:secret@localhost:5432/practice_manager'

function fakeClient(handlers) {
    return {
        query: async (sql, params) => handlers(sql, params),
        end: async () => {},
    }
}

test('matches the project engines range', () => {
    assert.equal(satisfiesRange('24.22.0', '>=22.13.0 <23 || >=24'), true)
    assert.equal(satisfiesRange('22.13.0', '>=22.13.0 <23 || >=24'), true)
    assert.equal(satisfiesRange('22.12.9', '>=22.13.0 <23 || >=24'), false)
    assert.equal(satisfiesRange('23.1.0', '>=22.13.0 <23 || >=24'), false)
    assert.equal(satisfiesRange('20.11.0', '>=22.13.0 <23 || >=24'), false)
    // Unparseable input fails rather than passing by default.
    assert.equal(satisfiesRange('not-a-version', '>=22.13.0'), false)
    assert.equal(satisfiesRange('24.0.0', ''), false)
})

test('reads and redacts a connection string', () => {
    const described = describeConnectionString(VALID_URL)
    assert.equal(described.ok, true)
    assert.equal(described.database, 'practice_manager')
    assert.match(described.detail, /practice:\*\*\*@localhost:5432\/practice_manager/)

    assert.equal(redactConnectionString('not a url'), '[invalid connection string]')
    assert.equal(describeConnectionString('').ok, false)
    assert.equal(describeConnectionString('mysql://localhost/app').ok, false)
    assert.equal(describeConnectionString('postgresql://localhost/bad-name').ok, false)
})

test('passes when Node, database and schema are all present', async () => {
    const result = await runPreflight({
        env: { DATABASE_URL: VALID_URL },
        nodeVersion: '24.22.0',
        connect: async () => fakeClient(async (sql) => (sql.includes('to_regclass')
            ? { rows: [{ table_name: 'patients' }] }
            : { rows: [{ ok: 1 }] })),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.checks.map((check) => [check.name, check.ok]), [
        ['Node.js', true],
        ['DATABASE_URL', true],
        ['PostgreSQL', true],
        ['Schema', true],
    ])
})

test('fails with an actionable fix when the schema is missing', async () => {
    const result = await runPreflight({
        env: { DATABASE_URL: VALID_URL },
        nodeVersion: '24.22.0',
        connect: async () => fakeClient(async (sql) => (sql.includes('to_regclass')
            ? { rows: [{ table_name: null }] }
            : { rows: [{ ok: 1 }] })),
    })

    const schema = result.checks.find((check) => check.name === 'Schema')
    assert.equal(result.ok, false)
    assert.equal(schema.ok, false)
    assert.match(schema.fix, /npm run setup/)
})

test('reports an unreachable database without throwing', async () => {
    const result = await runPreflight({
        env: { DATABASE_URL: VALID_URL },
        nodeVersion: '24.22.0',
        connect: async () => { throw new Error('ECONNREFUSED') },
    })

    assert.equal(result.ok, false)
    assert.equal(result.checks.find((check) => check.name === 'PostgreSQL').ok, false)
    assert.equal(result.checks.find((check) => check.name === 'Schema').ok, false)
})

test('blocks connection-dependent checks when DATABASE_URL is unusable', async () => {
    const result = await runPreflight({ env: {}, nodeVersion: '24.22.0', connect: async () => fakeClient() })

    assert.equal(result.ok, false)
    assert.equal(result.checks.length, 4)
    assert.match(result.checks[2].detail, /no usable DATABASE_URL/)
})

test('fails on an unsupported Node version even with a healthy database', async () => {
    const result = await runPreflight({
        env: { DATABASE_URL: VALID_URL },
        nodeVersion: '23.4.0',
        connect: async () => fakeClient(async (sql) => (sql.includes('to_regclass')
            ? { rows: [{ table_name: 'patients' }] }
            : { rows: [{ ok: 1 }] })),
    })

    assert.equal(result.ok, false)
    assert.equal(result.checks[0].ok, false)
})

test('points a connection string at another database on the same server', () => {
    assert.equal(
        withDatabaseName(VALID_URL, 'postgres'),
        'postgresql://practice:secret@localhost:5432/postgres'
    )
})

test('creates a missing database and then applies the schema', async () => {
    const queries = []
    const bootstrapped = []

    const result = await provisionDatabase({
        connectionString: VALID_URL,
        log: () => {},
        connect: async () => fakeClient(async (sql) => {
            queries.push(sql)
            if (sql.startsWith('SELECT 1 FROM pg_database')) return { rowCount: 0 }
            return { rowCount: 1 }
        }),
        runBootstrap: async (connectionString) => { bootstrapped.push(connectionString) },
    })

    assert.deepEqual(result, { database: 'practice_manager', createdDatabase: true, bootstrapped: true })
    assert.ok(queries.some((sql) => sql === 'CREATE DATABASE "practice_manager"'))
    assert.deepEqual(bootstrapped, [VALID_URL])
})

test('leaves an existing database alone', async () => {
    const queries = []
    const result = await provisionDatabase({
        connectionString: VALID_URL,
        log: () => {},
        connect: async () => fakeClient(async (sql) => {
            queries.push(sql)
            return sql.startsWith('SELECT 1 FROM pg_database') ? { rowCount: 1 } : { rowCount: 1 }
        }),
        runBootstrap: async () => {},
    })

    assert.equal(result.createdDatabase, false)
    assert.ok(!queries.some((sql) => sql.startsWith('CREATE DATABASE')))
})

test('refuses an unsafe database name', async () => {
    await assert.rejects(
        () => provisionDatabase({
            connectionString: 'postgresql://localhost/bad%22name',
            log: () => {},
            connect: async () => fakeClient(),
            runBootstrap: async () => {},
        }),
        /not a valid database|invalid database/i
    )
})
