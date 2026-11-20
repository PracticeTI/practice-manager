'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mail, Phone, RefreshCw, Users } from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { contactDisplayName } from '@/lib/contactDisplay'

async function requestJson(url, options = {}) {
    const token = await getOrCreateAdminTokenForLocalhost()
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
}

/**
 * Read-only list of the contacts linked to one patient.
 *
 * Contacts are owned by the admin Contacts directory — this panel only shows
 * which of them belong to the patient, so management (including changing the
 * patient link) stays in one place.
 */
export default function PatientContactsPanel({ patientId, patientName, domain }) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canLoad = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    const [contacts, setContacts] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')

    const refreshContacts = useCallback(async () => {
        if (!canLoad) return

        await Promise.resolve()
        setLoading(true)
        setLoadError('')
        try {
            const query = new URLSearchParams({
                domain,
                patientId: String(numericPatientId),
                limit: '200',
            })
            const data = await requestJson(`/api/database/contacts?${query.toString()}`, { cache: 'no-store' })
            setContacts(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setContacts([])
            setLoadError(error?.message || 'Failed to load contacts')
        } finally {
            setLoading(false)
        }
    }, [canLoad, domain, numericPatientId])

    // The panel is rendered with a `key` per (domain, patient), so its state
    // starts fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshContacts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const name = String(patientName || '').trim()

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <Users className="h-4 w-4 text-gray-500" aria-hidden="true" />
                        Contacts
                    </h4>
                    <p className="mt-1 text-xs text-gray-600">
                        {name
                            ? `People linked to ${name}. Manage or link more from the Contacts directory.`
                            : 'People linked to this patient. Manage or link more from the Contacts directory.'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refreshContacts}
                    disabled={loading || !canLoad}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {loadError && (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
            )}

            {!loadError && !loading && contacts.length === 0 && (
                <p className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    No contacts are linked to this patient yet.
                </p>
            )}

            {!loadError && (loading || contacts.length > 0) && (
                <ul className="mt-3 divide-y divide-gray-100">
                    {contacts.map((contact) => (
                        <li key={contact.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">{contactDisplayName(contact)}</p>
                                {(contact.role || contact.association) && (
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {[contact.role, contact.association].filter(Boolean).join(' · ')}
                                    </p>
                                )}
                                {contact.notes ? (
                                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{contact.notes}</p>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                                {contact.email ? (
                                    <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                        {contact.email}
                                    </a>
                                ) : null}
                                {contact.phone ? (
                                    <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                                        {contact.phone}
                                    </a>
                                ) : null}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
