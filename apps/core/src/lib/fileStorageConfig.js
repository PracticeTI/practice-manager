/**
 * Where a practice stores the files uploaded to it.
 *
 * A practice keeps files in the database by default. The alternative backends are
 * deployment capabilities rather than constants: `local` needs a writable directory
 * (Solo desktop, Docker volume, LAN host), `s3` and `gcs` need a bucket and
 * credentials. The choice is stored per domain as `fileStorageBackend` so one
 * practice can move its files out of the database without changing how another is
 * hosted; the credentials and bucket stay in the deployment environment.
 *
 * This module is deliberately pure - it reads an `env` object and a settings
 * record, never `process.env` or the filesystem - so the settings form, the API and
 * the `node --test` runner all resolve the same answer.
 */

export const DATABASE_FILE_STORAGE_BACKEND = 'database'
export const DEFAULT_FILE_STORAGE_BACKEND = DATABASE_FILE_STORAGE_BACKEND

/** Backends in the order the settings form offers them. */
export const FILE_STORAGE_BACKENDS = [DATABASE_FILE_STORAGE_BACKEND, 'local', 's3', 'gcs']

export const FILE_STORAGE_BACKEND_LABELS = {
    [DATABASE_FILE_STORAGE_BACKEND]: 'Database',
    local: 'Local files',
    s3: 'Amazon S3',
    gcs: 'Google Cloud Storage',
}

/** Backends that keep bytes outside the database. */
export const EXTERNAL_FILE_STORAGE_BACKENDS = ['local', 's3', 'gcs']

// A prefix is a bucket/directory namespace, not a path: keep it to characters that
// are safe in every backend and cannot climb out of the storage root.
const PREFIX_PATTERN = /^[A-Za-z0-9._-]{1,200}$/

function normalizeString(value) {
    return String(value ?? '').trim()
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const normalized = normalizeString(value)
        if (normalized) return normalized
    }
    return ''
}

