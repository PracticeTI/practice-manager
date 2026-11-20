'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bell, Check, Inbox, Loader2, MailX, RefreshCw } from 'lucide-react'
import { NOTIFICATION_AUDIENCE, NOTIFICATION_DELIVERY, NOTIFICATION_TYPES, isPerAdminNotificationType } from '@/lib/notificationTypes'
import { resolveAdminAuthToken } from '@/lib/clientAdminAuth'

const FEED_LIMIT = 25
const FEED_CACHE_TTL_MS = 60 * 1000

// Types the panel offers a switch for. When none exist, nobody has a per-admin
// email to miss, so the "no address" warning would be noise.
const HAS_PER_ADMIN_TYPES = NOTIFICATION_TYPES.some((type) => isPerAdminNotificationType(type.id))

// Module scope so moving between admin pages (each mounts its own AdminHeader)
// reuses the last feed instead of re-hitting the API on every navigation.
let cachedFeed = null
let cacheTimestamp = 0

function formatRelativeTime(isoString) {
    if (!isoString) return ''

    const timestamp = new Date(isoString).getTime()
    if (!Number.isFinite(timestamp)) return ''

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`

    return new Date(timestamp).toLocaleDateString()
}

async function fetchAdminJson(path, options = {}) {
    const token = await resolveAdminAuthToken()
    if (!token) throw new Error('Your admin session has expired. Sign in again.')

    const response = await fetch(path, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error || `Request failed (HTTP ${response.status})`)
    }

    return data
}

function NotificationRow({ item, isNew, onOpen }) {
    return (
        <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex w-full items-start gap-2 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50"
        >
            <span
                aria-hidden="true"
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.severity === 'error' ? 'bg-red-500' : isNew ? 'bg-gray-800' : 'bg-transparent'
                }`}
            />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-800">{item.title}</span>
                {item.summary && <span className="mt-0.5 block truncate text-xs text-gray-500">{item.summary}</span>}
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
                    {formatRelativeTime(item.timestamp)}
                    {item.domain ? ` · ${item.domain}` : ''}
                    {item.emailSuppressed && (
                        <span
                            className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500"
                            title="Recorded here only — the email alert is turned off for this type"
                        >
                            <MailX className="h-2.5 w-2.5" />
                            Email off
                        </span>
                    )}
                </span>
            </span>
            {item.severity === 'error' && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
        </button>
    )
}

/**
 * Where a type's alerts go, and therefore what an admin can do about them here.
 *
 * A panel-only type sends nothing. A domain-addressed alert goes to the inbox
 * the site configured, which is a domain setting rather than a per-admin one. An
 * admin-addressed alert is the only one that is genuinely theirs to turn off.
 */
function describeDelivery(type, { preferenceEmail, contactRecipient } = {}) {
    if (type.delivery === NOTIFICATION_DELIVERY.PANEL) {
        return 'Panel only — no email is sent for this.'
    }

    if (type.audience === NOTIFICATION_AUDIENCE.ADMINS) {
        return preferenceEmail ? `Emails you at ${preferenceEmail}.` : ''
    }

    return contactRecipient
        ? `Goes to ${contactRecipient}, the site's contact inbox — set up or turned off in Settings → Domains.`
        : 'No contact inbox is configured yet (Settings → Domains), so nothing is emailed.'
}

function NotificationText({ label, description, hint }) {
    return (
        <div className="min-w-0">
            <p className="text-sm text-gray-800">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{description}</p>
            {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
        </div>
    )
}

function NotificationToggle({ label, description, deliveryHint, enabled, saving, onToggle }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <NotificationText label={label} description={description} hint={deliveryHint} />
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={label}
                disabled={saving}
                onClick={() => onToggle(!enabled)}
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    enabled ? 'bg-gray-800' : 'bg-gray-300'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                />
            </button>
        </div>
    )
}

