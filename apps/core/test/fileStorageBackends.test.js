import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { deleteStoredObject, getStoredObject, putStoredObject } from '../src/lib/fileStorageBackends.js'
import { sha256Hex } from '../src/lib/fileStorageSigning.js'

async function makeTempRoot() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'practice-files-'))
}

test('local storage round-trips a file under the storage root', async () => {
    const root = await makeTempRoot()
    try {
        const config = { localDir: root }
        const key = 'domains/acmeot/patients/12/7-report.pdf'
        const body = Buffer.from('report body')

        await putStoredObject({ backend: 'local', config, key, buffer: body, contentType: 'application/pdf' })

        const stored = await getStoredObject({ backend: 'local', config, key })
        assert.deepEqual(stored, body)
        assert.deepEqual(await fs.readFile(path.join(root, key)), body)

        await deleteStoredObject({ backend: 'local', config, key })
        await assert.rejects(getStoredObject({ backend: 'local', config, key }), /missing on disk/)
    } finally {
        await fs.rm(root, { recursive: true, force: true })
    }
})

test('deleting a file that is already gone is not an error', async () => {
    const root = await makeTempRoot()
    try {
        await deleteStoredObject({
            backend: 'local',
            config: { localDir: root },
            key: 'domains/acmeot/practice/1-never-uploaded.pdf',
        })
    } finally {
        await fs.rm(root, { recursive: true, force: true })
    }
})

test('local storage refuses a key outside its root', async () => {
    const root = await makeTempRoot()
    try {
        await assert.rejects(
            putStoredObject({ backend: 'local', config: { localDir: root }, key: '../escape.pdf', buffer: Buffer.from('x') }),
            /outside the configured storage directory/
        )
    } finally {
        await fs.rm(root, { recursive: true, force: true })
    }
})

test('local storage needs a configured directory', async () => {
    await assert.rejects(
        putStoredObject({ backend: 'local', config: {}, key: 'a.pdf', buffer: Buffer.from('x') }),
        /FILE_STORAGE_DIR/
    )
})

test('an unknown backend is rejected rather than guessed', async () => {
    await assert.rejects(
        putStoredObject({ backend: 'dropbox', config: {}, key: 'a.pdf', buffer: Buffer.from('x') }),
        /Unknown file storage backend/
    )
})

function stubFetch(handler) {
    const original = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options })
        return handler(String(url), options)
    }
    return {
        calls,
        restore() {
            globalThis.fetch = original
        },
    }
}

function bufferResponse(buffer, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async arrayBuffer() {
            return buffer
        },
        async text() {
            return ''
        },
    }
}

test('S3 uploads are signed and addressed by bucket and key', async () => {
    const stub = stubFetch(() => bufferResponse(Buffer.alloc(0), 200))
    try {
        const config = {
            s3: {
                bucket: 'practice-files',
                region: 'ap-southeast-2',
                endpoint: '',
                forcePathStyle: false,
                accessKeyId: 'AKIDEXAMPLE',
                secretAccessKey: 'secret',
                sessionToken: '',
            },
        }

        await putStoredObject({
            backend: 's3',
            config,
            key: 'domains/acme ot/patients/12/7-report final.pdf',
            buffer: Buffer.from('body'),
            contentType: 'application/pdf',
        })

        assert.equal(stub.calls.length, 1)
        const [{ url, options }] = stub.calls
        assert.equal(
            url,
            'https://practice-files.s3.ap-southeast-2.amazonaws.com/domains/acme%20ot/patients/12/7-report%20final.pdf'
        )
        assert.equal(options.method, 'PUT')
        assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
        assert.equal(options.headers['content-type'], 'application/pdf')
        assert.equal(options.headers['x-amz-content-sha256'], sha256Hex('body'))
    } finally {
        stub.restore()
    }
})

test('S3 reads return the stored bytes and tolerate an already-deleted object', async () => {
    const body = Buffer.from('downloaded')
    const stub = stubFetch((url, options) => {
        if (options.method === 'DELETE') return bufferResponse(Buffer.alloc(0), 404)
        return bufferResponse(body, 200)
    })
    try {
        const config = {
            s3: {
                bucket: 'practice-files',
                region: 'us-east-1',
                endpoint: '',
                forcePathStyle: false,
                accessKeyId: 'AKIDEXAMPLE',
                secretAccessKey: 'secret',
                sessionToken: '',
            },
        }
        const key = 'domains/acmeot/practice/9-ref.pdf'

        const stored = await getStoredObject({ backend: 's3', config, key })
        assert.deepEqual(stored, body)

        await deleteStoredObject({ backend: 's3', config, key })
    } finally {
        stub.restore()
    }
})

test('a custom S3 endpoint uses path-style addressing for compatible stores', async () => {
    const stub = stubFetch(() => bufferResponse(Buffer.alloc(0), 200))
    try {
        await putStoredObject({
            backend: 's3',
            config: {
                s3: {
                    bucket: 'practice',
                    region: 'us-east-1',
                    endpoint: 'http://minio.local:9000',
                    forcePathStyle: true,
                    accessKeyId: 'minio',
                    secretAccessKey: 'minio-secret',
                    sessionToken: '',
                },
            },
            key: 'domains/x/practice/1-a.pdf',
            buffer: Buffer.from('a'),
            contentType: 'application/pdf',
        })

        assert.equal(stub.calls[0].url, 'http://minio.local:9000/practice/domains/x/practice/1-a.pdf')
    } finally {
        stub.restore()
    }
})

test('GCS uploads use the media endpoint, the object name and the bearer token', async () => {
    const stub = stubFetch(() => bufferResponse(Buffer.alloc(0), 200))
    try {
        const config = {
            gcs: {
                bucket: 'practice-files',
                endpoint: 'https://storage.googleapis.com',
                accessToken: 'gcs-token',
                serviceAccountJson: '',
                serviceAccountPath: '',
                metadataCredentials: false,
            },
        }

        await putStoredObject({
            backend: 'gcs',
            config,
            key: 'domains/acmeot/practice/9-ref final.pdf',
            buffer: Buffer.from('body'),
            contentType: 'application/pdf',
        })

        const [{ url, options }] = stub.calls
        assert.equal(
            url,
            'https://storage.googleapis.com/upload/storage/v1/b/practice-files/o?uploadType=media&name=domains%2Facmeot%2Fpractice%2F9-ref%20final.pdf'
        )
        assert.equal(options.method, 'POST')
        assert.equal(options.headers.Authorization, 'Bearer gcs-token')
        assert.equal(options.headers['Content-Type'], 'application/pdf')
    } finally {
        stub.restore()
    }
})

test('GCS reads append alt=media and report a failed read with its status', async () => {
    const stub = stubFetch(() => bufferResponse(Buffer.alloc(0), 404))
    try {
        const config = {
            gcs: {
                bucket: 'practice-files',
                endpoint: 'https://storage.googleapis.com',
                accessToken: 'gcs-token',
                serviceAccountJson: '',
                serviceAccountPath: '',
                metadataCredentials: false,
            },
        }

        await assert.rejects(
            getStoredObject({ backend: 'gcs', config, key: 'domains/x/practice/1-a.pdf' }),
            /Could not read domains\/x\/practice\/1-a.pdf in file storage \(404\)/
        )
        assert.equal(
            stub.calls[0].url,
            'https://storage.googleapis.com/storage/v1/b/practice-files/o/domains%2Fx%2Fpractice%2F1-a.pdf?alt=media'
        )
    } finally {
        stub.restore()
    }
})
