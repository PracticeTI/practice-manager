'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getOrCreateAdminTokenForLocalhost, getCurrentUser } from '@/lib/clientAdminAuth'
import {
    DEFAULT_ADMIN_ROLE,
    adminRoleRequiresDomain,
    getAdminRoleLabel,
    getAssignableAdminRoles,
    isAssignableAdminRole,
    normalizeAdminRole,
} from '@/lib/adminRoles'

export default function AdminUsersPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [users, setUsers] = useState([])
    const [fetchError, setFetchError] = useState(null)

    // Create form state
    const [formUsername, setFormUsername] = useState('')
    const [formPassword, setFormPassword] = useState('')
    const [formRole, setFormRole] = useState(DEFAULT_ADMIN_ROLE)
    const [formDomain, setFormDomain] = useState('')
    const [formEmail, setFormEmail] = useState('')
    const [formTimezone, setFormTimezone] = useState('')
    const [formError, setFormError] = useState('')
    const [formSuccess, setFormSuccess] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // Inline profile editing
    const [editingId, setEditingId] = useState(null)
    const [editRole, setEditRole] = useState(DEFAULT_ADMIN_ROLE)
    const [editDomain, setEditDomain] = useState('')
    const [editEmail, setEditEmail] = useState('')
    const [editTimezone, setEditTimezone] = useState('')
    const [editError, setEditError] = useState('')
    const [savingId, setSavingId] = useState(null)

    // Delete confirmation
    const [deletingId, setDeletingId] = useState(null)

    const timeZoneOptions = useMemo(() => {
        try {
            return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
        } catch {
            return []
        }
    }, [])

    const assignableRoles = useMemo(() => getAssignableAdminRoles(), [])
    const formNeedsDomain = adminRoleRequiresDomain(formRole)
    const editNeedsDomain = adminRoleRequiresDomain(editRole)

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token) {
                router.push('/login')
                return
            }

            const user = getCurrentUser()
            if (!user || user.role !== 'superadmin') {
                setLoading(false)
                setIsSuperAdmin(false)
                return
            }

            setIsSuperAdmin(true)
            await loadUsers(token)
            if (!cancelled) setLoading(false)
        }

        bootstrap()
        return () => { cancelled = true }
    }, [router])

    async function loadUsers(token) {
        token = token || window.localStorage.getItem('adminToken')
        try {
            const res = await fetch('/api/auth/users', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                setFetchError(data.error || `HTTP ${res.status}`)
                return
            }
            const data = await res.json()
            setUsers(data.users || [])
            setFetchError(null)
        } catch (err) {
            setFetchError(err.message)
        }
    }

    async function handleCreate(e) {
        e.preventDefault()
        setFormError('')
        setFormSuccess('')
        setSubmitting(true)

        const token = window.localStorage.getItem('adminToken')

        try {
            const res = await fetch('/api/auth/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    username: formUsername.trim(),
                    password: formPassword,
                    role: formRole,
                    domain: formNeedsDomain ? formDomain.trim() : '',
                    email: formEmail.trim(),
                    timezone: formTimezone.trim(),
                }),
            })

            const data = await res.json()

            if (!res.ok) {
                setFormError(data.error || 'Failed to create user')
                return
            }

            setFormSuccess(`Admin user "${data.user.username}" created (${getAdminRoleLabel(data.user.role)}, domain: ${data.user.domain})`)
            setFormUsername('')
            setFormPassword('')
            setFormRole(DEFAULT_ADMIN_ROLE)
            setFormDomain('')
            setFormEmail('')
            setFormTimezone('')
            await loadUsers(token)
        } catch (err) {
            setFormError(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    function startEdit(user) {
        const storedRole = normalizeAdminRole(user.role)
        setEditingId(user.id)
        setEditRole(isAssignableAdminRole(storedRole) ? storedRole : DEFAULT_ADMIN_ROLE)
        setEditDomain(user.domain || '')
        setEditEmail(user.email || '')
        setEditTimezone(user.timezone || '')
        setEditError('')
    }

    function cancelEdit() {
        setEditingId(null)
        setEditRole(DEFAULT_ADMIN_ROLE)
        setEditDomain('')
        setEditEmail('')
        setEditTimezone('')
        setEditError('')
    }

    async function handleSaveProfile(id) {
        setSavingId(id)
        setEditError('')

        const token = window.localStorage.getItem('adminToken')

        try {
            const res = await fetch(`/api/auth/users/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    role: editRole,
                    domain: editNeedsDomain ? editDomain.trim() : '',
                    email: editEmail.trim(),
                    timezone: editTimezone.trim(),
                }),
            })

            const data = await res.json().catch(() => ({}))

            if (!res.ok) {
                setEditError(data.error || 'Failed to update profile')
                return
            }

            setUsers(prev => prev.map(u => (u.id === id ? data.user : u)))
            cancelEdit()
        } catch (err) {
            setEditError(err.message)
        } finally {
            setSavingId(null)
        }
    }

    async function handleDelete(id, username) {
        if (!window.confirm(`Delete admin user "${username}"? This cannot be undone.`)) return

        setDeletingId(id)
        const token = window.localStorage.getItem('adminToken')

        try {
            const res = await fetch(`/api/auth/users/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                alert(data.error || 'Failed to delete user')
                return
            }

            await loadUsers(token)
        } catch (err) {
            alert(err.message)
        } finally {
            setDeletingId(null)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-gray-500 text-sm">Loading…</div>
            </div>
        )
    }

    if (!isSuperAdmin) {
        return (
            <div className="min-h-screen bg-gray-50">
                <AdminHeader title="Users" />
                <main className="max-w-2xl mx-auto px-4 py-16 text-center">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-8">
                        <h2 className="text-lg font-semibold text-red-800 mb-2">Access Denied</h2>
                        <p className="text-red-600 text-sm">Only superadmin users can manage admin accounts.</p>
                    </div>
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Users" />

            <main className="max-w-5xl mx-auto px-4 py-10 space-y-10">

                {/* Create new admin user */}
                <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                    <h2 className="text-base font-semibold text-gray-900 mb-1">Add admin user</h2>
                    <p className="text-xs text-gray-500 mb-5">
                        A <strong className="font-medium text-gray-700">domain admin</strong> can only access the admin panel from
                        hostnames that include their assigned domain name (e.g. domain{' '}
                        <code className="bg-gray-100 px-1 rounded">acme</code> matches{' '}
                        <code className="bg-gray-100 px-1 rounded">acme.local</code> and{' '}
                        <code className="bg-gray-100 px-1 rounded">www.acme.com.au</code>). Inside that domain they edit only
                        user-level settings — their own profile and notification preferences; domain settings stay
                        superadmin-only. See <code className="bg-gray-100 px-1 rounded">src/lib/adminRoles.js</code> for the role
                        registry.
                    </p>

                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
                                <input
                                    type="text"
                                    value={formUsername}
                                    onChange={e => setFormUsername(e.target.value)}
                                    placeholder="traff"
                                    autoComplete="off"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                                <input
                                    type="password"
                                    value={formPassword}
                                    onChange={e => setFormPassword(e.target.value)}
                                    placeholder="Min 6 characters"
                                    autoComplete="new-password"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="admin-user-create-role" className="block text-xs font-medium text-gray-700 mb-1">Role</label>
                                <select
                                    id="admin-user-create-role"
                                    value={formRole}
                                    onChange={e => setFormRole(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                                >
                                    {assignableRoles.map(role => (
                                        <option key={role.value} value={role.value}>{role.label}</option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-gray-500">
                                    {assignableRoles.find(role => role.value === formRole)?.description}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Domain</label>
                                <input
                                    type="text"
                                    value={formNeedsDomain ? formDomain : ''}
                                    onChange={e => setFormDomain(e.target.value)}
                                    placeholder={formNeedsDomain ? 'acme' : 'Not used'}
                                    autoComplete="off"
                                    disabled={!formNeedsDomain}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-400"
                                    required={formNeedsDomain}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
                                <input
                                    type="email"
                                    value={formEmail}
                                    onChange={e => setFormEmail(e.target.value)}
                                    placeholder="name@example.com"
                                    autoComplete="off"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
                                <input
                                    type="text"
                                    list="admin-user-timezones"
                                    value={formTimezone}
                                    onChange={e => setFormTimezone(e.target.value)}
                                    placeholder="Australia/Sydney"
                                    autoComplete="off"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                />
                            </div>
                        </div>

                        {formError && (
                            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
                        )}
                        {formSuccess && (
                            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{formSuccess}</p>
                        )}

                        <datalist id="admin-user-timezones">
                            {timeZoneOptions.map(zone => (
                                <option key={zone} value={zone} />
                            ))}
                        </datalist>

                        <div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting ? 'Creating…' : 'Create admin user'}
                            </button>
                        </div>
                    </form>
                </section>

                {/* Existing admin users */}
                <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                    <h2 className="text-base font-semibold text-gray-900 mb-4">Admin users</h2>

                    {fetchError && (
                        <p className="text-xs text-red-600 mb-4">{fetchError}</p>
                    )}

                    {editError && (
                        <p className="text-xs text-red-600 mb-4">{editError}</p>
                    )}

                    {users.length === 0 && !fetchError ? (
                        <p className="text-sm text-gray-400">No domain-scoped admin users yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left text-xs font-medium text-gray-500 py-2 pr-4">Username</th>
                                        <th className="text-left text-xs font-medium text-gray-500 py-2 pr-4">Role</th>
                                        <th className="text-left text-xs font-medium text-gray-500 py-2 pr-4">Domain</th>
                                        <th className="text-left text-xs font-medium text-gray-500 py-2 pr-4">Email address</th>
                                        <th className="text-left text-xs font-medium text-gray-500 py-2 pr-4">Timezone</th>
                                        <th className="text-left text-xs font-medium text-gray-500 py-2">Created</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id} className="border-b border-gray-50 last:border-0">
                                            <td className="py-2.5 pr-4 font-mono text-gray-900">{u.username}</td>
                                            <td className="py-2.5 pr-4">
                                                {editingId === u.id ? (
                                                    <select
                                                        value={editRole}
                                                        onChange={e => setEditRole(e.target.value)}
                                                        aria-label={`Role for ${u.username}`}
                                                        className="w-full min-w-40 px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                                                    >
                                                        {assignableRoles.map(role => (
                                                            <option key={role.value} value={role.value}>{role.label}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                                                        {getAdminRoleLabel(u.role)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2.5 pr-4 text-gray-600 font-mono">
                                                {editingId === u.id ? (
                                                    <input
                                                        type="text"
                                                        value={editNeedsDomain ? editDomain : ''}
                                                        onChange={e => setEditDomain(e.target.value)}
                                                        placeholder={editNeedsDomain ? 'acme' : 'Not used'}
                                                        autoComplete="off"
                                                        disabled={!editNeedsDomain}
                                                        aria-label={`Domain for ${u.username}`}
                                                        className="w-full min-w-36 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-400"
                                                    />
                                                ) : (
                                                    u.domain || '—'
                                                )}
                                            </td>

                                            {editingId === u.id ? (
                                                <>
                                                    <td className="py-2.5 pr-4">
                                                        <input
                                                            type="email"
                                                            value={editEmail}
                                                            onChange={e => setEditEmail(e.target.value)}
                                                            placeholder="name@example.com"
                                                            autoComplete="off"
                                                            aria-label={`Email address for ${u.username}`}
                                                            className="w-full min-w-44 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                                        />
                                                    </td>
                                                    <td className="py-2.5 pr-4">
                                                        <input
                                                            type="text"
                                                            list="admin-user-timezones"
                                                            value={editTimezone}
                                                            onChange={e => setEditTimezone(e.target.value)}
                                                            placeholder="Australia/Sydney"
                                                            autoComplete="off"
                                                            aria-label={`Timezone for ${u.username}`}
                                                            className="w-full min-w-44 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                                                        />
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="py-2.5 pr-4 text-gray-600">{u.email || '—'}</td>
                                                    <td className="py-2.5 pr-4 text-gray-600 font-mono">{u.timezone || '—'}</td>
                                                </>
                                            )}

                                            <td className="py-2.5 text-gray-400 text-xs">
                                                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                                            </td>
                                            <td className="py-2.5 pl-4 text-right whitespace-nowrap">
                                                {editingId === u.id ? (
                                                    <>
                                                        <button
                                                            onClick={() => handleSaveProfile(u.id)}
                                                            disabled={savingId === u.id}
                                                            className="text-xs font-medium text-gray-900 hover:text-gray-600 disabled:opacity-40"
                                                        >
                                                            {savingId === u.id ? 'Saving…' : 'Save'}
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            disabled={savingId === u.id}
                                                            className="ml-3 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => startEdit(u)}
                                                            className="text-xs text-gray-600 hover:text-gray-900"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(u.id, u.username)}
                                                            disabled={deletingId === u.id}
                                                            className="ml-3 text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                                                        >
                                                            {deletingId === u.id ? 'Deleting…' : 'Delete'}
                                                        </button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="mt-6 pt-4 border-t border-gray-100">
                        <p className="text-xs text-gray-400">
                            The primary superadmin is configured via the <code className="bg-gray-100 px-1 rounded">ADMIN_USERNAME</code> /
                            {' '}<code className="bg-gray-100 px-1 rounded">ADMIN_PASSWORD</code> environment variables and is not listed here.
                            Roles are defined in <code className="bg-gray-100 px-1 rounded">src/lib/adminRoles.js</code>; only a
                            domain admin carries a domain.
                        </p>
                    </div>
                </section>

            </main>
        </div>
    )
}
