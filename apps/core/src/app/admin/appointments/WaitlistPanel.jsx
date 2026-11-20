'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListOrdered, Loader2, Plus, Trash2 } from 'lucide-react'

function formatDateOnly(value) {
    const text = String(value || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '—'
    return new Intl.DateTimeFormat('en-AU', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).format(new Date(`${text}T00:00:00Z`))
}

export default function WaitlistPanel({
    domain,
    practitioners = [],
    services = [],
    getAuthHeaders,
    onChanged,
}) {
    const [entries, setEntries] = useState([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState('')
    const [form, setForm] = useState({
        patientName: '',
        serviceId: '',
        practitionerId: '',
        earliestDate: '',
        priority: '0',
    })

    const serviceNames = useMemo(() => {
        const map = new Map()
        services.forEach((service) => map.set(String(service.id), service.name))
        return map
    }, [services])

    const practitionerNames = useMemo(() => {
        const map = new Map()
        practitioners.forEach((practitioner) => map.set(String(practitioner.id), practitioner.display_name))
        return map
    }, [practitioners])

    const load = useCallback(async () => {
        if (!domain) return
        const headers = await getAuthHeaders()
        const query = new URLSearchParams({ domain, status: 'waiting', limit: '200' })
        const response = await fetch(`/api/database/waitlist?${query.toString()}`, {
            headers,
            cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || 'Failed to load the waitlist')
        setEntries(Array.isArray(data?.data) ? data.data : [])
    }, [domain, getAuthHeaders])

    useEffect(() => {
        let cancelled = false

        async function run() {
            if (!domain) return
            const headers = await getAuthHeaders()
            if (cancelled) return
            setLoading(true)
            try {
                const query = new URLSearchParams({ domain, status: 'waiting', limit: '200' })
                const response = await fetch(`/api/database/waitlist?${query.toString()}`, {
                    headers,
                    cache: 'no-store',
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(data?.error || 'Failed to load the waitlist')
                if (!cancelled) setEntries(Array.isArray(data?.data) ? data.data : [])
            } catch (error) {
                if (!cancelled) setMessage(error?.message || 'Failed to load the waitlist')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [domain, getAuthHeaders])

    const addEntry = useCallback(async () => {
        const patientName = form.patientName.trim()
        if (!patientName) {
            setMessage('A patient name is required.')
            return
        }

        setSaving(true)
        setMessage('')
        try {
            const headers = await getAuthHeaders()
            const response = await fetch('/api/database/waitlist', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain,
                    patient_name: patientName,
                    service_id: form.serviceId ? Number(form.serviceId) : null,
                    practitioner_id: form.practitionerId ? Number(form.practitionerId) : null,
                    earliest_date: form.earliestDate || null,
                    priority: Number(form.priority) || 0,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to add the waitlist entry')
            setForm({
                patientName: '',
                serviceId: '',
                practitionerId: '',
                earliestDate: '',
                priority: '0',
            })
            setMessage('Waitlist entry added.')
            await load()
            onChanged?.()
        } catch (error) {
            setMessage(error?.message || 'Failed to add the waitlist entry')
        } finally {
            setSaving(false)
        }
    }, [form, domain, getAuthHeaders, load, onChanged])

    const removeEntry = useCallback(async (entry) => {
        if (typeof window !== 'undefined'
            && !window.confirm(`Remove ${entry.patient_name} from the waitlist?`)) {
            return
        }
        try {
            const headers = await getAuthHeaders()
            const query = new URLSearchParams({ domain })
            const response = await fetch(
                `/api/database/waitlist/${entry.id}?${query.toString()}`,
                { method: 'DELETE', headers }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to remove the waitlist entry')
            setMessage('Waitlist entry removed.')
            await load()
            onChanged?.()
        } catch (error) {
            setMessage(error?.message || 'Failed to remove the waitlist entry')
        }
    }, [domain, getAuthHeaders, load, onChanged])

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                        <ListOrdered className="h-4 w-4 text-gray-500" aria-hidden="true" />
                        Waitlist
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                        When a cancelled appointment is offered to the waitlist, the best match receives an
                        expiring email or SMS link.
                    </p>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                    {entries.length} waiting
                </span>
            </div>

            {message && (
                <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {message}
                </p>
            )}

            <div className="mt-4 grid gap-2 md:grid-cols-6">
                <input
                    type="text"
                    value={form.patientName}
                    onChange={(event) => setForm((current) => ({ ...current, patientName: event.target.value }))}
                    placeholder="Patient name"
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
                    aria-label="Patient name"
                />
                <select
                    value={form.serviceId}
                    onChange={(event) => setForm((current) => ({ ...current, serviceId: event.target.value }))}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    aria-label="Service"
                >
                    <option value="">Any service</option>
                    {services.map((service) => (
                        <option key={service.id} value={service.id}>{service.name}</option>
                    ))}
                </select>
                <select
                    value={form.practitionerId}
                    onChange={(event) => setForm((current) => ({ ...current, practitionerId: event.target.value }))}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    aria-label="Practitioner"
                >
                    <option value="">Any practitioner</option>
                    {practitioners.map((practitioner) => (
                        <option key={practitioner.id} value={practitioner.id}>{practitioner.display_name}</option>
                    ))}
                </select>
                <input
                    type="date"
                    value={form.earliestDate}
                    onChange={(event) => setForm((current) => ({ ...current, earliestDate: event.target.value }))}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    aria-label="Earliest date"
                />
                <button
                    type="button"
                    onClick={addEntry}
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                >
                    {saving
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Plus className="h-4 w-4" aria-hidden="true" />}
                    Add
                </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Service</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Practitioner</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Earliest</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Priority</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {entries.map((entry) => (
                            <tr key={entry.id}>
                                <td className="px-3 py-2 font-medium text-gray-900">{entry.patient_name}</td>
                                <td className="px-3 py-2 text-gray-700">
                                    {entry.service_id ? serviceNames.get(String(entry.service_id)) || `#${entry.service_id}` : 'Any'}
                                </td>
                                <td className="px-3 py-2 text-gray-700">
                                    {entry.practitioner_id ? practitionerNames.get(String(entry.practitioner_id)) || `#${entry.practitioner_id}` : 'Any'}
                                </td>
                                <td className="px-3 py-2 text-gray-700">{formatDateOnly(entry.earliest_date)}</td>
                                <td className="px-3 py-2 text-gray-700">{entry.priority ?? 0}</td>
                                <td className="px-3 py-2">
                                    <button
                                        type="button"
                                        onClick={() => removeEntry(entry)}
                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!loading && entries.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-5 text-center text-gray-500">
                                    No one is waiting.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    )
}
