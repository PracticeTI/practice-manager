import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_FILE_STORAGE_BACKEND,
    FILE_STORAGE_BACKENDS,
    describeFileStorageBackend,
    describePracticeFileStorage,
    isServerlessDeployment,
    normalizeFileStorageBackend,
    normalizeFileStoragePrefix,
    resolveFileStorageConfig,
} from '../src/lib/fileStorageConfig.js'

test('a practice keeps files in the database unless it chose otherwise', () => {
    assert.equal(DEFAULT_FILE_STORAGE_BACKEND, 'database')
    assert.equal(normalizeFileStorageBackend(undefined), 'database')
    assert.equal(normalizeFileStorageBackend(''), 'database')
    assert.equal(normalizeFileStorageBackend('dropbox'), 'database')
    assert.equal(normalizeFileStorageBackend(' S3 '), 's3')
    assert.deepEqual(FILE_STORAGE_BACKENDS, ['database', 'local', 's3', 'gcs'])
})

test('the storage prefix is a namespace, not a path', () => {
    assert.equal(normalizeFileStoragePrefix(''), '')
    assert.equal(normalizeFileStoragePrefix('/acme/'), 'acme')
    assert.equal(normalizeFileStoragePrefix('../etc'), '')
    assert.equal(normalizeFileStoragePrefix('a/b'), '')
    assert.equal(normalizeFileStoragePrefix('tenant_1.prod'), 'tenant_1.prod')
})

test('serverless hosts are detected from the provider environment', () => {
    assert.equal(isServerlessDeployment({ VERCEL: '1' }), true)
    assert.equal(isServerlessDeployment({ K_SERVICE: 'core' }), true)
    assert.equal(isServerlessDeployment({ AWS_LAMBDA_FUNCTION_NAME: 'fn' }), true)
    assert.equal(isServerlessDeployment({ NODE_ENV: 'production' }), false)
})

test('the database backend is available when the deployment has PostgreSQL', () => {
    const configured = describeFileStorageBackend(
        resolveFileStorageConfig({ settings: {}, env: { DATABASE_URL: 'postgres://localhost/practice' } })
    )
    assert.equal(configured.backend, 'database')
    assert.equal(configured.available, true)

    const missing = describeFileStorageBackend(
        resolveFileStorageConfig({ settings: {}, env: { DATABASE_URL: '' } })
    )
    assert.equal(missing.available, false)
    assert.match(missing.reason, /PostgreSQL/)
})

test('local storage needs a writable directory, and says why serverless cannot use it', () => {
    const settings = { fileStorageBackend: 'local' }

    const withoutDir = resolveFileStorageConfig({ settings, env: {} })
    const unavailable = describeFileStorageBackend(withoutDir)
    assert.equal(unavailable.available, false)
    assert.match(unavailable.reason, /FILE_STORAGE_DIR/)

    const serverless = describeFileStorageBackend(resolveFileStorageConfig({ settings, env: { VERCEL: '1' } }))
    assert.equal(serverless.available, false)
    assert.match(serverless.reason, /S3|Cloud Storage/)

    const configured = describeFileStorageBackend(
        resolveFileStorageConfig({ settings, env: { FILE_STORAGE_DIR: '/var/lib/practice/files' } })
    )
    assert.equal(configured.available, true)
})

test('S3 falls back to the standard AWS variable names', () => {
    const config = resolveFileStorageConfig({
        settings: { fileStorageBackend: 's3' },
        env: {
            AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
            AWS_SECRET_ACCESS_KEY: 'secret',
            AWS_REGION: 'ap-southeast-2',
            AWS_S3_BUCKET: 'practice-files',
        },
    })

    assert.equal(config.s3.accessKeyId, 'AKIAEXAMPLE')
    assert.equal(config.s3.region, 'ap-southeast-2')
    assert.equal(config.s3.bucket, 'practice-files')
    assert.equal(describeFileStorageBackend(config).available, true)
})

test('S3 names every missing setting in one message', () => {
    const descriptor = describeFileStorageBackend(
        resolveFileStorageConfig({ settings: { fileStorageBackend: 's3' }, env: {} })
    )
    assert.equal(descriptor.available, false)
    assert.match(descriptor.reason, /FILE_STORAGE_S3_BUCKET/)
    assert.match(descriptor.reason, /FILE_STORAGE_S3_ACCESS_KEY_ID/)
})

test('GCS accepts a bucket with an access token, a service account or metadata credentials', () => {
    const withToken = describeFileStorageBackend(resolveFileStorageConfig({
        settings: { fileStorageBackend: 'gcs' },
        env: { FILE_STORAGE_GCS_BUCKET: 'practice-files', FILE_STORAGE_GCS_ACCESS_TOKEN: 'token' },
    }))
    assert.equal(withToken.available, true)

    const withMetadata = describeFileStorageBackend(resolveFileStorageConfig({
        settings: { fileStorageBackend: 'gcs' },
        env: { FILE_STORAGE_GCS_BUCKET: 'practice-files', K_SERVICE: 'core' },
    }))
    assert.equal(withMetadata.available, true)

    const noCredentials = describeFileStorageBackend(resolveFileStorageConfig({
        settings: { fileStorageBackend: 'gcs' },
        env: { FILE_STORAGE_GCS_BUCKET: 'practice-files' },
    }))
    assert.equal(noCredentials.available, false)
})

test('the practice descriptor reports an external backend', () => {
    const descriptor = describePracticeFileStorage({
        settings: { fileStorageBackend: 'local' },
        env: { FILE_STORAGE_DIR: '/srv/files', FILE_STORAGE_PREFIX: 'clinic-a', DATABASE_URL: 'postgres://x' },
    })
    assert.equal(descriptor.backend, 'local')
    assert.equal(descriptor.external, true)
    assert.equal(descriptor.available, true)
    assert.equal(descriptor.prefix, 'clinic-a')
})
