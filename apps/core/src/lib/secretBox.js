// Encryption for third-party OAuth refresh/access tokens stored in Postgres.
//
// AES-256-GCM with a random IV per value. The key is derived from
// CALENDAR_TOKEN_ENCRYPTION_KEY (or SCHEDULING_TOKEN_ENCRYPTION_KEY, falling
// back to JWT_SECRET). Ciphertext format:
//
//   v1.<iv base64url>.<ciphertext base64url>.<tag base64url>

import crypto from 'node:crypto'

function getSecret() {
    return String(
        process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
        || process.env.SCHEDULING_TOKEN_ENCRYPTION_KEY
        || process.env.JWT_SECRET
        || ''
    ).trim()
}

function getKey() {
    const secret = getSecret()
    if (!secret) {
        throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY, SCHEDULING_TOKEN_ENCRYPTION_KEY or JWT_SECRET must be configured')
    }
    return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(value) {
    if (value === null || value === undefined) return null
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
    const ciphertext = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`
}

export function decryptSecret(payload) {
    if (!payload) return null
    const parts = String(payload).split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') return null

    try {
        const iv = Buffer.from(parts[1], 'base64url')
        const ciphertext = Buffer.from(parts[2], 'base64url')
        const tag = Buffer.from(parts[3], 'base64url')
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]).toString('utf8')
    } catch {
        return null
    }
}
