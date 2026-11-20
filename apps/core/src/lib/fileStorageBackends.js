/**
 * The three non-database file backends.
 *
 * Each backend exposes the same tiny surface - put, get, delete - so the store in
 * `fileStore.js` can move a practice's files without the routes knowing where the
 * bytes ended up. Nothing here reads practice settings; the caller resolves the
 * configuration and passes it in.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildGcsServiceAccountJwt, sha256Hex, signS3Request } from './fileStorageSigning.js'

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const GCS_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const ERROR_BODY_LIMIT = 300

function errorSnippet(text) {
    const snippet = String(text || '').trim().replace(/\s+/g, ' ')
    return snippet.length > ERROR_BODY_LIMIT ? `${snippet.slice(0, ERROR_BODY_LIMIT)}...` : snippet
}

async function assertOk(response, action, key) {
    if (response.ok) return response
    const body = await response.text().catch(() => '')
    const detail = errorSnippet(body)
    throw new Error(
        `Could not ${action} ${key} in file storage (${response.status}${detail ? `: ${detail}` : ''})`
    )
}

function encodeKeyPath(key) {
    return String(key || '')
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join('/')
}

/* ------------------------------------------------------------------ local --- */

function resolveLocalPath(config, key) {
    const root = config.localDir
    if (!root) throw new Error('FILE_STORAGE_DIR is not set, so local file storage is unavailable')

    const resolvedRoot = path.resolve(root)
    const target = path.resolve(resolvedRoot, key)
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
        throw new Error('Refusing to access a file outside the configured storage directory')
    }
    return target
}

async function putLocalObject(config, key, buffer) {
    const target = resolveLocalPath(config, key)
    await fs.mkdir(path.dirname(target), { recursive: true })

    // Write beside the target and rename, so a crashed upload cannot leave a
    // half-written file that the download route would happily serve.
    const temporary = `${target}.upload-${crypto.randomUUID()}`
    try {
        await fs.writeFile(temporary, buffer)
        await fs.rename(temporary, target)
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => { })
        throw error
    }
}

async function getLocalObject(config, key) {
    const target = resolveLocalPath(config, key)
    try {
        return await fs.readFile(target)
    } catch (error) {
        if (error?.code === 'ENOENT') throw new Error(`Stored file is missing on disk: ${key}`)
        throw error
    }
}

async function deleteLocalObject(config, key) {
    await fs.rm(resolveLocalPath(config, key), { force: true })
}

/* -------------------------------------------------------------------- S3 --- */

