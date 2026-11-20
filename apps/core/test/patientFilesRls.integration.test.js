import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL

function buildConfig() {
    const hostname = new URL(connectionString).hostname
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(hostname)
    return {
        connectionString,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
    }
}

test('patient_files isolates admins by domain and permits superadmin access', {
    skip: !connectionString,
}, async () => {
    const client = new pg.Client(buildConfig())
    const domains = ['__rls_test_a__', '__rls_test_b__']
    await client.connect()

    try {
        await client.query('DELETE FROM patient_files WHERE domain = ANY($1::text[])', [domains])
        await client.query(
            `INSERT INTO patient_files (domain, patient_id, file_name, mime_type, file_size, file_data)
       VALUES ($1, 1, 'a', 'text/plain', 1, $3),
              ($2, 1, 'b', 'text/plain', 1, $4)`,
            [...domains, Buffer.from('a'), Buffer.from('b')]
        )

        await client.query('BEGIN')
        await client.query('SET LOCAL ROLE practice_manager_app')
        await client.query(
            `SELECT set_config('app.current_domain', $1, true),
              set_config('app.current_role', 'admin', true)`,
            [domains[0]]
        )
        const adminResult = await client.query(
            'SELECT domain FROM patient_files WHERE domain = ANY($1::text[]) ORDER BY domain',
            [domains]
        )
        assert.deepEqual(adminResult.rows, [{ domain: domains[0] }])

        await assert.rejects(
            client.query(
                `INSERT INTO patient_files (domain, patient_id, file_name, mime_type, file_size, file_data)
         VALUES ($1, 1, 'blocked', 'text/plain', 1, $2)`,
                [domains[1], Buffer.from('x')]
            ),
            (error) => error?.code === '42501'
        )
        await client.query('ROLLBACK')

        await client.query('BEGIN')
        await client.query('SET LOCAL ROLE practice_manager_app')
        await client.query(
            `SELECT set_config('app.current_domain', $1, true),
              set_config('app.current_role', 'superadmin', true)`,
            [domains[0]]
        )
        const superadminResult = await client.query(
            'SELECT domain FROM patient_files WHERE domain = ANY($1::text[]) ORDER BY domain',
            [domains]
        )
        assert.deepEqual(superadminResult.rows, domains.map((domain) => ({ domain })))
        await client.query('COMMIT')
    } finally {
        await client.query('ROLLBACK').catch(() => { })
        await client.query('DELETE FROM patient_files WHERE domain = ANY($1::text[])', [domains]).catch(() => { })
        await client.end()
    }
})