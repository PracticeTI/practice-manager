import { NextResponse } from 'next/server'
import {
    getAdminNotificationLastSeenAt,
    listAdminNotifications,
    markAdminNotificationsSeen,
    resolveAdminNotificationScope,
} from '@/lib/adminNotifications.js'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

function parseLimit(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
    return Math.min(parsed, MAX_LIMIT)
}

export async function GET(request) {
    const scope = await resolveAdminNotificationScope(request)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const limit = parseLimit(new URL(request.url).searchParams.get('limit'))

    try {
        const [notifications, lastSeenAt] = await Promise.all([
            listAdminNotifications({ domain: scope.domain, limit }),
            // The marker uses the feed's own scope, so a fleet-wide feed keeps a
            // fleet-wide read position.
            getAdminNotificationLastSeenAt(scope.username, { domain: scope.domain }),
        ])

        const lastSeenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : 0
        const unreadCount = lastSeenAt
            ? notifications.filter((item) => new Date(item.timestamp).getTime() > lastSeenTime).length
            : notifications.length

        return NextResponse.json({
            domain: scope.domain,
            username: scope.username,
            lastSeenAt,
            unreadCount,
            // The feed is windowed, so an unread count equal to the window size
            // means "at least this many" rather than the exact total.
            windowTruncated: notifications.length >= limit,
            notifications,
        })
    } catch (error) {
        console.error('Load admin notifications error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(request) {
    const scope = await resolveAdminNotificationScope(request)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const body = await request.json().catch(() => ({}))

    if (body?.action !== 'mark-seen') {
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    try {
        const lastSeenAt = await markAdminNotificationsSeen(scope.username, new Date(), { domain: scope.domain })
        return NextResponse.json({ success: true, lastSeenAt })
    } catch (error) {
        console.error('Mark admin notifications seen error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