function parseBoolean(value) {
    const normalized = normalizeString(value).toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * Read the stored backend for a practice. Anything unrecognised - including the
 * `undefined` an older settings record carries - means the database default.
 */
export function normalizeFileStorageBackend(value) {
    const normalized = normalizeString(value).toLowerCase()
    return FILE_STORAGE_BACKENDS.includes(normalized) ? normalized : DEFAULT_FILE_STORAGE_BACKEND
}

/**
 * Normalise a storage prefix (`FILE_STORAGE_PREFIX`). Blank means no prefix, and a
 * value that would escape its namespace is dropped rather than silently rewritten.
 */
export function normalizeFileStoragePrefix(value) {
    const normalized = normalizeString(value).replace(/^\/+|\/+$/g, '')
    if (!normalized) return ''
    if (!PREFIX_PATTERN.test(normalized) || normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
        return ''
    }
    return normalized
}

/** True when the deployment is a serverless host with an ephemeral filesystem. */
export function isServerlessDeployment(env = {}) {
    return Boolean(env.VERCEL || env.VERCEL_ENV || env.K_SERVICE || env.AWS_LAMBDA_FUNCTION_NAME)
}

function resolveS3Config(env) {
    return {
        bucket: firstNonEmpty(env.FILE_STORAGE_S3_BUCKET, env.AWS_S3_BUCKET),
        region: firstNonEmpty(env.FILE_STORAGE_S3_REGION, env.AWS_REGION, env.AWS_DEFAULT_REGION, 'us-east-1'),
        endpoint: firstNonEmpty(env.FILE_STORAGE_S3_ENDPOINT, env.AWS_ENDPOINT_URL_S3, env.AWS_ENDPOINT_URL),
        accessKeyId: firstNonEmpty(env.FILE_STORAGE_S3_ACCESS_KEY_ID, env.AWS_ACCESS_KEY_ID),
        secretAccessKey: firstNonEmpty(env.FILE_STORAGE_S3_SECRET_ACCESS_KEY, env.AWS_SECRET_ACCESS_KEY),
        sessionToken: firstNonEmpty(env.FILE_STORAGE_S3_SESSION_TOKEN, env.AWS_SESSION_TOKEN),
        forcePathStyle: parseBoolean(env.FILE_STORAGE_S3_FORCE_PATH_STYLE) || Boolean(firstNonEmpty(env.FILE_STORAGE_S3_ENDPOINT, env.AWS_ENDPOINT_URL_S3)),
    }
}

function resolveGcsConfig(env) {
    return {
        bucket: firstNonEmpty(env.FILE_STORAGE_GCS_BUCKET, env.GCS_BUCKET),
        endpoint: firstNonEmpty(env.FILE_STORAGE_GCS_ENDPOINT, 'https://storage.googleapis.com').replace(/\/+$/, ''),
        serviceAccountJson: firstNonEmpty(env.FILE_STORAGE_GCS_SERVICE_ACCOUNT_JSON),
        serviceAccountPath: firstNonEmpty(env.FILE_STORAGE_GCS_SERVICE_ACCOUNT_PATH, env.GOOGLE_APPLICATION_CREDENTIALS),
        accessToken: firstNonEmpty(env.FILE_STORAGE_GCS_ACCESS_TOKEN),
        // A Cloud Run/GCE service account reaches the metadata server without a key
        // file, so running there is itself a usable credential source.
        metadataCredentials: Boolean(env.K_SERVICE || env.GOOGLE_CLOUD_PROJECT || env.GCE_METADATA_HOST),
    }
}

/**
 * Resolve the deployment half of the file storage configuration.
 *
 * `settings` is the practice's domain settings record; only the backend choice is
 * stored there. Buckets, credentials and the storage root are deployment facts and
 * stay in the environment, so a superadmin cannot point a practice at a bucket the
 * deployment has no access to.
 */
export function resolveFileStorageConfig({ settings = {}, env = {} } = {}) {
    const backend = normalizeFileStorageBackend(settings?.fileStorageBackend)
    const localDir = firstNonEmpty(env.FILE_STORAGE_DIR)

    return {
        backend,
        label: FILE_STORAGE_BACKEND_LABELS[backend],
        prefix: normalizeFileStoragePrefix(env.FILE_STORAGE_PREFIX),
        serverless: isServerlessDeployment(env),
        // The file row itself always lives in PostgreSQL, so every backend needs it.
        databaseConfigured: Boolean(firstNonEmpty(env.POSTGRES_URL, env.DATABASE_URL)),
        localDir,
        s3: resolveS3Config(env),
        gcs: resolveGcsConfig(env),
    }
}

/**
 * Whether one backend has everything it needs in this deployment.
 *
 * The database backend answers for a PostgreSQL connection because the file row
 * (name, size, owner) always lives there, even when the bytes do not.
 */
export function describeFileStorageBackend(config, backend = config?.backend) {
    const selected = normalizeFileStorageBackend(backend)
    const databaseConfigured = config?.databaseConfigured !== false

    if (selected === DATABASE_FILE_STORAGE_BACKEND) {
        return {
            backend: selected,
            label: FILE_STORAGE_BACKEND_LABELS[selected],
            available: databaseConfigured,
            reason: databaseConfigured ? '' : 'No PostgreSQL connection is configured for this deployment.',
        }
    }

    if (selected === 'local') {
        if (!config.localDir) {
            return {
                backend: selected,
                label: FILE_STORAGE_BACKEND_LABELS[selected],
                available: false,
                reason: config.serverless
                    ? 'Serverless hosts have an ephemeral filesystem. Use Amazon S3 or Google Cloud Storage instead.'
                    : 'Set FILE_STORAGE_DIR to a writable directory (a mounted volume in containers) to store files locally.',
            }
        }
        return { backend: selected, label: FILE_STORAGE_BACKEND_LABELS[selected], available: true, reason: '' }
    }

    if (selected === 's3') {
        const missing = []
        if (!config.s3?.bucket) missing.push('FILE_STORAGE_S3_BUCKET')
        if (!config.s3?.accessKeyId) missing.push('FILE_STORAGE_S3_ACCESS_KEY_ID')
        if (!config.s3?.secretAccessKey) missing.push('FILE_STORAGE_S3_SECRET_ACCESS_KEY')
        return {
            backend: selected,
            label: FILE_STORAGE_BACKEND_LABELS[selected],
            available: missing.length === 0,
            reason: missing.length === 0 ? '' : `Missing ${missing.join(', ')}.`,
        }
    }

    const missing = []
    if (!config.gcs?.bucket) missing.push('FILE_STORAGE_GCS_BUCKET')
    if (!config.gcs?.accessToken && !config.gcs?.serviceAccountJson && !config.gcs?.serviceAccountPath && !config.gcs?.metadataCredentials) {
        missing.push('FILE_STORAGE_GCS_SERVICE_ACCOUNT_JSON or FILE_STORAGE_GCS_ACCESS_TOKEN')
    }
    return {
        backend: selected,
        label: FILE_STORAGE_BACKEND_LABELS[selected],
        available: missing.length === 0,
        reason: missing.length === 0 ? '' : `Missing ${missing.join(', ')}.`,
    }
}

/**
 * The resolved backend for a practice, plus whether this deployment can honour it.
 * Callers that serve a request and callers that render the setting read this.
 */
export function describePracticeFileStorage({ settings = {}, env = {}, databaseConfigured = true } = {}) {
    const config = resolveFileStorageConfig({ settings, env })
    config.databaseConfigured = databaseConfigured !== false

    const descriptor = describeFileStorageBackend(config)
    return {
        ...descriptor,
        // Surfaced on the Files page so an operator can see which practice moved its
        // files out of the database without opening the settings form.
        external: descriptor.backend !== DATABASE_FILE_STORAGE_BACKEND,
        prefix: config.prefix,
    }
}
