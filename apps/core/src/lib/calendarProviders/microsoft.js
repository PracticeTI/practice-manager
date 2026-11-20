// Microsoft 365 / Outlook provider adapter (read-only schedule).
// Graph returns floating dateTime values with a separate timeZone field; when
// we request UTC they can still contain 7 fractional digits, which JavaScript
// Date does not parse consistently, so the value is normalised here.

export const MICROSOFT_CALENDAR_SCOPES = [
    'offline_access',
    'Calendars.Read',
    'User.Read',
]

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export function buildMicrosoftCalendarAuthUrl({
    tenantId = 'common',
    clientId,
    redirectUri,
    state,
}) {
    const url = new URL(`https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/authorize`)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', MICROSOFT_CALENDAR_SCOPES.join(' '))
    url.searchParams.set('state', state)
    return url.toString()
}

function tokenUrl(tenantId) {
    return `https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/token`
}

export async function exchangeMicrosoftCalendarCode({
    code,
    clientId,
    clientSecret,
    redirectUri,
    tenantId = 'common',
}) {
    const response = await fetch(tokenUrl(tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || 'Microsoft token exchange failed')
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
        scopes: data.scope || MICROSOFT_CALENDAR_SCOPES.join(' '),
    }
}

export async function refreshMicrosoftCalendarToken({
    refreshToken,
    clientId,
    clientSecret,
    tenantId = 'common',
}) {
    const response = await fetch(tokenUrl(tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || 'Microsoft token refresh failed')
    }
    return {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
        refreshToken: data.refresh_token || null,
    }
}

export async function fetchMicrosoftCalendarEmail({ accessToken }) {
    const response = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return null
    return data?.mail || data?.userPrincipalName || null
}

export function normalizeGraphDateTime(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const trimmed = text.replace(/(\.\d{3})\d+/, '$1')
    if (/Z$|[+-]\d{2}:\d{2}$/.test(trimmed)) return trimmed
    return `${trimmed}Z`
}

export async function fetchMicrosoftBusyBlocks({ accessToken, from, to }) {
    const response = await fetch(`${GRAPH_BASE}/me/calendar/getSchedule`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'outlook.timezone="UTC"',
        },
        body: JSON.stringify({
            schedules: ['me'],
            startTime: { dateTime: from, timeZone: 'UTC' },
            endTime: { dateTime: to, timeZone: 'UTC' },
            availabilityViewInterval: 15,
        }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error?.message || 'Microsoft calendar schedule request failed')
    }

    const items = data?.value?.[0]?.scheduleItems || []
    return items
        .filter((item) => item?.status && String(item.status).toLowerCase() !== 'free')
        .map((item) => {
            const startsAt = normalizeGraphDateTime(item.start?.dateTime)
            const endsAt = normalizeGraphDateTime(item.end?.dateTime)
            if (!startsAt || !endsAt) return null
            return {
                starts_at: startsAt,
                ends_at: endsAt,
                busy_status: String(item.status).toLowerCase() === 'tentative' ? 'tentative' : 'busy',
                external_event_id: null,
            }
        })
        .filter(Boolean)
}
