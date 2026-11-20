'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Archive,
    ArchiveRestore,
    CalendarDays,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
    X,
} from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    DEFAULT_EXTERNAL_SOURCE,
    PROGRESS_NOTE_STATUSES,
    formatStatusLabel,
} from '@/lib/appointments'
import {
    buildAppointmentMetrics,
    formatAppointmentDay,
    formatAppointmentDuration,
    formatAppointmentPrice,
    formatAppointmentTimeRange,
    getAppointmentStatusLabel,
    getAppointmentStatusPillStyle,
    toAppointmentDate,
} from '@/lib/appointmentDisplay'

const VIEW_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'past', label: 'Past' },
]

// The external system owns these rows, but a manual entry still needs a value
// the API will accept, so blank is sent as "no status".
function buildStatusOptions(currentValue) {
    const options = PROGRESS_NOTE_STATUSES.map((status) => ({
        value: status,
        label: formatStatusLabel(status),
    }))

    const raw = String(currentValue || '').trim()
    if (raw && !options.some((option) => option.value === raw)) {
        options.push({ value: raw, label: raw })
    }

    return options
}

function toStatusFormValue(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim()
    if (!raw) return ''
    const key = raw.toLowerCase()
    if (key === 'draft' || key === 'finalised' || key === 'no status') return key
    // Preserve any status text the external system uses that we don't know about.
    return raw
}

