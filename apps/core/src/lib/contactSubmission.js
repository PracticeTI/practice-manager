import { SignJWT, jwtVerify } from 'jose'
import { normalizeAsanaContactSettings } from '@/lib/asanaContactConfig'

const CONTACT_FORM_AUDIENCE = 'practice-public-contact'
const CONTACT_FORM_ISSUER = 'practice-core'
const CONTACT_FORM_SESSION_TTL_SECONDS = 60 * 60 * 2
export const CONTACT_FORM_MIN_SUBMIT_DELAY_MS = 2500
export const CONTACT_FORM_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const CONTACT_FORM_RATE_LIMIT_MAX_ATTEMPTS = 5

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

function getRateLimitStore() {
    if (!globalThis.__practiceContactRateLimitStore) {
        globalThis.__practiceContactRateLimitStore = new Map()
    }

    return globalThis.__practiceContactRateLimitStore
}

function normalizeSingleLine(value, maxLength) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.slice(0, maxLength)
}

function normalizeMultiLine(value, maxLength) {
    const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
    if (!normalized) return ''
    return normalized.slice(0, maxLength)
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function countUrls(value) {
    const matches = String(value || '').match(/https?:\/\//gi)
    return matches ? matches.length : 0
}

export async function issueContactSessionToken() {
    const issuedAt = Date.now()
    const minSubmitAt = issuedAt + CONTACT_FORM_MIN_SUBMIT_DELAY_MS

    const token = await new SignJWT({ minSubmitAt })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(issuedAt / 1000))
        .setIssuer(CONTACT_FORM_ISSUER)
        .setAudience(CONTACT_FORM_AUDIENCE)
        .setExpirationTime(Math.floor(issuedAt / 1000) + CONTACT_FORM_SESSION_TTL_SECONDS)
        .sign(JWT_SECRET)

    return {
        sessionToken: token,
        minSubmitDelayMs: CONTACT_FORM_MIN_SUBMIT_DELAY_MS
    }
}

export async function verifyContactSessionToken(token) {
    const normalized = String(token || '').trim()
    if (!normalized) {
        throw new Error('Missing contact session token')
    }

    const { payload } = await jwtVerify(normalized, JWT_SECRET, {
        issuer: CONTACT_FORM_ISSUER,
        audience: CONTACT_FORM_AUDIENCE
    })

    const minSubmitAt = Number(payload?.minSubmitAt)
    if (!Number.isFinite(minSubmitAt) || Date.now() < minSubmitAt) {
        throw new Error('Form submitted too quickly')
    }

    return payload
}

export function getClientIp(request) {
    const candidates = [
        request.headers.get('x-forwarded-for'),
        request.headers.get('x-real-ip'),
        request.headers.get('cf-connecting-ip'),
        request.headers.get('x-vercel-forwarded-for')
    ]

    for (const candidate of candidates) {
        const first = String(candidate || '').split(',')[0].trim()
        if (first) return first
    }

    return 'unknown'
}

export function registerContactAttempt(ipAddress) {
    const ip = String(ipAddress || 'unknown').trim() || 'unknown'
    const now = Date.now()
    const cutoff = now - CONTACT_FORM_RATE_LIMIT_WINDOW_MS
    const store = getRateLimitStore()
    const attempts = Array.isArray(store.get(ip)) ? store.get(ip).filter((timestamp) => timestamp >= cutoff) : []

    if (attempts.length >= CONTACT_FORM_RATE_LIMIT_MAX_ATTEMPTS) {
        const retryAfterMs = Math.max(1000, CONTACT_FORM_RATE_LIMIT_WINDOW_MS - (now - attempts[0]))
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
        }
    }

    attempts.push(now)
    store.set(ip, attempts)

    return {
        allowed: true,
        retryAfterSeconds: 0
    }
}

export function validateContactPayload(payload) {
    const fieldErrors = {}
    const sanitized = {
        name: normalizeSingleLine(payload?.name, 120),
        email: normalizeSingleLine(payload?.email, 240).toLowerCase(),
        company: normalizeSingleLine(payload?.company, 120),
        phone: normalizeSingleLine(payload?.phone, 40),
        subject: normalizeSingleLine(payload?.subject, 160),
        message: normalizeMultiLine(payload?.message, 5000),
        companyWebsite: normalizeSingleLine(payload?.companyWebsite, 240)
    }

    if (!sanitized.name || sanitized.name.length < 2) {
        fieldErrors.name = 'Enter your name.'
    }

    if (!sanitized.email || !isValidEmail(sanitized.email)) {
        fieldErrors.email = 'Enter a valid email address.'
    }

    if (!sanitized.subject || sanitized.subject.length < 3) {
        fieldErrors.subject = 'Enter a short subject.'
    }

    if (!sanitized.message || sanitized.message.length < 10) {
        fieldErrors.message = 'Enter a message with at least 10 characters.'
    }

    if (countUrls(sanitized.message) > 3) {
        fieldErrors.message = 'Message contains too many links.'
    }

    return {
        isValid: Object.keys(fieldErrors).length === 0,
        fieldErrors,
        sanitized
    }
}

function buildAsanaTaskName(settings, subject) {
    const prefix = normalizeSingleLine(settings?.taskNamePrefix, 80) || 'Website Contact'
    const suffix = normalizeSingleLine(subject, 160)
    return `${prefix}: ${suffix}`.slice(0, 255)
}

function buildAsanaTaskNotes(submission, request) {
    const referer = String(request.headers.get('referer') || '').trim()
    const host = String(request.headers.get('host') || '').trim()

    return [
        `Submitted: ${new Date().toISOString()}`,
        `Name: ${submission.name}`,
        `Email: ${submission.email}`,
        `Company: ${submission.company || 'Not provided'}`,
        `Phone: ${submission.phone || 'Not provided'}`,
        `Host: ${host || 'Unknown'}`,
        `Referrer: ${referer || 'Direct'}`,
        '',
        'Message:',
        submission.message
    ].join('\n')
}

export async function createAsanaContactTask({ settings, submission, request }) {
    const accessToken = String(process.env.ASANA_ACCESS_TOKEN || '').trim()
    if (!accessToken) {
        throw new Error('ASANA_ACCESS_TOKEN is not configured')
    }

    const normalizedSettings = normalizeAsanaContactSettings(settings)
    if (!normalizedSettings.projectGid) {
        throw new Error('Asana destination project is not configured')
    }

    const data = {
        name: buildAsanaTaskName(normalizedSettings, submission.subject),
        notes: buildAsanaTaskNotes(submission, request)
    }

    if (normalizedSettings.sectionGid) {
        data.memberships = [{
            project: normalizedSettings.projectGid,
            section: normalizedSettings.sectionGid
        }]
    } else {
        data.projects = [normalizedSettings.projectGid]
    }

    if (normalizedSettings.assigneeGid) {
        data.assignee = normalizedSettings.assigneeGid
    }

    if (normalizedSettings.tagGids.length > 0) {
        data.tags = normalizedSettings.tagGids
    }

    const response = await fetch('https://app.asana.com/api/1.0/tasks', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        const errorMessage = Array.isArray(payload?.errors)
            ? payload.errors.map((item) => item?.message).filter(Boolean).join('; ')
            : payload?.message

        throw new Error(errorMessage || `Asana API request failed with status ${response.status}`)
    }

    return payload?.data || null
}
