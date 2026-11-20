'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getOrCreateAdminTokenForLocalhost, getCurrentUser } from '@/lib/clientAdminAuth'
import { getAdminRoleLabel } from '@/lib/adminRoles'

const TIME_ZONE_OPTIONS = (() => {
    try {
        return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    } catch {
        return []
    }
})()

export default function AdminProfilePage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [profile, setProfile] = useState(null)
    const [loadError, setLoadError] = useState('')
    const [email, setEmail] = useState('')
    const [timezone, setTimezone] = useState('')
    const [saveError, setSaveError] = useState('')
    const [saveSuccess, setSaveSuccess] = useState('')
    const [saving, setSaving] = useState(false)
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token) {
                router.replace('/login')
                return
            }

            setIsSuperAdmin(getCurrentUser()?.role === 'superadmin')

            try {
                const response = await fetch('/api/admin/profile', {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                })
                const data = await response.json().catch(() => ({}))
                if (cancelled) return

                if (!response.ok) {
                    setLoadError(data.error || `HTTP ${response.status}`)
                    return
                }

                setProfile(data.profile || null)
                setEmail(data.profile?.email || '')
                setTimezone(data.profile?.timezone || '')
                setLoadError('')
            } catch (error) {
                if (!cancelled) setLoadError(error.message)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        bootstrap()
        return () => { cancelled = true }
    }, [router])
    async function handleSave(event) {
        event.preventDefault()
        setSaveError('')
        setSaveSuccess('')
        setSaving(true)

        const token = window.localStorage.getItem('adminToken')

        try {
            const response = await fetch('/api/admin/profile', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: email.trim(),
                    timezone: timezone.trim(),
                }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                setSaveError(data.error || 'Failed to save your profile')
                return
            }

            setProfile(data.profile || profile)
            setEmail(data.profile?.email || '')
            setTimezone(data.profile?.timezone || '')
            setSaveSuccess('Your settings were saved.')
        } catch (error) {
            setSaveError(error.message)
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-gray-500 text-sm">Loading…</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Your profile" />

            <main className="max-w-3xl mx-auto px-4 py-10">
                {loadError ? (
                    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                        <h2 className="text-base font-semibold text-gray-900 mb-2">No stored profile</h2>
                        <p className="text-sm text-gray-600">{loadError}</p>
                        {isSuperAdmin && (
                            <p className="mt-2 text-xs text-gray-500">
                                The primary superadmin is configured by environment variables. Manage admin accounts in{' '}
                                <Link href="/admin/users" className="font-medium text-gray-900 underline">Users</Link>.
                            </p>
                        )}
                    </section>
                ) : (
                    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                        <h2 className="text-base font-semibold text-gray-900 mb-1">Your settings</h2>
                        <p className="text-xs text-gray-500 mb-5">
                            These are your own user-level settings for{' '}
                            <code className="bg-gray-100 px-1 rounded">{profile?.domain || 'your domain'}</code>. The email
                            address receives the notifications you opt into; the timezone is how those times are shown to you.
                            Domain settings stay with a superadmin.
                        </p>

                        <dl className="mb-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                            <div>
                                <dt className="text-xs font-medium text-gray-500">Username</dt>
                                <dd className="font-mono text-gray-900">{profile?.username}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-gray-500">Role</dt>
                                <dd className="text-gray-900">{getAdminRoleLabel(profile?.role)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-gray-500">Domain</dt>
                                <dd className="font-mono text-gray-900">{profile?.domain || '—'}</dd>
                            </div>
                        </dl>

                        <form onSubmit={handleSave} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="admin-profile-email" className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
                                    <input
                                        id="admin-profile-email"
                                        type="email"
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        placeholder="name@example.com"
                                        autoComplete="email"
                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="admin-profile-timezone" className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
                                    <input
                                        id="admin-profile-timezone"
                                        type="text"
                                        list="admin-profile-timezones"
                                        value={timezone}
                                        onChange={event => setTimezone(event.target.value)}
                                        placeholder="Australia/Sydney"
                                        autoComplete="off"
                                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                    />
                                </div>
                            </div>

                            <datalist id="admin-profile-timezones">
                                {TIME_ZONE_OPTIONS.map(zone => (
                                    <option key={zone} value={zone} />
                                ))}
                            </datalist>

                            {saveError && (
                                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</p>
                            )}
                            {saveSuccess && (
                                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{saveSuccess}</p>
                            )}

                            <button
                                type="submit"
                                disabled={saving}
                                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving…' : 'Save settings'}
                            </button>
                        </form>
                    </section>
                )}
            </main>
        </div>
    )
}
