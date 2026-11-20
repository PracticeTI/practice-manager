import test from 'node:test'
import assert from 'node:assert/strict'

import { withPostgresRlsContext } from '../src/lib/postgresRlsContext.js'

test('runs an operation with transaction-local RLS context', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousRuntimeRole = process.env.POSTGRES_RLS_RUNTIME_ROLE
    process.env.NODE_ENV = 'test'
    process.env.POSTGRES_RLS_RUNTIME_ROLE = 'practice_manager_app'

    const queries = []
    const connection = {
        async query(sql, values) {
            queries.push({ sql, values })
            return { rows: [] }
        },
    }

    try {
        const result = await withPostgresRlsContext(
            connection,
            { domain: ' Domain-A ', role: 'admin' },
            async () => 'complete'
        )

        assert.equal(result, 'complete')
        assert.deepEqual(queries, [
            { sql: 'BEGIN', values: undefined },
            { sql: 'SET LOCAL ROLE "practice_manager_app"', values: undefined },
            {
                sql: `SELECT set_config('app.current_domain', $1, true),
              set_config('app.current_role', $2, true),
              set_config('app.current_username', $3, true)`,
                values: ['domain-a', 'admin', ''],
            },
            { sql: 'COMMIT', values: undefined },
        ])
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previousNodeEnv
        if (previousRuntimeRole === undefined) delete process.env.POSTGRES_RLS_RUNTIME_ROLE
        else process.env.POSTGRES_RLS_RUNTIME_ROLE = previousRuntimeRole
    }
})

test('rolls back when the operation fails', async () => {
    const previousRuntimeRole = process.env.POSTGRES_RLS_RUNTIME_ROLE
    process.env.POSTGRES_RLS_RUNTIME_ROLE = ''
    const queries = []
    const connection = {
        async query(sql) {
            queries.push(sql)
            return { rows: [] }
        },
    }

    try {
        await assert.rejects(
            withPostgresRlsContext(connection, { domain: 'example', role: 'admin' }, async () => {
                throw new Error('failed')
            }),
            /failed/
        )
        assert.equal(queries.at(-1), 'ROLLBACK')
    } finally {
        if (previousRuntimeRole === undefined) delete process.env.POSTGRES_RLS_RUNTIME_ROLE
        else process.env.POSTGRES_RLS_RUNTIME_ROLE = previousRuntimeRole
    }
})