function toDateTimeLocalInput(value) {
    const date = toAppointmentDate(value)
    if (!date) return ''

    const pad = (number) => String(number).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocalInput(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function createBlankAppointmentForm() {
    return {
        starts_at: '',
        ends_at: '',
        service: '',
        practitioner: '',
        location: '',
        progress_note_status: '',
        notes: '',
    }
}

function createEditFormFromRow(row) {
    return {
        starts_at: toDateTimeLocalInput(row?.starts_at),
        ends_at: toDateTimeLocalInput(row?.ends_at),
        service: String(row?.service || ''),
        practitioner: String(row?.practitioner || ''),
        location: String(row?.location || ''),
        progress_note_status: toStatusFormValue(row?.progress_note_status),
        notes: String(row?.notes || ''),
    }
}

async function buildAuthHeaders() {
    const token = await getOrCreateAdminTokenForLocalhost()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

async function requestJson(url, options = {}) {
    const authHeaders = await buildAuthHeaders()
    const hasBody = Boolean(options.body)
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...authHeaders,
            ...(options.headers || {}),
        },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
}

function StatusPill({ value }) {
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${getAppointmentStatusPillStyle(value)}`}>
            {getAppointmentStatusLabel(value)}
        </span>
    )
}

function MetricTile({ label, value, hint, tone = 'neutral' }) {
    const valueClasses = tone === 'warning' ? 'text-amber-700' : 'text-gray-900'

    return (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-0.5 text-lg font-bold ${valueClasses}`}>{value}</p>
            {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
        </div>
    )
}

function AppointmentFields({ form, onChange }) {
    const statusOptions = useMemo(
        () => buildStatusOptions(form.progress_note_status),
        [form.progress_note_status]
    )

    return (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block">
                <span className="text-xs font-medium text-gray-700">Starts</span>
                <input
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(event) => onChange('starts_at', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
            </label>
            <label className="block">
                <span className="text-xs font-medium text-gray-700">Ends</span>
                <input
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(event) => onChange('ends_at', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
            </label>
            <label className="block">
                <span className="text-xs font-medium text-gray-700">Progress note</span>
                <select
                    value={form.progress_note_status}
                    onChange={(event) => onChange('progress_note_status', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                    <option value="">Not set</option>
                    {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label>
            <label className="block md:col-span-3">
                <span className="text-xs font-medium text-gray-700">Service</span>
                <input
                    type="text"
                    value={form.service}
                    onChange={(event) => onChange('service', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="e.g. TAC & NDIS face to face OT therapy"
                />
            </label>
            <label className="block">
                <span className="text-xs font-medium text-gray-700">Practitioner</span>
                <input
                    type="text"
                    value={form.practitioner}
                    onChange={(event) => onChange('practitioner', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="e.g. Kate"
                />
            </label>
            <label className="block md:col-span-2">
                <span className="text-xs font-medium text-gray-700">Location</span>
                <input
                    type="text"
                    value={form.location}
                    onChange={(event) => onChange('location', event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="e.g. Acme OT clinic"
                />
            </label>
            <label className="block md:col-span-3">
                <span className="text-xs font-medium text-gray-700">Notes</span>
                <textarea
                    value={form.notes}
                    onChange={(event) => onChange('notes', event.target.value)}
                    className="mt-1 min-h-[64px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Anything the practitioner should know about this session"
                />
            </label>
        </div>
    )
}

export default function PatientAppointmentsPanel({
    patientId,
    patientName,
    domain,
    openCreate = false,
    onOpenCreateHandled,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    const [appointments, setAppointments] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [notice, setNotice] = useState(null)

    const [viewFilter, setViewFilter] = useState('all')
    const [showArchived, setShowArchived] = useState(false)

    const [showCreateForm, setShowCreateForm] = useState(false)
    const [createForm, setCreateForm] = useState(createBlankAppointmentForm)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState('')

    const [editingId, setEditingId] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const [editError, setEditError] = useState('')

    const [busyRowId, setBusyRowId] = useState(null)
    const [rowError, setRowError] = useState('')

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    const refreshAppointments = useCallback(async () => {
        if (!canManage) return
        // Defer the busy flag so a mount effect doesn't synchronously cascade renders.
        await Promise.resolve()
        setLoading(true)
        setLoadError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '500',
            })
            if (showArchived) query.set('includeArchived', '1')

            const data = await requestJson(`/api/database/appointments?${query.toString()}`, { cache: 'no-store' })
            setAppointments(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setAppointments([])
            setLoadError(error?.message || 'Failed to load appointments')
        } finally {
            setLoading(false)
        }
    }, [canManage, domain, numericPatientId, showArchived])

    // The panel is rendered with a `key` per (domain, patient), so its state
    // starts fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // Loading on mount is a deliberate external-data fetch (not a derived state
        // update); the rule below flags the loading-state setter inside refreshAppointments.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshAppointments()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showArchived])

    // The patient header's "+ Add" menu opens straight into the create form. The
    // intent is single-shot, so it is reported as handled to keep a later visit to
    // this tab from reopening the form.
    useEffect(() => {
        if (!openCreate) return
        // Opening the form is the point of the intent, not a derived state update.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowCreateForm(true)
        onOpenCreateHandled?.()
    }, [openCreate, onOpenCreateHandled])

    const metrics = useMemo(() => buildAppointmentMetrics(appointments), [appointments])

    const visibleRows = useMemo(() => {
        if (viewFilter === 'upcoming') return metrics.upcomingRows
        if (viewFilter === 'past') return metrics.pastRows
        return [...metrics.upcomingRows, ...metrics.pastRows]
    }, [metrics, viewFilter])

    const validateForm = (form) => {
        const startsAt = fromDateTimeLocalInput(form.starts_at)
        if (!startsAt) return { error: 'A start date and time is required.' }

        const endsAt = fromDateTimeLocalInput(form.ends_at)
        if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
            return { error: 'The end time must be after the start time.' }
        }

        return { startsAt, endsAt }
    }

    const buildPayload = (form, { startsAt, endsAt }) => ({
        starts_at: startsAt,
        ends_at: endsAt,
        service: form.service,
        practitioner: form.practitioner,
        location: form.location,
        progress_note_status: form.progress_note_status || null,
        notes: form.notes,
    })

    const handleCreateAppointment = async (event) => {
        event.preventDefault()
        if (!canManage) return

        const validity = validateForm(createForm)
        if (validity.error) {
            setCreateError(validity.error)
            return
        }

        setCreating(true)
        setCreateError('')
        try {
            await requestJson('/api/database/appointments', {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    external_source: DEFAULT_EXTERNAL_SOURCE,
                    ...buildPayload(createForm, validity),
                }),
            })
            flashNotice('Appointment added.')
            setShowCreateForm(false)
            setCreateForm(createBlankAppointmentForm())
            await refreshAppointments()
        } catch (error) {
            setCreateError(error?.message || 'Failed to add appointment')
        } finally {
            setCreating(false)
        }
    }

    const startEditing = (row) => {
        setEditingId(row.id)
        setEditForm(createEditFormFromRow(row))
        setEditError('')
        setRowError('')
    }

    const cancelEditing = () => {
        setEditingId(null)
        setEditForm(null)
        setEditError('')
    }

    const handleSaveEdit = async (event, row) => {
        event.preventDefault()
        if (!row?.id || !editForm) return

        const validity = validateForm(editForm)
        if (validity.error) {
            setEditError(validity.error)
            return
        }

        setSavingEdit(true)
        setEditError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/appointments/${encodeURIComponent(row.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify(buildPayload(editForm, validity)),
            })
            flashNotice('Appointment updated.')
            setEditingId(null)
            setEditForm(null)
            await refreshAppointments()
        } catch (error) {
            setEditError(error?.message || 'Failed to update appointment')
        } finally {
            setSavingEdit(false)
        }
    }

    const handleToggleArchived = async (row) => {
        if (!row?.id) return
        setBusyRowId(row.id)
        setRowError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/appointments/${encodeURIComponent(row.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ archived: !row.archived }),
            })
            flashNotice(row.archived ? 'Appointment restored.' : 'Appointment archived.')
            await refreshAppointments()
        } catch (error) {
            setRowError(error?.message || 'Failed to update appointment')
        } finally {
            setBusyRowId(null)
        }
    }

    const handleDeleteAppointment = async (row) => {
        if (!row?.id) return
        if (typeof window !== 'undefined' && !window.confirm('Delete this appointment? This cannot be undone.')) {
            return
        }

        setBusyRowId(row.id)
        setRowError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/appointments/${encodeURIComponent(row.id)}?${query.toString()}`, {
                method: 'DELETE',
            })
            flashNotice('Appointment deleted.')
            if (editingId === row.id) cancelEditing()
            await refreshAppointments()
        } catch (error) {
            setRowError(error?.message || 'Failed to delete appointment')
        } finally {
            setBusyRowId(null)
        }
    }

    if (!canManage) {
        return (
            <section className="space-y-3">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Save the patient first, then you can review appointments here.
                </p>
            </section>
        )
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Appointments</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Sessions booked for {String(patientName || '').trim() || 'this patient'}, imported from the practice management system or added by hand.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={refreshAppointments}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowCreateForm((previous) => !previous)
                            setCreateError('')
                            if (!showCreateForm) setCreateForm(createBlankAppointmentForm())
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                        {showCreateForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {showCreateForm ? 'Cancel' : 'New appointment'}
                    </button>
                </div>
            </div>

            {notice && (
                <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {notice.message}
                </p>
            )}
            {loadError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
            )}
            {rowError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{rowError}</p>
            )}

            {showCreateForm && (
                <form onSubmit={handleCreateAppointment} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">New Appointment</h4>
                        {creating && <p className="text-xs text-gray-500">Saving…</p>}
                    </div>
                    <AppointmentFields
                        form={createForm}
                        onChange={(key, value) => setCreateForm((previous) => ({ ...previous, [key]: value }))}
                    />
                    {createError && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>
                    )}
                    <div className="mt-3 flex items-center justify-end">
                        <button
                            type="submit"
                            disabled={creating}
                            className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {creating ? 'Saving…' : 'Add appointment'}
                        </button>
                    </div>
                </form>
            )}

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricTile label="Upcoming" value={metrics.upcoming} hint={metrics.nextAppointment ? `Next ${formatAppointmentDay(metrics.nextAppointment.starts_at)}` : 'Nothing booked'} />
                <MetricTile label="Past" value={metrics.past} hint={metrics.lastAppointment ? `Last ${formatAppointmentDay(metrics.lastAppointment.starts_at)}` : 'No history'} />
                <MetricTile label="Note outstanding" value={metrics.missingProgressNote} tone={metrics.missingProgressNote > 0 ? 'warning' : 'neutral'} />
                <MetricTile label="Total" value={metrics.total} hint={metrics.archived > 0 ? `${metrics.archived} archived` : undefined} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-xs">
                    {VIEW_FILTERS.map((filter) => (
                        <button
                            key={filter.value}
                            type="button"
                            onClick={() => setViewFilter(filter.value)}
                            className={`rounded px-2.5 py-1 font-medium ${viewFilter === filter.value ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(event) => setShowArchived(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                    />
                    Show archived
                </label>
            </div>

            {loading && appointments.length === 0 && (
                <p className="px-2 text-sm text-gray-500">Loading appointments…</p>
            )}

            {!loading && visibleRows.length === 0 && (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                    <CalendarDays className="mx-auto mb-2 h-5 w-5 text-gray-400" />
                    {viewFilter === 'upcoming'
                        ? 'No upcoming appointments for this patient.'
                        : viewFilter === 'past'
                            ? 'No past appointments for this patient.'
                            : 'No appointments recorded for this patient yet.'}
                </p>
            )}

            {visibleRows.map((row) => {
                const rowId = row.id
                const editingThis = editingId === rowId
                const duration = formatAppointmentDuration(row.starts_at, row.ends_at)
                const price = formatAppointmentPrice(row)
                const status = String(row.progress_note_status || '').trim()
                const rowMeta = [row.practitioner, row.location, duration, price].filter(Boolean)

                return (
                    <div key={rowId} className="rounded-md border border-gray-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-900">
                                        {formatAppointmentDay(row.starts_at)}
                                    </span>
                                    <span className="text-xs text-gray-600">
                                        {formatAppointmentTimeRange(row.starts_at, row.ends_at)}
                                    </span>
                                    <StatusPill value={status} />
                                    {row.archived && (
                                        <span className="inline-flex rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                                            Archived
                                        </span>
                                    )}
                                    {(row.is_group || row.is_repeating) && (
                                        <span className="text-[11px] uppercase tracking-wide text-gray-400">
                                            {[row.is_group ? 'Group' : null, row.is_repeating ? 'Repeating' : null].filter(Boolean).join(' · ')}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-gray-800">{row.service || 'Appointment'}</p>
                                {rowMeta.length > 0 && (
                                    <p className="mt-0.5 text-xs text-gray-500">{rowMeta.join(' · ')}</p>
                                )}
                                {row.notes && (
                                    <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{row.notes}</p>
                                )}
                                {row.external_id && (
                                    <p className="mt-1 text-[11px] text-gray-400">
                                        External {row.external_source || DEFAULT_EXTERNAL_SOURCE} #{row.external_id}
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5">
                                {!editingThis && (
                                    <button
                                        type="button"
                                        onClick={() => startEditing(row)}
                                        disabled={busyRowId === rowId}
                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Pencil className="h-3 w-3" /> Edit
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleToggleArchived(row)}
                                    disabled={busyRowId === rowId}
                                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {row.archived
                                        ? <><ArchiveRestore className="h-3 w-3" /> Restore</>
                                        : <><Archive className="h-3 w-3" /> Archive</>}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteAppointment(row)}
                                    disabled={busyRowId === rowId}
                                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {busyRowId === rowId ? 'Working…' : <Trash2 className="h-3 w-3" />}
                                </button>
                            </div>
                        </div>

                        {editingThis && editForm && (
                            <form onSubmit={(event) => handleSaveEdit(event, row)} className="mt-3 rounded-md border border-gray-200 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h5 className="text-sm font-semibold text-gray-900">Edit appointment</h5>
                                    {savingEdit && <p className="text-xs text-gray-500">Saving…</p>}
                                </div>
                                <AppointmentFields
                                    form={editForm}
                                    onChange={(key, value) => setEditForm((previous) => ({ ...previous, [key]: value }))}
                                />
                                {editError && (
                                    <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
                                )}
                                <div className="mt-3 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={cancelEditing}
                                        className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingEdit}
                                        className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {savingEdit ? 'Saving…' : 'Save changes'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                )
            })}

            {!loading && visibleRows.length > 0 && (
                <p className="text-[11px] text-gray-400">
                    Showing {visibleRows.length} of {metrics.total} appointment{metrics.total === 1 ? '' : 's'}
                    {metrics.missingProgressNote > 0
                        ? ` · ${metrics.missingProgressNote} without a finalised progress note`
                        : ''}
                    {metrics.nextAppointment
                        ? ` · next ${formatAppointmentDay(metrics.nextAppointment.starts_at)} at ${formatAppointmentTimeRange(metrics.nextAppointment.starts_at, metrics.nextAppointment.ends_at)}`
                        : ''}
                </p>
            )}
        </section>
    )
}
