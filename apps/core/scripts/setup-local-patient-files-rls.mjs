import pg from 'pg'

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
const runtimeRole = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || 'practice_manager_app').trim()

if (!connectionString) throw new Error('DATABASE_URL or POSTGRES_URL is required')
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(runtimeRole)) {
    throw new Error('POSTGRES_RLS_RUNTIME_ROLE must be a valid PostgreSQL role name')
}

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`
}

const hostname = new URL(connectionString).hostname
const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(hostname)
if (!isLocal) throw new Error('This setup script only runs against local PostgreSQL')

const client = new pg.Client({ connectionString })
await client.connect()

try {
    const currentUserResult = await client.query('SELECT current_user')
    const currentUser = currentUserResult.rows?.[0]?.current_user
    const quotedRuntimeRole = quoteIdentifier(runtimeRole)
    const quotedCurrentUser = quoteIdentifier(currentUser)

    await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
        CREATE ROLE ${quotedRuntimeRole}
          NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $$
  `)
    await client.query(`GRANT ${quotedRuntimeRole} TO ${quotedCurrentUser}`)
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedRuntimeRole}`)
    await client.query(`GRANT SELECT ON patients TO ${quotedRuntimeRole}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON patient_files TO ${quotedRuntimeRole}`)
    await client.query(`GRANT USAGE, SELECT ON SEQUENCE patient_files_id_seq TO ${quotedRuntimeRole}`)

    await client.query('ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY')
    await client.query('ALTER TABLE patient_files FORCE ROW LEVEL SECURITY')
    await client.query('DROP POLICY IF EXISTS dev_allow_all_patient_files ON patient_files')
    await client.query('DROP POLICY IF EXISTS patient_files_domain_policy ON patient_files')
    await client.query(`
    CREATE POLICY patient_files_domain_policy
      ON patient_files
      FOR ALL
      USING (
        current_setting('app.current_role', true) = 'superadmin'
        OR domain = current_setting('app.current_domain', true)
      )
      WITH CHECK (
        current_setting('app.current_role', true) = 'superadmin'
        OR domain = current_setting('app.current_domain', true)
      )
  `)

    console.log(`Configured patient_files RLS with local runtime role ${runtimeRole}.`)
} finally {
    await client.end()
}