export default function AdminNotificationBell() {
    const router = useRouter()
    const containerRef = useRef(null)

    const [open, setOpen] = useState(false)
    const [tab, setTab] = useState('activity')

    const [feed, setFeed] = useState(() => cachedFeed?.notifications || [])
    const [unreadCount, setUnreadCount] = useState(() => cachedFeed?.unreadCount || 0)
    const [newSinceAt, setNewSinceAt] = useState(() => cachedFeed?.lastSeenAt ?? null)
    const [feedLoading, setFeedLoading] = useState(false)
    const [feedError, setFeedError] = useState('')

    const [preferences, setPreferences] = useState(null)
    const [preferenceEmail, setPreferenceEmail] = useState(null)
    const [contactRecipient, setContactRecipient] = useState(null)
    const [preferencesLoading, setPreferencesLoading] = useState(false)
    const [preferencesError, setPreferencesError] = useState('')
    const [savingTypeId, setSavingTypeId] = useState(null)
    const [preferencesSaved, setPreferencesSaved] = useState(false)

    const loadFeed = useCallback(async ({ force = false } = {}) => {
        if (!force && cachedFeed && Date.now() - cacheTimestamp < FEED_CACHE_TTL_MS) {
            setFeed(cachedFeed.notifications || [])
            setUnreadCount(cachedFeed.unreadCount || 0)
            setNewSinceAt(cachedFeed.lastSeenAt ?? null)
            return true
        }

        setFeedLoading(true)
        setFeedError('')

        try {
            const data = await fetchAdminJson(`/api/admin/notifications?limit=${FEED_LIMIT}`)
            cachedFeed = data
            cacheTimestamp = Date.now()
            setFeed(data.notifications || [])
            setUnreadCount(data.unreadCount || 0)
            setNewSinceAt(data.lastSeenAt ?? null)
            return true
        } catch (error) {
            setFeedError(error.message)
            return false
        } finally {
            setFeedLoading(false)
        }
    }, [])

    const markSeen = useCallback(async () => {
        try {
            await fetchAdminJson('/api/admin/notifications', {
                method: 'POST',
                body: JSON.stringify({ action: 'mark-seen' }),
            })
            setUnreadCount(0)
            if (cachedFeed) cachedFeed = { ...cachedFeed, unreadCount: 0 }
        } catch {
            // Leave the badge in place; the next successful load will settle it.
        }
    }, [])

    const loadPreferences = useCallback(async () => {
        setPreferencesLoading(true)
        setPreferencesError('')

        try {
            const data = await fetchAdminJson('/api/admin/notification-preferences')
            setPreferences(data.preferences || {})
            setPreferenceEmail(data.email || null)
            setContactRecipient(data.contactRecipient || null)
            setPreferencesSaved(false)
        } catch (error) {
            setPreferencesError(error.message)
        } finally {
            setPreferencesLoading(false)
        }
    }, [])

    useEffect(() => {
        // Deferred so the cached-value branch can hydrate without a synchronous
        // setState inside the effect body.
        const timeoutId = window.setTimeout(() => {
            loadFeed()
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [loadFeed])

    useEffect(() => {
        if (!open) return undefined

        function handlePointerDown(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false)
            }
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    const handleOpen = () => {
        if (open) {
            setOpen(false)
            return
        }

        setOpen(true)
        // Only clear the badge once the feed actually loaded, so a failed request
        // does not silently swallow the unread count.
        loadFeed({ force: true }).then((loaded) => {
            if (loaded) markSeen()
        })
    }

    const handleSelectTab = (nextTab) => {
        setTab(nextTab)
        if (nextTab === 'settings' && !preferences && !preferencesLoading) {
            loadPreferences()
        }
    }

    const handleToggleType = async (typeId, nextEnabled) => {
        const previous = preferences
        setSavingTypeId(typeId)
        setPreferencesError('')
        setPreferences((current) => ({ ...current, [typeId]: nextEnabled }))

        try {
            const data = await fetchAdminJson('/api/admin/notification-preferences', {
                method: 'PUT',
                body: JSON.stringify({ preferences: { [typeId]: nextEnabled } }),
            })
            setPreferences(data.preferences || previous)
            setPreferencesSaved(true)
        } catch (error) {
            setPreferences(previous)
            setPreferencesError(error.message)
        } finally {
            setSavingTypeId(null)
        }
    }

    const handleNotificationOpen = (item) => {
        setOpen(false)
        router.push(item.href || '/admin')
    }

    const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount)

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={handleOpen}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                title="Notifications"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
                <Bell className="h-4 w-4" strokeWidth={1.75} />
                {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">
                        {badgeLabel}
                    </span>
                )}
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                >
                    <div className="flex items-center gap-1 border-b border-gray-200 px-2 pt-2">
                        {[
                            { id: 'activity', label: 'Notifications' },
                            { id: 'settings', label: 'Emails' },
                        ].map((entry) => (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => handleSelectTab(entry.id)}
                                className={`rounded-t px-3 py-1.5 text-xs font-medium transition-colors ${
                                    tab === entry.id
                                        ? 'border-b-2 border-gray-800 text-gray-900'
                                        : 'border-b-2 border-transparent text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {entry.label}
                            </button>
                        ))}
                        {tab === 'activity' && (
                            <button
                                type="button"
                                onClick={() => loadFeed({ force: true })}
                                disabled={feedLoading}
                                aria-label="Refresh notifications"
                                title="Refresh"
                                className="ml-auto mb-1 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${feedLoading ? 'animate-spin' : ''}`} />
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {tab === 'activity' ? (
                            <>
                                {feedLoading && feed.length === 0 && (
                                    <p className="flex items-center gap-2 px-4 py-6 text-xs text-gray-500">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Loading notifications…
                                    </p>
                                )}

                                {!feedLoading && feedError && (
                                    <p className="px-4 py-6 text-xs text-red-600">{feedError}</p>
                                )}

                                {!feedError && feed.length === 0 && !feedLoading && (
                                    <div className="px-4 py-8 text-center">
                                        <Inbox className="mx-auto h-5 w-5 text-gray-300" />
                                        <p className="mt-2 text-xs text-gray-500">No activity yet.</p>
                                        <p className="mt-1 text-[11px] text-gray-400">
                                            Contact form enquiries, emails, chats, and delivery problems will show up here.
                                        </p>
                                    </div>
                                )}

                                {feed.map((item) => (
                                    <NotificationRow
                                        key={item.id}
                                        item={item}
                                        isNew={!newSinceAt || new Date(item.timestamp).getTime() > new Date(newSinceAt).getTime()}
                                        onOpen={handleNotificationOpen}
                                    />
                                ))}
                            </>
                        ) : (
                            <div className="space-y-4 px-4 py-4">
                                {!preferenceEmail && preferences && HAS_PER_ADMIN_TYPES && (
                                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                                        <p className="text-xs text-amber-800">
                                            Your admin account has no email address, so alerts addressed to you cannot be
                                            emailed. Add one under Admin → Users, or ask a superadmin to set it.
                                        </p>
                                    </div>
                                )}

                                {preferencesLoading && !preferences && (
                                    <p className="flex items-center gap-2 text-xs text-gray-500">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Loading settings…
                                    </p>
                                )}

                                {preferences && NOTIFICATION_TYPES.map((type) => {
                                    const deliveryHint = describeDelivery(type, { preferenceEmail, contactRecipient })

                                    // Only an alert addressed to the admin is theirs to
                                    // turn off; the rest are described, so no switch is
                                    // offered that could not change anything.
                                    if (!isPerAdminNotificationType(type.id)) {
                                        return (
                                            <NotificationText
                                                key={type.id}
                                                label={type.label}
                                                description={type.description}
                                                hint={deliveryHint}
                                            />
                                        )
                                    }

                                    return (
                                        <NotificationToggle
                                            key={type.id}
                                            label={type.label}
                                            description={type.description}
                                            deliveryHint={deliveryHint}
                                            enabled={preferences[type.id] !== false}
                                            saving={savingTypeId === type.id}
                                            onToggle={(nextEnabled) => handleToggleType(type.id, nextEnabled)}
                                        />
                                    )
                                })}

                                {preferencesError && <p className="text-xs text-red-600">{preferencesError}</p>}

                                {preferencesSaved && !preferencesError && !savingTypeId && (
                                    <p className="flex items-center gap-1 text-xs text-emerald-600">
                                        <Check className="h-3.5 w-3.5" />
                                        Saved
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
