import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
    awsUriEncode,
    buildGcsServiceAccountJwt,
    formatAmzTimestamps,
    sha256Hex,
    signS3Request,
} from '../src/lib/fileStorageSigning.js'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const EXAMPLE_CREDENTIALS = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
}

test('the AWS documentation GET example signs to the documented signature', () => {
    // ExampleBucket / GET /test.txt, from the S3 Signature Version 4 examples.
    const signed = signS3Request({
        method: 'GET',
        url: 'https://examplebucket.s3.amazonaws.com/test.txt',
        headers: { Range: 'bytes=0-9' },
        payloadHash: EMPTY_SHA256,
        ...EXAMPLE_CREDENTIALS,
        now: new Date('2013-05-24T00:00:00Z'),
    })

    assert.equal(
        signed.authorization,
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
        + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
        + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
    assert.equal(signed['x-amz-date'], '20130524T000000Z')
})

test('an upload signs the body hash, content type and host', () => {
    const body = Buffer.from('hello world')
    const signed = signS3Request({
        method: 'PUT',
        url: 'https://mybucket.s3.us-west-2.amazonaws.com/domains/acmeot/patients/12/7-scan.pdf',
        headers: { 'Content-Type': 'application/pdf' },
        payloadHash: sha256Hex(body),
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'secretexample',
        region: 'us-west-2',
        now: new Date('2024-01-02T03:04:05Z'),
    })

    // Cross-checked against botocore's S3SigV4Auth for the same request.
    assert.equal(
        signed.authorization,
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20240102/us-west-2/s3/aws4_request, '
        + 'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, '
        + 'Signature=52d94860b0b82b063dc86440d2ad45a817a9470f5f19a7130a0d066d70f1bf72'
    )
    assert.equal(signed['x-amz-content-sha256'], sha256Hex(body))
})

test('query parameters are sorted and encoded into the canonical request', () => {
    const signed = signS3Request({
        method: 'GET',
        url: 'https://mybucket.s3.us-west-2.amazonaws.com/?list-type=2&prefix=domains%2Facmeot%2F',
        headers: {},
        payloadHash: EMPTY_SHA256,
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'secretexample',
        region: 'us-west-2',
        now: new Date('2024-01-02T03:04:05Z'),
    })

    assert.match(signed.authorization, /Signature=fc9db01b1213b9b02216d41b19805375524972083e3fdea586d69f78a41e91c3$/)
})

test('a session token is signed and sent', () => {
    const signed = signS3Request({
        method: 'GET',
        url: 'https://examplebucket.s3.amazonaws.com/test.txt',
        payloadHash: EMPTY_SHA256,
        ...EXAMPLE_CREDENTIALS,
        sessionToken: 'session-token',
        now: new Date('2013-05-24T00:00:00Z'),
    })

    assert.equal(signed['x-amz-security-token'], 'session-token')
    assert.match(signed.authorization, /x-amz-security-token/)
})

test('signing refuses to run without credentials or a payload hash', () => {
    assert.throws(() => signS3Request({ method: 'GET', url: 'https://x.test/', payloadHash: EMPTY_SHA256 }), /credentials/)
    assert.throws(
        () => signS3Request({ method: 'GET', url: 'https://x.test/', ...EXAMPLE_CREDENTIALS }),
        /payload hash/
    )
})

test('AWS URI encoding escapes reserved characters but not the unreserved set', () => {
    assert.equal(awsUriEncode('domains/acmeot'), 'domains%2Facmeot')
    assert.equal(awsUriEncode('domains/acmeot', false), 'domains/acmeot')
    assert.equal(awsUriEncode("a b!c(d)"), 'a%20b%21c%28d%29')
    assert.equal(awsUriEncode('-_.~AZaz09'), '-_.~AZaz09')
})

test('timestamps format as the amz date and its day stamp', () => {
    assert.deepEqual(formatAmzTimestamps(new Date('2024-01-02T03:04:05Z')), {
        amzDate: '20240102T030405Z',
        dateStamp: '20240102',
    })
})

test('the GCS service-account assertion is a verifiable RS256 JWT', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const issuedAt = 1_700_000_000

    const jwt = buildGcsServiceAccountJwt({
        clientEmail: 'files@practice.iam.gserviceaccount.com',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        scope: 'https://www.googleapis.com/auth/devstorage.read_write',
        issuedAt,
        expiresInSeconds: 900,
    })

    const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
    assert.equal(encodedHeader && encodedPayload && encodedSignature ? jwt.split('.').length : 0, 3)

    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' })
    assert.equal(payload.iss, 'files@practice.iam.gserviceaccount.com')
    assert.equal(payload.aud, 'https://oauth2.googleapis.com/token')
    assert.equal(payload.scope, 'https://www.googleapis.com/auth/devstorage.read_write')
    assert.equal(payload.iat, issuedAt)
    assert.equal(payload.exp, issuedAt + 900)

    const verified = crypto
        .createVerify('RSA-SHA256')
        .update(`${encodedHeader}.${encodedPayload}`)
        .verify(publicKey, Buffer.from(encodedSignature, 'base64url'))
    assert.equal(verified, true)
})