function buildS3ObjectUrl(config, key) {
    const { bucket, region, endpoint, forcePathStyle } = config.s3
    const encodedKey = encodeKeyPath(key)

    if (endpoint) {
        const base = endpoint.replace(/\/+$/, '')
        return forcePathStyle
            ? new URL(`${base}/${bucket}/${encodedKey}`)
            : new URL(`${base.replace('://', `://${bucket}.`)}/${encodedKey}`)
    }

    const host = region && region !== 'us-east-1'
        ? `${bucket}.s3.${region}.amazonaws.com`
        : `${bucket}.s3.amazonaws.com`
    return new URL(`https://${host}/${encodedKey}`)
}

async function sendS3Request({ config, method, key, body = '', contentType }) {
    const { accessKeyId, secretAccessKey, sessionToken, region } = config.s3
    const url = buildS3ObjectUrl(config, key)
    const headers = {}
    if (contentType) headers['content-type'] = contentType

    const signedHeaders = signS3Request({
        method,
        url,
        headers,
        payloadHash: sha256Hex(body),
        accessKeyId,
        secretAccessKey,
        sessionToken,
        region,
    })

    return fetch(url, {
        method,
        headers: signedHeaders,
        body: method === 'PUT' || method === 'POST' ? body : undefined,
        cache: 'no-store',
    })
}

async function putS3Object(config, key, buffer, contentType) {
    const response = await sendS3Request({
        config,
        method: 'PUT',
        key,
        body: buffer,
        contentType: contentType || 'application/octet-stream',
    })
    await assertOk(response, 'store', key)
}

async function getS3Object(config, key) {
    const response = await sendS3Request({ config, method: 'GET', key })
    await assertOk(response, 'read', key)
    return Buffer.from(await response.arrayBuffer())
}

async function deleteS3Object(config, key) {
    const response = await sendS3Request({ config, method: 'DELETE', key })
    // S3 answers 204 on delete; a 404 means the object is already gone, which is
    // the same outcome the caller wanted.
    if (response.status === 404) return
    await assertOk(response, 'delete', key)
}

/* ------------------------------------------------------------------- GCS --- */

let cachedGcsToken = null

function resetGcsTokenCache() {
    cachedGcsToken = null
}

async function readGcsServiceAccount(config) {
    const { serviceAccountJson, serviceAccountPath } = config.gcs
    if (serviceAccountJson) return JSON.parse(serviceAccountJson)
    if (serviceAccountPath) {
        const raw = await fs.readFile(serviceAccountPath, 'utf8')
        return JSON.parse(raw)
    }
    return null
}

async function fetchGcsMetadataToken() {
    const host = String(process.env.GCE_METADATA_HOST || 'metadata.google.internal').replace(/\/+$/, '')
    const response = await fetch(
        `http://${host}/computeMetadata/v1/instance/service-accounts/default/token`,
        { headers: { 'Metadata-Flavor': 'Google' }, cache: 'no-store' }
    )
    if (!response.ok) throw new Error(`Could not read Google Cloud credentials from the metadata server (${response.status})`)
    const data = await response.json()
    return { token: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 }
}

async function exchangeGcsServiceAccountToken(config) {
    const account = await readGcsServiceAccount(config)
    if (!account) return null

    const assertion = buildGcsServiceAccountJwt({
        clientEmail: account.client_email,
        privateKey: account.private_key,
        scope: GCS_SCOPE,
    })
    const response = await fetch(GCS_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }).toString(),
        cache: 'no-store',
    })
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Could not exchange the Google service account for a token (${response.status}: ${errorSnippet(body)})`)
    }
    const data = await response.json()
    return { token: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 }
}

async function getGcsAccessToken(config) {
    if (config.gcs.accessToken) return config.gcs.accessToken
    if (cachedGcsToken && cachedGcsToken.expiresAt - 60_000 > Date.now()) return cachedGcsToken.token

    const issued = await exchangeGcsServiceAccountToken(config)
        || (config.gcs.metadataCredentials ? await fetchGcsMetadataToken() : null)
    if (!issued?.token) throw new Error('No Google Cloud Storage credentials are configured')

    cachedGcsToken = issued
    return issued.token
}

function buildGcsObjectUrl(config, key, { upload = false } = {}) {
    const { bucket, endpoint } = config.gcs
    if (upload) {
        return `${endpoint}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`
    }
    return `${endpoint}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`
}

async function sendGcsRequest({ config, method, url, body, contentType }) {
    const token = await getGcsAccessToken(config)
    const headers = { Authorization: `Bearer ${token}` }
    if (contentType) headers['Content-Type'] = contentType
    return fetch(url, { method, headers, body, cache: 'no-store' })
}

async function putGcsObject(config, key, buffer, contentType) {
    const response = await sendGcsRequest({
        config,
        method: 'POST',
        url: buildGcsObjectUrl(config, key, { upload: true }),
        body: buffer,
        contentType: contentType || 'application/octet-stream',
    })
    await assertOk(response, 'store', key)
}

async function getGcsObject(config, key) {
    const response = await sendGcsRequest({
        config,
        method: 'GET',
        url: `${buildGcsObjectUrl(config, key)}?alt=media`,
    })
    await assertOk(response, 'read', key)
    return Buffer.from(await response.arrayBuffer())
}

async function deleteGcsObject(config, key) {
    const response = await sendGcsRequest({ config, method: 'DELETE', url: buildGcsObjectUrl(config, key) })
    if (response.status === 404) return
    await assertOk(response, 'delete', key)
}

/* --------------------------------------------------------------- dispatch --- */

export async function putStoredObject({ backend, config, key, buffer, contentType }) {
    if (backend === 'local') return putLocalObject(config, key, buffer)
    if (backend === 's3') return putS3Object(config, key, buffer, contentType)
    if (backend === 'gcs') return putGcsObject(config, key, buffer, contentType)
    throw new Error(`Unknown file storage backend: ${backend}`)
}

export async function getStoredObject({ backend, config, key }) {
    if (backend === 'local') return getLocalObject(config, key)
    if (backend === 's3') return getS3Object(config, key)
    if (backend === 'gcs') return getGcsObject(config, key)
    throw new Error(`Unknown file storage backend: ${backend}`)
}

export async function deleteStoredObject({ backend, config, key }) {
    if (backend === 'local') return deleteLocalObject(config, key)
    if (backend === 's3') return deleteS3Object(config, key)
    if (backend === 'gcs') return deleteGcsObject(config, key)
    throw new Error(`Unknown file storage backend: ${backend}`)
}

/** Test seam: lets a test prove the token cache is used without waiting an hour. */
export function clearCachedGcsTokenForTests() {
    resetGcsTokenCache()
}
