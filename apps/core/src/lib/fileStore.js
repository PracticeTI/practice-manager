/**
 * Reads and writes the files a practice uploads, wherever that practice keeps them.
 *
 * Every file has a row in `patient_files` - name, size, owner - because that is what
 * the rest of the app queries. The bytes go either into the row itself (`database`,
 * the default) or into the practice's chosen backend, with `storage_backend` and
 * `storage_key` recording where. Reading keys off the row rather than the practice's
 * current setting, so files uploaded before a switch stay reachable.
 */

import { getDomainSetting } from './appSettings.js'
import { detectDatabaseType } from './database.js'
import { withPostgresRlsContext } from './postgresRlsContext.js'
import {
    DATABASE_FILE_STORAGE_BACKEND,
    describeFileStorageBackend,
    describePracticeFileStorage,
    normalizeFileStorageBackend,
    resolveFileStorageConfig,
} from './fileStorageConfig.js'
import { buildFileStorageKey } from './fileStoragePaths.js'
import { deleteStoredObject, getStoredObject, putStoredObject } from './fileStorageBackends.js'

/** A file operation the practice's storage configuration cannot serve. */
export class FileStorageError extends Error {
    constructor(message, { status = 400, code = 'file_storage_error' } = {}) {
        super(message)
        this.name = 'FileStorageError'
        this.status = status
        this.code = code
    }
}

async function loadPracticeSettings(domain) {
    return (await getDomainSetting(domain, 'management')) || {}
}

/**
 * The backend this practice writes to, plus whether this deployment can serve it.
 * The settings form and the Files page show the same answer.
 */
export async function resolvePracticeFileStorage(domain) {
    const settings = await loadPracticeSettings(domain)
    const descriptor = describePracticeFileStorage({
        settings,
        env: process.env,
        databaseConfigured: detectDatabaseType() === 'postgresql',
    })
    const config = resolveFileStorageConfig({ settings, env: process.env })
    return { settings, descriptor, config }
}

function insertFileRow(scopedConnection, { domain, patientId, fileName, mimeType, fileSize, fileData, backend }) {
    return scopedConnection.query(
        `INSERT INTO patient_files (domain, patient_id, file_name, mime_type, file_size, file_data, storage_backend)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, patient_id, file_name, mime_type, file_size, storage_backend, created_at`,
        [domain, patientId || null, fileName, mimeType, fileSize, fileData, backend]
    )
}

/**
 * Store one upload. Returns the row the API reports back; for an external backend
 * the row is written first so the storage key can carry its id, then the bytes are
 * uploaded and the key recorded.
 */
export async function saveStoredFile({ connection, context, patientId = null, fileName, mimeType, buffer }) {
    const { descriptor, config } = await resolvePracticeFileStorage(context.domain)
    if (!descriptor.available) {
        throw new FileStorageError(descriptor.reason || 'File storage is not configured for this practice')
    }

    const backend = descriptor.backend
    const record = await withPostgresRlsContext(connection, context, async (scopedConnection) => {
        const result = await insertFileRow(scopedConnection, {
            domain: context.domain,
            patientId,
            fileName,
            mimeType,
            fileSize: buffer.length,
            fileData: backend === DATABASE_FILE_STORAGE_BACKEND ? buffer : null,
            backend,
        })
        return result.rows?.[0] || null
    })
    if (!record) throw new FileStorageError('Could not record the uploaded file', { status: 500 })

    if (backend === DATABASE_FILE_STORAGE_BACKEND) {
        return { record, storage: descriptor }
    }

    const storageKey = buildFileStorageKey({
        domain: context.domain,
        patientId,
        fileId: record.id,
        fileName,
        prefix: config.prefix,
    })

    try {
        await putStoredObject({ backend, config, key: storageKey, buffer, contentType: mimeType })
    } catch (error) {
        // A row without its bytes would look like a working file, so drop it and
        // surface the storage failure instead.
        await withPostgresRlsContext(connection, context, (scopedConnection) =>
            scopedConnection.query('DELETE FROM patient_files WHERE id = $1 AND domain = $2', [record.id, context.domain])
        ).catch(() => { })
        throw new FileStorageError(error?.message || 'Could not store the uploaded file', { status: 502 })
    }

    const updated = await withPostgresRlsContext(connection, context, (scopedConnection) =>
        scopedConnection.query(
            'UPDATE patient_files SET storage_key = $3 WHERE id = $1 AND domain = $2 RETURNING storage_key',
            [record.id, context.domain, storageKey]
        )
    ).catch(() => null)

    // A failed key write leaves an object nobody can find; remove it rather than leak it.
    if (!updated?.rows?.length) {
        await deleteStoredObject({ backend, config, key: storageKey }).catch(() => { })
        throw new FileStorageError('Could not finish recording the uploaded file', { status: 500 })
    }

    return {
        record: { ...record, storage_key: storageKey },
        storage: descriptor,
    }
}

