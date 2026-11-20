import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPostgresClientConfig } from '../src/database.js'

test('enables TLS for a hosted pooler and decodes the login role', () => {
    const config = buildPostgresClientConfig(
        'postgresql://worker.abcdefgh:p%40ss%25word@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
    )

    assert.equal(config.host, 'aws-0-ap-southeast-2.pooler.supabase.com')
    assert.equal(config.port, 5432)
    assert.equal(config.database, 'postgres')
    assert.equal(config.user, 'worker.abcdefgh')
    assert.equal(config.password, 'p@ss%word')
    assert.deepEqual(config.ssl, { rejectUnauthorized: false })
})

test('enables TLS for a direct hosted connection', () => {
    const config = buildPostgresClientConfig('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')

    assert.deepEqual(config.ssl, { rejectUnauthorized: false })
})

test('leaves local databases unencrypted', () => {
    for (const host of ['localhost', '127.0.0.1']) {
        const config = buildPostgresClientConfig(`postgresql://postgres:pw@${host}:5432/example`)
        assert.equal(config.ssl, undefined, host)
    }
})

test('treats the Docker host gateway as local', () => {
    const config = buildPostgresClientConfig('postgresql://postgres:pw@host.docker.internal:5432/example')

    assert.equal(config.ssl, undefined)
    assert.equal(config.database, 'example')
})

test('honours sslmode=disable for a local server on another host', () => {
    const config = buildPostgresClientConfig('postgresql://postgres:pw@192.168.1.50:5432/example?sslmode=disable')

    assert.equal(config.ssl, undefined)
})

test('defaults the database to postgres when the URL has no path', () => {
    const config = buildPostgresClientConfig('postgresql://postgres:pw@db.abcdefgh.supabase.co')

    assert.equal(config.database, 'postgres')
    assert.equal(config.port, 5432)
})

test('passes an unencoded percent sign through without throwing', () => {
    const config = buildPostgresClientConfig('postgresql://postgres:100%pw@db.abcdefgh.supabase.co:5432/postgres')

    assert.equal(config.password, '100%pw')
    assert.deepEqual(config.ssl, { rejectUnauthorized: false })
})

test('normalises a pg connection string the way pg itself would', async () => {
    const ConnectionParameters = (await import('pg/lib/connection-parameters.js')).default
    const url = 'postgresql://worker.abcdefgh:p%40ss%25word@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
    const expected = new ConnectionParameters({ connectionString: url })
    const config = buildPostgresClientConfig(url)

    assert.equal(config.user, expected.user)
    assert.equal(config.password, expected.password)
    assert.equal(config.database, expected.database)
    assert.equal(config.host, expected.host)
    assert.equal(config.port, expected.port)
})
