/**
 * Identity-model DDL.
 *
 * `users.id` is the identity. Email addresses, credentials, tokens and provider
 * subjects are attributes of it, so a person can hold more than one address or
 * sign in through more than one provider without changing who they are.
 *
 * The model is additive: nothing reads these tables yet, so it ships on its own.
 * The rules the later auth work depends on are encoded here:
 *
 *   - a `user_emails` row with `verified_at IS NULL` is a pending claim, and the
 *     partial unique index lets it coexist with a live claim on the same address
 *   - only verified addresses are unique, case-insensitively
 *   - retired addresses keep `removed_at` (and their `verified_at`) so the partial
 *     unique index keeps blocking a reassigned mailbox from claiming the account
 *   - `auth_identities` is unique on the provider's stable subject, never on email
 *   - `user_tokens` covers email change, invite, magic link and password reset
 *
 * Placement: the intended homes are `packages/identity` for the model and
 * `packages/db/supabase/migrations` for the migration of record. Both are still
 * placeholders, so this module is the interim home and is shared by the owner pass
 * (`npm run db:prepare`) and `db:init`, the same way `settingsTables.js` is.
 *
 * No imports: unit tested under plain `node --test`.
 */

/** Tables in dependency order; `users` must precede its children. */
export const IDENTITY_TABLES = [
    'users',
    'user_emails',
    'user_credentials',
    'user_tokens',
    'auth_identities',
]

export const IDENTITY_TABLE_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        display_name VARCHAR(255),
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_emails (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        verification_token_hash TEXT,
        verification_expires_at TIMESTAMPTZ,
        removed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_credentials (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose VARCHAR(32) NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS auth_identities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(32) NOT NULL,
        provider_account_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_account_id)
    )`,
]

/**
 * Enable row-level security on every identity table, with no policy yet.
 *
 * This is deliberate and has to be explicit. A table created through
 * `getDatabaseConnection()` gets RLS enabled by the auto-RLS wrapper, while the
 * owner pass in `npm run db:prepare` uses a plain client and would leave it off —
 * so the two documented install paths produced different schemas.
 *
 * Fail closed: the model holds addresses and password hashes, and nothing reads it
 * yet. The issue that adds the first reader adds its policy and grant together, and
 * cannot ship without them, instead of inheriting a table with RLS silently off.
 */
export const IDENTITY_RLS_STATEMENTS = IDENTITY_TABLES.map(
    (table) => `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
)

export const IDENTITY_INDEX_STATEMENTS = [
    // Deliberately no `removed_at IS NULL` in the predicate: a retired address must
    // keep occupying its slot, otherwise a reassigned mailbox could claim an account
    // whose old address was retired.
    `CREATE UNIQUE INDEX IF NOT EXISTS user_emails_verified_address_key
        ON user_emails (lower(address))
        WHERE verified_at IS NOT NULL`,
    // PostgreSQL does not index foreign keys, and every later issue lists an
    // account's addresses, tokens or linked providers by user.
    'CREATE INDEX IF NOT EXISTS user_emails_user_idx ON user_emails (user_id)',
    'CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id)',
    'CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities (user_id)',
]