/**
 * Read one file's bytes from the backend that holds them.
 *
 * Callers that already have the row (a list, the analyst's evidence sweep) use this
 * directly; `readStoredFile` is the row lookup plus this call.
 */
export async function readStoredFileBuffer({ storageBackend, storageKey, fileData }) {
    const backend = normalizeFileStorageBackend(storageBackend)

    if (backend === DATABASE_FILE_STORAGE_BACKEND || !storageKey) {
        if (!fileData) {
            throw new FileStorageError('The stored copy of this file is missing', { status: 404, code: 'file_data_missing' })
        }
        return Buffer.from(fileData)
    }

    const config = resolveFileStorageConfig({ env: process.env })
    const backendInfo = describeFileStorageBackend(config, backend)
    if (!backendInfo.available) {
        throw new FileStorageError(
            `This file is stored in ${backendInfo.label}, which is no longer configured for this deployment. ${backendInfo.reason}`.trim(),
            { status: 503, code: 'file_storage_unavailable' }
        )
    }

    return getStoredObject({ backend, config, key: storageKey })
}

/**
 * Read one file's metadata and bytes. Returns `null` when the row does not exist in
 * this practice's scope; throws when the row exists but its bytes cannot be read.
 */
export async function readStoredFile({ connection, context, fileId }) {
    const row = await withPostgresRlsContext(connection, context, async (scopedConnection) => {
        const result = await scopedConnection.query(
            `SELECT id, patient_id, file_name, mime_type, file_size, file_data, storage_backend, storage_key, analysis_evidence, created_at
             FROM patient_files
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [fileId, context.domain]
        )
        return result.rows?.[0] || null
    })
    if (!row) return null

    const buffer = await readStoredFileBuffer({
        storageBackend: row.storage_backend,
        storageKey: row.storage_key,
        fileData: row.file_data,
    })
    return { row, buffer }
}

/**
 * Delete a file's row and, when it has one, its stored object. The object delete is
 * best-effort: the row is the record of truth, and a backend outage must not leave
 * a deleted file listing in the practice's Files page.
 */
export async function removeStoredFile({ connection, context, fileId }) {
    const deleted = await withPostgresRlsContext(connection, context, async (scopedConnection) => {
        const result = await scopedConnection.query(
            `DELETE FROM patient_files
             WHERE id = $1 AND domain = $2
             RETURNING id, patient_id, file_name, mime_type, storage_backend, storage_key`,
            [fileId, context.domain]
        )
        return result.rows?.[0] || null
    })
    if (!deleted) return null

    const backend = normalizeFileStorageBackend(deleted.storage_backend)
    let storageWarning = ''
    if (backend !== DATABASE_FILE_STORAGE_BACKEND && deleted.storage_key) {
        const config = resolveFileStorageConfig({ env: process.env })
        try {
            await deleteStoredObject({ backend, config, key: deleted.storage_key })
        } catch (error) {
            storageWarning = error?.message || 'The stored copy could not be removed'
        }
    }

    return { ...deleted, storageWarning }
}
