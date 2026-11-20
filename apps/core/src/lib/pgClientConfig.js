/**
 * Shared `pg` client configuration.
 *
 * `pg` defaults to `ssl: false` and has no libpq-style "prefer" mode: a config
 * built by hand connects in plaintext unless TLS is set. Every hosted database
 * this app talks to is remote, so encryption is the default here and
 * `?sslmode=disable` is the explicit opt-out for a local server on another host.
 *
 * `rejectUnauthorized: false` matches the rest of the project: the hosted pooler
 * presents a chain node-postgres will not verify (see docs/postgres-rls-rollout.md).
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
 * Build a `pg` client (or Pool) config from a connection URL.
 *
 * @param {string} connectionString
 * @param {object} [extra] Client options merged last, e.g. `statement_timeout`.
 */
export function buildPgClientConfig(connectionString, extra = {}) {
    if (!connectionString) throw new Error('PostgreSQL connection string missing')

    const url = new URL(connectionString)
    const isLocal = LOCAL_DATABASE_HOSTS.has(url.hostname)
    const sslDisabled = url.searchParams.get('sslmode') === 'disable'

    return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 5432,
        database: decodeUrlCredential(url.pathname.slice(1)) || 'postgres',
        // `new URL()` leaves these percent-encoded. `pg` only decodes them when it
        // parses a connection string itself, so a config without `connectionString`
        // must decode here or a password containing `@`, `%` or `:` fails auth.
        user: decodeUrlCredential(url.username),
        password: decodeUrlCredential(url.password),
        ...(isLocal || sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
        ...extra,
    }
}

export default buildPgClientConfig
