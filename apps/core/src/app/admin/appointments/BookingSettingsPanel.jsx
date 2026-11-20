'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'

const DEFAULT_SETTINGS = {
    enabled: false,
    minNoticeMinutes: 120,
    maxAdvanceDays: 60,
    slotIntervalMinutes: 30,
    introText: '',
    contactNote: '',
    requireConsent: true,
    notificationEmail: '',
}

export default function BookingSettingsPanel({ domain, getAuthHeaders }) {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (!domain) return
            setLoading(true)
            try {
                const headers = await getAuthHeaders()
                const response = await fetch(`/api/database/booking-settings?domain=${encodeURIComponent(domain)}`, {
                    headers,
                    cache: 'no-store',
                })
                const payload = await response.json().catch(() => ({}))
                if (cancelled) return
                if (!response.ok || payload.success === false) {
                    setError(payload.error || 'Failed to load booking settings')
                    return
                }
                setSettings({ ...DEFAULT_SETTINGS, ...(payload.data || {}) })
            } catch {
                if (!cancelled) setError('Failed to load booking settings')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()
        return () => { cancelled = true }
    }, [domain, getAuthHeaders])

    async function save(event) {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        setError('')
        setMessage('')
        try {
            const headers = await getAuthHeaders()
            const response = await fetch('/api/database/booking-settings', {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, settings }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || payload.success === false) {
                setError(payload.error || 'Failed to save booking settings')
                return
            }
            setSettings({ ...DEFAULT_SETTINGS, ...(payload.data || {}) })
            setMessage('Booking settings saved.')
        } catch {
            setError('Failed to save booking settings')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                        <CalendarClock className="h-5 w-5 text-gray-500" aria-hidden="true" />
                        Online booking
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Visitors book through the public page. Times come from the same availability rules and busy blocks as the calendar.
                    </p>
                </div>
                <a
                    href={`/book?domain=${encodeURIComponent(domain)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                    Preview booking page
                </a>
            </div>

            {loading ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading booking settings…
                </p>
            ) : (
                <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 sm:col-span-2">
                        <input
                            type="checkbox"
                            checked={settings.enabled}
                            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
                        />
                        Accept online bookings
                    </label>

                    <label className="block text-sm">
                        <span className="font-medium text-gray-700">Minimum notice (minutes)</span>
                        <input
                            type="number"
                            min="0"
                            max="10080"
                            step="15"
                            value={settings.minNoticeMinutes}
                            onChange={(event) => setSettings({ ...settings, minNoticeMinutes: event.target.value })}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="block text-sm">
                        <span className="font-medium text-gray-700">Book up to (days ahead)</span>
                        <input
                            type="number"
                            min="1"
                            max="180"
                            value={settings.maxAdvanceDays}
                            onChange={(event) => setSettings({ ...settings, maxAdvanceDays: event.target.value })}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="block text-sm">
                        <span className="font-medium text-gray-700">Slot interval</span>
                        <select
                            value={settings.slotIntervalMinutes}
                            onChange={(event) => setSettings({ ...settings, slotIntervalMinutes: Number(event.target.value) })}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        >
                            {[15, 30, 45, 60].map((value) => (
                                <option key={value} value={value}>{value} minutes</option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <input
                            type="checkbox"
                            checked={settings.requireConsent}
                            onChange={(event) => setSettings({ ...settings, requireConsent: event.target.checked })}
                        />
                        Require contact consent
                    </label>

                    <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-gray-700">Intro text</span>
                        <textarea
                            rows={2}
                            maxLength={600}
                            value={settings.introText}
                            onChange={(event) => setSettings({ ...settings, introText: event.target.value })}
                            placeholder="Shown above the service list."
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-gray-700">Contact note</span>
                        <input
                            maxLength={300}
                            value={settings.contactNote}
                            onChange={(event) => setSettings({ ...settings, contactNote: event.target.value })}
                            placeholder="Shown when online booking is closed, e.g. a phone number."
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-gray-700">Email me when someone books</span>
                        <input
                            type="email"
                            maxLength={180}
                            value={settings.notificationEmail}
                            onChange={(event) => setSettings({ ...settings, notificationEmail: event.target.value })}
                            placeholder="reception@practice.com.au"
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                        <span className="mt-1 block text-xs text-gray-500">
                            Sends the patient&apos;s name, contact details and the booked time. Leave blank for no email.
                        </span>
                    </label>

                    {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
                    {message ? <p className="text-sm text-emerald-700 sm:col-span-2">{message}</p> : null}

                    <div className="sm:col-span-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                            Save booking settings
                        </button>
                    </div>
                </form>
            )}
        </section>
    )
}
