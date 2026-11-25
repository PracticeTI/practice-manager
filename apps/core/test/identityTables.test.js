import test from 'node:test'
import assert from 'node:assert/strict'

import { IDENTITY_TABLES } from '../src/lib/identitySchema.js'
import { ensureIdentityTables } from '../src/lib/identityTables.js'

/** A connection that records statements and answers the existence probe. */
function fakeConnection({ present = false, refuseIndex = false } = {}) {
    const statements = []
    return {
        statements,
        async query(sql) {
            statements.push(sql)
            if (sql.includes('to_regclass')) {
                return { rows: present ? [] : IDENTITY_TABLES.map((name) => ({ name })) }
            }
            if (refuseIndex && /CREATE (UNIQUE )?INDEX/.test(sql)) {
                const error = new Error('must be owner of table user_emails')
                error.code = '42501'
                throw error
            }
            return { rows: [], rowCount: 0 }
        },
    }
}

const ddlCount = (connection) => connection.statements.filter((sql) => !sql.includes('to_regclass')).length

test('a provisioned database issues no DDL', async () => {
    const connection = fakeConnection({ present: true })

    assert.deepEqual(await ensureIdentityTables(connection), [])
    assert.equal(ddlCount(connection), 0)
})

test('creates every table, index and RLS switch when the model is missing', async () => {
    const connection = fakeConnection({ present: false })

    assert.deepEqual(await ensureIdentityTables(connection), IDENTITY_TABLES)
    assert.equal(ddlCount(connection), IDENTITY_TABLES.length + 4 + IDENTITY_TABLES.length)

    // RLS is switched on explicitly, so the runtime and `db:prepare` agree even
    // though the wrapped client would have enabled it as a side effect.
    for (const table of IDENTITY_TABLES) {
        assert.ok(
            connection.statements.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
            `${table} is switched to fail closed`
        )
    }
})

test('an index the runtime role cannot create is skipped, not thrown', async () => {
    const connection = fakeConnection({ present: false, refuseIndex: true })

    assert.deepEqual(await ensureIdentityTables(connection), IDENTITY_TABLES)
})

test('refuses a caller that forgot the connection', async () => {
    await assert.rejects(() => ensureIdentityTables(null), /requires a database connection/)
})
