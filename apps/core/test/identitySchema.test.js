import test from 'node:test'
import assert from 'node:assert/strict'

import {
    IDENTITY_INDEX_STATEMENTS,
    IDENTITY_RLS_STATEMENTS,
    IDENTITY_TABLE_STATEMENTS,
    IDENTITY_TABLES,
} from '../src/lib/identitySchema.js'

function tableStatement(table) {
    return IDENTITY_TABLE_STATEMENTS.find((sql) => sql.includes(`IF NOT EXISTS ${table} (`))
}

test('creates every identity table, users first', () => {
    assert.deepEqual(IDENTITY_TABLES, [
        'users',
        'user_emails',
        'user_credentials',
        'user_tokens',
        'auth_identities',
    ])
    assert.equal(IDENTITY_TABLE_STATEMENTS.length, IDENTITY_TABLES.length)

    IDENTITY_TABLE_STATEMENTS.forEach((sql, index) => {
        assert.match(sql, /CREATE TABLE IF NOT EXISTS/, `${IDENTITY_TABLES[index]} is idempotent`)
        assert.ok(sql.includes(`IF NOT EXISTS ${IDENTITY_TABLES[index]} (`), `${IDENTITY_TABLES[index]} matches its name`)
    })

    assert.equal(IDENTITY_TABLE_STATEMENTS[0], tableStatement('users'), 'users is created before its children')
})

test('every attribute row points at users.id and is removed with the user', () => {
    for (const table of ['user_emails', 'user_credentials', 'user_tokens', 'auth_identities']) {
        assert.match(
            tableStatement(table),
            /user_id UUID (?:PRIMARY KEY |NOT NULL )*REFERENCES users\(id\) ON DELETE CASCADE/,
            `${table} is owned by users.id`
        )
    }
})

test('only verified addresses are unique, case-insensitively', () => {
    const index = IDENTITY_INDEX_STATEMENTS.find((sql) => sql.includes('user_emails_verified_address_key'))

    assert.ok(index, 'the verified-address index exists')
    assert.match(index, /ON user_emails \(lower\(address\)\)/)
    assert.match(index, /WHERE verified_at IS NOT NULL/)
    assert.doesNotMatch(index, /removed_at IS NULL/, 'a retired address keeps blocking the address')
})

test('federated identities are unique on the provider subject', () => {
    const sql = tableStatement('auth_identities')

    assert.match(sql, /UNIQUE \(provider, provider_account_id\)/)
    assert.doesNotMatch(sql, /email/i, 'a provider identity never links on email')
})

test('every table enables RLS without a policy until a reader arrives', () => {
    assert.equal(IDENTITY_RLS_STATEMENTS.length, IDENTITY_TABLES.length)

    for (const table of IDENTITY_TABLES) {
        assert.ok(
            IDENTITY_RLS_STATEMENTS.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
            `${table} fails closed`
        )
    }

    // The model is deliberately absent from the policy set: it is not tenant-scoped
    // and has no reader yet.
    assert.ok(!IDENTITY_RLS_STATEMENTS.some((sql) => sql.includes('CREATE POLICY')))
})
