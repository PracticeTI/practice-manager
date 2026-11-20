import { NextResponse } from 'next/server'
import {
    getAdminNotificationEmail,
    getAdminNotificationPreferences,
    getDomainContactRecipient,
    resolveAdminNotificationScope,
    updateAdminNotificationPreferences,
} from '@/lib/adminNotifications.js'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_IDS } from '@/lib/notificationTypes.js'
import { resolveDomainModeFromHeaders } from '@/lib/domainMode.js'

/**
 * Which domain's notification defaults apply to this admin. A domain-scoped
 * admin is pinned to their own domain; a fleet-wide admin inherits the domain
 * of the site they are looking at, which is what the panel is showing.
 */
function resolvePreferencesDomain(request, scope) {
    if (scope.domain) return scope.domain
    return resolveDomainModeFromHeaders(request.headers)
}

/**
 * Validate an incoming preferences patch: known type ids only, booleans only.
 * Partial patches are fine - omitted types keep their stored value.
 */
function normalizePatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: 'preferences must be an object keyed by notification type' }
    }

    const patch = {}

    for (const [rawId, enabled] of Object.entries(value)) {
        const id = String(rawId || '').trim()
        if (!NOTIFICATION_TYPE_IDS.includes(id)) {
            return { error: `Unknown notification type: ${id}` }
        }
        if (typeof enabled !== 'boolean') {
            return { error: `Notification preference for "${id}" must be a boolean` }
        }
        patch[id] = enabled
    }

    return { patch }
}

export async function GET(request) {
    const scope = await resolveAdminNotificationScope(request)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    try {
        const domain = resolvePreferencesDomain(request, scope)
        const [preferences, email, contactRecipient] = await Promise.all([
            getAdminNotificationPreferences(scope.username, { domain }),
            getAdminNotificationEmail(scope.username),
            getDomainContactRecipient(domain),
        ])
        return NextResponse.json({
            username: scope.username,
            domain,
            email,
            // Named by the panel for domain-addressed alerts, so an admin can see
            // which inbox those reach instead of only being told it is "the site's".
            contactRecipient,
            types: NOTIFICATION_TYPES,
            preferences,
        })
    } catch (error) {
        console.error('Load notification preferences error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function PUT(request) {
    const scope = await resolveAdminNotificationScope(request)
    if (scope.error) {
        return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const body = await request.json().catch(() => null)
    const { patch, error: validationError } = normalizePatch(body?.preferences)
    if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
    }

    try {
        const preferences = await updateAdminNotificationPreferences(scope.username, patch, {
            domain: resolvePreferencesDomain(request, scope),
        })
        return NextResponse.json({ username: scope.username, preferences })
    } catch (error) {
        console.error('Update notification preferences error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
