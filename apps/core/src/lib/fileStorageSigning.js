/**
 * Request signing for the object-storage backends, kept free of I/O so the
 * signature can be tested against published vectors.
 *
 * S3 uses Signature Version 4 with static credentials. GCS uses the JSON API with a
 * service-account JWT exchanged for an access token. Both are implemented on
 * `node:crypto` rather than an SDK: the app makes three calls per backend (put, get,
 * delete), and a full cloud SDK is a large dependency for that surface in a Next.js
 * build.
 */

import crypto from 'node:crypto'

/** Percent-encode per the SigV4 rules: everything except the unreserved set. */
export function awsUriEncode(value, encodeSlash = true) {
    const encoded = encodeURIComponent(String(value ?? ''))
        .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    return encodeSlash ? encoded : encoded.replace(/%2F/g, '/')
}

export function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
    return crypto.createHmac('sha256', key).update(value).digest()
}

/** `20130524T000000Z` (amzDate) and `20130524` (dateStamp) in UTC. */
export function formatAmzTimestamps(date = new Date()) {
    const iso = (date instanceof Date ? date : new Date(date)).toISOString()
    const [day] = iso.split('T')
    return {
        amzDate: `${day.replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`,
        dateStamp: day.replace(/-/g, ''),
    }
}

function normalizeCanonicalUri(pathname) {
    const path = String(pathname || '/')
    return path.startsWith('/') ? path : `/${path}`
}

function buildCanonicalQueryString(searchParams) {
    const pairs = []
    searchParams.forEach((value, key) => {
        pairs.push([awsUriEncode(key), awsUriEncode(value)])
    })
    pairs.sort(([aKey, aValue], [bKey, bValue]) => (aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)))
    return pairs.map(([key, value]) => `${key}=${value}`).join('&')
}

function normalizeHeaderValue(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * Build the SigV4 `Authorization` header (plus the `x-amz-*` headers it covers) for
 * one request. `headers` is not mutated.
 */
export function signS3Request({
    method,
    url,
    headers = {},
    payloadHash,
    accessKeyId,
    secretAccessKey,
    sessionToken = '',
    region = 'us-east-1',
    service = 's3',
    now = new Date(),
}) {
    if (!accessKeyId || !secretAccessKey) throw new Error('S3 credentials are required to sign a request')
    if (!payloadHash) throw new Error('A payload hash is required to sign a request')

    const { amzDate, dateStamp } = formatAmzTimestamps(now)
    const target = url instanceof URL ? url : new URL(url)
    const signedHeaderValues = new Map()

    for (const [name, value] of Object.entries(headers || {})) {
        const normalizedName = String(name).toLowerCase()
        if (normalizedName === 'authorization' || normalizedName === 'host') continue
        signedHeaderValues.set(normalizedName, normalizeHeaderValue(value))
    }

    signedHeaderValues.set('host', target.host)
    signedHeaderValues.set('x-amz-content-sha256', payloadHash)
    signedHeaderValues.set('x-amz-date', amzDate)
    if (sessionToken) signedHeaderValues.set('x-amz-security-token', sessionToken)

    const sortedNames = [...signedHeaderValues.keys()].sort()
    const canonicalHeaders = sortedNames
        .map((name) => `${name}:${signedHeaderValues.get(name)}\n`)
        .join('')
    const signedHeaders = sortedNames.join(';')

    const canonicalRequest = [
        String(method || 'GET').toUpperCase(),
        normalizeCanonicalUri(target.pathname),
        buildCanonicalQueryString(target.searchParams),
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n')

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n')

    const signingKey = hmac(
        hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
        'aws4_request'
    )
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    return {
        ...Object.fromEntries(signedHeaderValues),
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    }
}

function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A service-account assertion for the OAuth token endpoint. The caller exchanges it
 * for an access token; nothing here touches the network.
 */
export function buildGcsServiceAccountJwt({
    clientEmail,
    privateKey,
    scope = 'https://www.googleapis.com/auth/devstorage.read_write',
    audience = 'https://oauth2.googleapis.com/token',
    issuedAt = Math.floor(Date.now() / 1000),
    expiresInSeconds = 3600,
}) {
    if (!clientEmail) throw new Error('A service-account email is required')
    if (!privateKey) throw new Error('A service-account private key is required')

    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64UrlEncode(JSON.stringify({
        iss: clientEmail,
        scope,
        aud: audience,
        iat: issuedAt,
        exp: issuedAt + Math.max(60, Number(expiresInSeconds) || 3600),
    }))
    const signingInput = `${header}.${payload}`
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey)

    return `${signingInput}.${base64UrlEncode(signature)}`
}
