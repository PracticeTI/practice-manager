'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { CONTACT_FIELD_LIMITS, isValidContactEmail, resolveContactFields } from '@/lib/contacts'
import { describeAssociationSources } from '@/lib/contactAssociations'
import { buildContactMetrics, contactDisplayName, describeContactSummary, filterContacts, formatContactDateTime } from '@/lib/contactDisplay'
import PatientLinkPicker from '@/admin-ui/components/PatientLinkPicker'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const PAGE_LIMIT = '1000'

// A native datalist opens on focus with no typing, which would drop the whole
// provider/supplier/funder directory onto the field. Only populate it once the
// user has typed a couple of characters so the suggestions are actually filtered.
const ASSOCIATION_SUGGESTION_MIN_CHARS = 2

// Applied to the single row a dashboard card deep-linked to, so the contact is
// easy to spot without the page opening its editor.
const HIGHLIGHTED_ROW_CLASSES = 'bg-amber-50 ring-1 ring-inset ring-amber-300'

const EMPTY_FORM = {
    name: '',
    email: '',
    phone: '',
    association: '',
    role: '',
    notes: '',
    patients: [],
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function SummaryTile({ label, value }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        </div>
    )
}

function FieldLabel({ children }) {
    return <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</span>
}

function ContactsPageContent() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)

    const [contacts, setContacts] = useState([])
    const [loadingContacts, setLoadingContacts] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [searchQuery, setSearchQuery] = useState('')

    const [associationOptions, setAssociationOptions] = useState([])

    // Contact the page was deep-linked to (from a dashboard card row). It is only
    // highlighted in the list and scrolled into view — never opened for editing,
    // so changing it stays an explicit action from the row.
    const [highlightedContactId, setHighlightedContactId] = useState(null)
    const highlightedRowRef = useRef(null)
    const highlightedContactKey = highlightedContactId === null || highlightedContactId === undefined
        ? null
        : String(highlightedContactId)

    const [editorOpen, setEditorOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [formError, setFormError] = useState('')
    const [saving, setSaving] = useState(false)

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    // Returns the rows it loaded so a caller that needs one of them — the dashboard
    // deep link below — does not have to fetch the directory a second time.
    const refreshContacts = useCallback(async (domain) => {
        if (!domain) return []

        setLoadingContacts(true)
        try {
            const query = new URLSearchParams({ domain, limit: PAGE_LIMIT })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/contacts?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load contacts')
            }

            const rows = Array.isArray(data?.data) ? data.data : []
            setContacts(rows)
            return rows
        } catch (error) {
            setContacts([])
            setStatusMessage(error?.message || 'Failed to load contacts')
            setStatusTone('error')
            return []
        } finally {
            setLoadingContacts(false)
        }
    }, [getAdminAuthHeaders])

    // Suggestions are a convenience on top of a free-text field: if the lookup
    // fails the editor still accepts anything the user types.
    const refreshAssociationOptions = useCallback(async (domain) => {
        if (!domain) return

        try {
            const query = new URLSearchParams({ domain })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/contacts/associations?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load association suggestions')
            }

            setAssociationOptions(Array.isArray(data?.associations) ? data.associations : [])
        } catch {
            setAssociationOptions([])
        }
    }, [getAdminAuthHeaders])

    // Defined before the bootstrap effect so the dashboard deep link can reference
    // the highlighted contact from inside it.
    const openCreate = useCallback(() => {
        setHighlightedContactId(null)
        setEditingId(null)
        setForm(EMPTY_FORM)
        setFormError('')
        setEditorOpen(true)
    }, [])

    const openEdit = useCallback((row) => {
        setHighlightedContactId(null)
        setEditingId(row.id)
        setForm({
            name: row.name || '',
            email: row.email || '',
            phone: row.phone || '',
            association: row.association || '',
            role: row.role || '',
            notes: row.notes || '',
            patients: Array.isArray(row.patients) ? row.patients : [],
        })
        setFormError('')
        setEditorOpen(true)
    }, [])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (cancelled) return

                if (!token) {
                    router.push('/login')
                    return
                }

                const user = getCurrentUser()
                if (!user) {
                    router.push('/login')
                    return
                }

                const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
                const storedDomain = readStoredDefaultDomain()
                const { mode } = getEffectiveDomainMode(hostname, storedDomain)
                const userDomain = String(user?.domain || '').trim().toLowerCase()
                const effectiveDomain = userDomain || mode

                // The dashboard Contacts card deep-links to one contact, e.g.
                // /admin/contacts?contactId=12. The link is read once during bootstrap
                // (like the Funders page) instead of with useSearchParams, so the page
                // still needs no Suspense boundary. It highlights that contact's row
                // rather than opening its editor, so editing always takes an explicit
                // action from the row.
                const requestedContactId = typeof window !== 'undefined'
                    ? String(new URLSearchParams(window.location.search).get('contactId') || '').trim()
                    : ''

                setActiveDomain(effectiveDomain)
                setIsAuthenticated(true)
                const contactRows = await refreshContacts(effectiveDomain)
                refreshAssociationOptions(effectiveDomain)

                if (cancelled || !requestedContactId) return

                const requestedContact = contactRows.find((row) => String(row?.id) === requestedContactId)
                if (requestedContact) {
                    setHighlightedContactId(requestedContact.id)
                    setStatusMessage(`Showing ${contactDisplayName(requestedContact)}. Choose Edit to make changes.`)
                    setStatusTone('neutral')
                } else {
                    setStatusMessage('That contact is no longer in this directory')
                    setStatusTone('error')
                }
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize contacts view')
                setStatusTone('error')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [router, refreshContacts, refreshAssociationOptions])

    // Bring the deep-linked contact's row into view once the table has rendered it,
    // without opening its editor.
    useEffect(() => {
        if (highlightedContactKey === null) return
        highlightedRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, [highlightedContactKey])

    const summary = useMemo(() => buildContactMetrics(contacts), [contacts])

    const filteredRows = useMemo(() => filterContacts(contacts, searchQuery), [contacts, searchQuery])

    // The row the editor has open. Deleting lives in the editor rather than the
    // list, so it needs the contact the form is currently editing.
    const editingContact = useMemo(
        () => (editingId ? contacts.find((row) => String(row.id) === String(editingId)) || null : null),
        [contacts, editingId],
    )

    const closeEditor = useCallback(() => {
        setEditorOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        setFormError('')
    }, [])

    useEffect(() => {
        if (!editorOpen) return undefined

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') closeEditor()
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [editorOpen, closeEditor])

    const updateFormField = (field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }))
    }

    const saveContact = async (event) => {
        event.preventDefault()
        setFormError('')

        const { updates, errors } = resolveContactFields({
            ...form,
            patient_ids: form.patients.map((patient) => patient?.id).filter(Boolean),
        })
        const fields = Object.fromEntries(updates.map((update) => [update.key, update.value]))
        if (errors.length > 0) {
            setFormError(errors[0])
            return
        }
        if (!fields.name && !fields.email) {
            setFormError('Add a name or an email address')
            return
        }

        setSaving(true)
        try {
            const headers = await getAdminAuthHeaders()
            const query = editingId ? `?${new URLSearchParams({ domain: activeDomain }).toString()}` : ''
            const response = await fetchWithTimeout(`/api/database/contacts${editingId ? `/${editingId}` : ''}${query}`, {
                method: editingId ? 'PATCH' : 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...fields, domain: activeDomain }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save contact')
            }

            closeEditor()
            await refreshContacts(activeDomain)
            setStatusMessage(editingId ? 'Contact updated.' : 'Contact added.')
            setStatusTone('success')
        } catch (error) {
            setFormError(error?.message || 'Failed to save contact')
        } finally {
            setSaving(false)
        }
    }

    const deleteContact = async (row) => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete ${contactDisplayName(row)}? This cannot be undone.`)) {
            return
        }

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/contacts/${row.id}?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete contact')
            }
            closeEditor()
            await refreshContacts(activeDomain)
            setStatusMessage('Contact deleted.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to delete contact')
            setStatusTone('error')
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading contacts...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    // A blank email is allowed but must not be a malformed one.
    const emailLooksInvalid = !isValidContactEmail(form.email)

    const associationSuggestionsReady = form.association.trim().length >= ASSOCIATION_SUGGESTION_MIN_CHARS

    return (
        <div className="min-h-screen">
            <AdminHeader title="Contacts" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                The people and organisations you work with. Each contact keeps a name, the
                                best way to reach them, the association they belong to, and the patients they
                                are linked to — a support coordinator, for example, usually helps more than one.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => router.push('/admin')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Back to Admin
                            </button>
                            <button
                                type="button"
                                onClick={() => refreshContacts(activeDomain)}
                                disabled={loadingContacts}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingContacts ? 'Refreshing...' : 'Refresh'}
                            </button>
                            <button
                                type="button"
                                onClick={openCreate}
                                className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                Add contact
                            </button>
                        </div>
                    </div>

                    {statusMessage ? (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    ) : null}
                </section>

                <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <SummaryTile label="Total" value={summary.total} />
                    <SummaryTile label="With email" value={summary.withEmail} />
                    <SummaryTile label="With phone" value={summary.withPhone} />
                    <SummaryTile label="With patients" value={summary.withPatient} />
                    <SummaryTile label="Associations" value={summary.associations.size} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                        <div className="relative w-full max-w-sm">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search name, email, association, patients..."
                                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
                                aria-label="Search contacts"
                            />
                        </div>
                        <span className="text-sm text-gray-500">
                            {filteredRows.length} of {contacts.length}
                        </span>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Email</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Phone</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Association</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patients</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Updated</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRows.map((row) => (
                                    <tr
                                        key={row.id}
                                        ref={String(row.id) === highlightedContactKey ? highlightedRowRef : null}
                                        aria-current={String(row.id) === highlightedContactKey ? 'true' : undefined}
                                        className={String(row.id) === highlightedContactKey ? HIGHLIGHTED_ROW_CLASSES : undefined}
                                    >
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {contactDisplayName(row)}
                                            {row.role ? <span className="block text-xs text-gray-500">{row.role}</span> : null}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.email ? (
                                                <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                                                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                                    {row.email}
                                                </a>
                                            ) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.phone ? (
                                                <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                                                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                                                    {row.phone}
                                                </a>
                                            ) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.association || '—'}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {Array.isArray(row.patients) && row.patients.length > 0 ? (
                                                <ul className="flex flex-wrap gap-1">
                                                    {row.patients.map((patient) => (
                                                        <li
                                                            key={patient.id}
                                                            className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
                                                        >
                                                            {patient.name}
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">
                                            {formatContactDateTime(row.updated_at) || '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => openEdit(row)}
                                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                                Edit
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {!loadingContacts && filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                                            {contacts.length === 0
                                                ? 'No contacts added yet.'
                                                : 'No contacts match your search.'}
                                        </td>
                                    </tr>
                                )}

                                {loadingContacts && contacts.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-8 text-center text-gray-500">Loading contacts...</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>

            {editorOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 sm:items-center"
                    role="dialog"
                    aria-modal="true"
                    aria-label={editingId ? 'Edit contact' : 'Add contact'}
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeEditor()
                    }}
                >
                    <form
                        onSubmit={saveContact}
                        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit contact' : 'Add contact'}</h2>
                                <p className="mt-1 text-xs text-gray-500">
                                    Name or email is required. Association, patient links, role and notes are optional.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEditor}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="block sm:col-span-1">
                                <FieldLabel>Name</FieldLabel>
                                <input
                                    type="text"
                                    value={form.name}
                                    maxLength={CONTACT_FIELD_LIMITS.name}
                                    onChange={(event) => updateFormField('name', event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    autoFocus
                                />
                            </label>

                            <div className="block sm:col-span-1">
                                <label htmlFor="contact-email">
                                    <FieldLabel>Email</FieldLabel>
                                </label>
                                <input
                                    id="contact-email"
                                    type="email"
                                    value={form.email}
                                    maxLength={CONTACT_FIELD_LIMITS.email}
                                    onChange={(event) => updateFormField('email', event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                                {emailLooksInvalid && (
                                    <span className="mt-1 block text-xs text-red-600">Enter a valid email address</span>
                                )}
                            </div>

                            <label className="block sm:col-span-1">
                                <FieldLabel>Phone</FieldLabel>
                                <input
                                    type="tel"
                                    value={form.phone}
                                    maxLength={CONTACT_FIELD_LIMITS.phone}
                                    onChange={(event) => updateFormField('phone', event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <label className="block sm:col-span-1">
                                <FieldLabel>Association</FieldLabel>
                                <input
                                    type="text"
                                    value={form.association}
                                    maxLength={CONTACT_FIELD_LIMITS.association}
                                    list="contact-association-options"
                                    autoComplete="off"
                                    onChange={(event) => updateFormField('association', event.target.value)}
                                    placeholder="Organisation or group"
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                                <span className="mt-1 block text-xs text-gray-500">
                                    Type any organisation, or pick an existing provider, supplier or funder.
                                </span>
                            </label>

                            <div className="block sm:col-span-2">
                                <FieldLabel>Patients (optional)</FieldLabel>
                                <div className="mt-1">
                                    <PatientLinkPicker
                                        domain={activeDomain}
                                        value={form.patients}
                                        onChange={(next) => updateFormField('patients', next)}
                                        disabled={saving}
                                    />
                                </div>
                                <span className="mt-1 block text-xs text-gray-500">
                                    Start typing a patient&rsquo;s name and pick from the suggestions. Linked
                                    patients show these details on their record, and one contact can be linked
                                    to several patients.
                                </span>
                            </div>

                            <label className="block sm:col-span-2">
                                <FieldLabel>Role (optional)</FieldLabel>
                                <input
                                    type="text"
                                    value={form.role}
                                    maxLength={CONTACT_FIELD_LIMITS.role}
                                    onChange={(event) => updateFormField('role', event.target.value)}
                                    placeholder="e.g. Practice manager"
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <label className="block sm:col-span-2">
                                <FieldLabel>Notes (optional)</FieldLabel>
                                <textarea
                                    value={form.notes}
                                    maxLength={CONTACT_FIELD_LIMITS.notes}
                                    onChange={(event) => updateFormField('notes', event.target.value)}
                                    rows={3}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>
                        </div>

                        <datalist id="contact-association-options">
                            {associationSuggestionsReady && associationOptions.map((option) => (
                                <option
                                    key={option.value}
                                    value={option.value}
                                    label={describeAssociationSources(option.sources) || undefined}
                                />
                            ))}
                        </datalist>

                        {formError ? (
                            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
                        ) : null}

                        <div className="mt-5 flex items-center gap-2">
                            {editingContact ? (
                                <button
                                    type="button"
                                    onClick={() => deleteContact(editingContact)}
                                    disabled={saving}
                                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    Delete
                                </button>
                            ) : null}
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={closeEditor}
                                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add contact'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}

export default function ContactsPage() {
    return <ContactsPageContent />
}
