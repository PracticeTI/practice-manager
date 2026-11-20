/**
 * Database configuration utilities (domain backend)
 */

// Hosts that serve plaintext Postgres. `host.docker.internal` is how a container
// reaches the host machine, where the dev database runs without TLS.
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal', ''])

function decodeUrlCredential(value) {
    if (!value) return ''
    try {
        return decodeURIComponent(value)
    } catch {
        // A raw '%' that is not valid encoding: pass it through unchanged rather
        // than failing every connection.
        return value
    }
}

/**
 * Build a `pg` client config from a connection URL.
 *
 * `pg` defaults to `ssl: false` and has no libpq-style "prefer" mode, so a remote
 * host connects in plaintext unless TLS is set here. Every hosted database this
 * service talks to is remote, so encryption is the default and `?sslmode=disable`
 * is the explicit opt-out for a local server on another host.
 *
 * `rejectUnauthorized: false` matches the rest of the project: the hosted pooler
 * presents a chain node-postgres will not verify.
 */
export function buildPostgresClientConfig(connectionString) {
    const url = new URL(connectionString)
    const isLocal = LOCAL_DATABASE_HOSTS.has(url.hostname)
    const sslDisabled = url.searchParams.get('sslmode') === 'disable'

    return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 5432,
        database: decodeUrlCredential(url.pathname.slice(1)) || 'postgres',
        // `new URL()` leaves these percent-encoded, and `pg` decodes the ones it
        // parses itself; passing them raw fails auth for a password with `@`, `%`
        // or `:` in it.
        user: decodeUrlCredential(url.username),
        password: decodeUrlCredential(url.password),
        ...(isLocal || sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
    }
}

export function detectDatabaseType() {
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
        return 'postgresql'
    }
    if (process.env.MYSQL_URL || process.env.MYSQL_HOST) {
        return 'mysql'
    }
    if (process.env.MONGODB_URI) {
        return 'mongodb'
    }
    return null
}

export function getDatabaseConnectionString() {
    const type = detectDatabaseType()

    switch (type) {
        case 'postgresql':
            return process.env.POSTGRES_URL || process.env.DATABASE_URL
        case 'mysql':
            return process.env.MYSQL_URL || buildMySQLConnectionString()
        case 'mongodb':
            return process.env.MONGODB_URI
        default:
            return null
    }
}

function buildMySQLConnectionString() {
    const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_PORT } = process.env

    if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
        return null
    }

    const port = MYSQL_PORT || '3306'
    const password = MYSQL_PASSWORD ? `:${MYSQL_PASSWORD}` : ''

    return `mysql://${MYSQL_USER}${password}@${MYSQL_HOST}:${port}/${MYSQL_DATABASE}`
}

/**
 * Resolve an optional driver through a non-literal specifier.
 *
 * Static analysers (webpack, esbuild) cannot follow the specifier, so an install that only
 * uses PostgreSQL never needs the deprecated MySQL driver present at build time. The
 * module is still imported normally at runtime if that branch is reached.
 */
function importOptionalDriver(specifier) {
    return import(specifier)
}

export async function getDatabaseConnection() {
    const type = detectDatabaseType()
    const connectionString = getDatabaseConnectionString()

    if (!type || !connectionString) {
        throw new Error('Database not configured')
    }

    switch (type) {
        case 'mysql': {
            // Deprecated legacy driver: resolved at runtime so a Postgres-only install
            // neither ships it nor fails a bundler that tries to resolve it statically.
            const mysql = await importOptionalDriver('mysql2/promise')
            return await mysql.createConnection(connectionString)
        }
        case 'postgresql': {
            const { Client } = await import('pg')
            const client = new Client(buildPostgresClientConfig(connectionString))
            await client.connect()
            return client
        }
        case 'mongodb': {
            const { MongoClient } = await import('mongodb')
            const client = new MongoClient(connectionString)
            await client.connect()
            return client
        }
        default:
            throw new Error(`Unsupported database type: ${type}`)
    }
}

export default {
    detectDatabaseType,
    getDatabaseConnectionString,
    getDatabaseConnection,
    buildPostgresClientConfig
}
