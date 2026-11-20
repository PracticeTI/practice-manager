// OAuth state handling for scheduling calendar connections.
//
// The state is a short-lived HS256 JWT carried in an httpOnly cookie. It binds
// the callback to the admin's domain, practitioner and provider, and records
// the origin used to start the flow so the token exchange uses the same
// redirect URI.

import { SignJWT, jwtVerify } from 'jose'
import { createHash } from 'crypto'

const STATE_COOKIE = 'scheduling_calendar_oauth_state'
const STATE_TTL_SECONDS = 600

function getKey() {
    const secret = String(
        process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
        || process.env.SCHEDULING_TOKEN_ENCRYPTION_KEY
        || process.env.JWT_SECRET
        || ''
    ).trim()
    if (!secret) {
        throw new Error('JWT_SECRET or CALENDAR_TOKEN_ENCRYPTION_KEY is required for calendar OAuth')
    }
    return createHash('sha256').update(secret).digest()
}

export async function createCalendarOAuthState({ domain, practitionerId, provider, origin }) {
    return new SignJWT({ domain, practitionerId, provider, origin })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${STATE_TTL_SECONDS}s`)
        .sign(getKey())
}

export async function verifyCalendarOAuthState(token) {
    if (!token) return null
    try {
        const { payload } = await jwtVerify(token, getKey())
        return payload || null
    } catch {
        return null
    }
}

function cookieSecurity(requestUrl) {
    const isHttps = String(requestUrl?.protocol || '').toLowerCase() === 'https:'
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        path: '/',
    }
}

export function setCalendarOAuthStateCookie(response, token, requestUrl) {
    response.cookies.set(STATE_COOKIE, token, {
        ...cookieSecurity(requestUrl),
        maxAge: STATE_TTL_SECONDS,
    })
}

export function clearCalendarOAuthStateCookie(response, requestUrl) {
    response.cookies.set(STATE_COOKIE, '', {
        ...cookieSecurity(requestUrl),
        maxAge: 0,
    })
}

export function readCalendarOAuthState(request) {
    return request.cookies.get(STATE_COOKIE)?.value || ''
}

export function resolveRequestOrigin(request) {
    const requestUrl = new URL(request.url)
    const host = request.headers.get('x-forwarded-host')
        || request.headers.get('host')
        || requestUrl.host
    const protocol = request.headers.get('x-forwarded-proto')
        || requestUrl.protocol.replace(':', '')
        || 'http'
    return `${protocol}://${host}`
}

export function buildCalendarRedirectUri(provider, origin) {
    const envName = provider === 'google'
        ? 'GOOGLE_CALENDAR_REDIRECT_URI'
        : 'MICROSOFT_CALENDAR_REDIRECT_URI'
    const configured = String(process.env[envName] || '').trim()
    if (configured) return configured
    return `${origin}/api/scheduling/calendar/oauth/${provider}/callback`
}
