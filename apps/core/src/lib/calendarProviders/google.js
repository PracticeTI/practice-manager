// Google Calendar provider adapter (read-only busy time).
// Kept free of `@/` imports so the busy parsing can be unit-tested.

export const GOOGLE_CALENDAR_SCOPES = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.readonly',
]

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

export function buildGoogleCalendarAuthUrl({ clientId, redirectUri, state }) {
    const url = new URL(AUTH_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', state)
    return url.toString()
}

export async function exchangeGoogleCalendarCode({
    code,
    clientId,
    clientSecret,
    redirectUri,
}) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || 'Google token exchange failed')
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
        scopes: data.scope || GOOGLE_CALENDAR_SCOPES.join(' '),
    }
}

export async function refreshGoogleCalendarToken({ refreshToken, clientId, clientSecret }) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || 'Google token refresh failed')
    }
    return {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
        refreshToken: data.refresh_token || null,
    }
}

export async function fetchGoogleCalendarEmail({ accessToken }) {
    const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return null
    return data?.email || null
}

export async function fetchGoogleBusyBlocks({ accessToken, from, to }) {
    const response = await fetch(FREEBUSY_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            timeMin: from,
            timeMax: to,
            items: [{ id: 'primary' }],
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error?.message || 'Google free/busy request failed')
    }

    const busy = data?.calendars?.primary?.busy || []
    return busy
        .filter((slot) => slot?.start && slot?.end)
        .map((slot) => ({
            starts_at: slot.start,
            ends_at: slot.end,
            busy_status: 'busy',
            external_event_id: null,
        }))
}
