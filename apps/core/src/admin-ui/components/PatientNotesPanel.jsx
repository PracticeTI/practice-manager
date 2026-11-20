'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { NotebookPen, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { MANUAL_EXTERNAL_SOURCE } from '@/lib/notes'
import { formatNoteDateTime, notePreview, noteWordCount } from '@/lib/noteDisplay'
import NoteBody from '@/admin-ui/components/NoteBody'

async function requestJson(url, options = {}) {
    const token = await getOrCreateAdminTokenForLocalhost()
    const hasBody = Boolean(options.body)
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
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

function MetricTile({ label, value, hint }) {
    return (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
            {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
        </div>
    )
}

/**
 * The note composer, shared by "new note" and "edit note".
 *
 * A note written here is plain text; the API wraps it in the document the
 * `content` column stores, so it renders through the same `NoteBody` as an
 * imported note.
 */
function NoteComposer({ mode, form, onChange, onSubmit, onCancel, saving, error, bodyLocked }) {
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault()
                onSubmit()
            }}
            className="rounded-md border border-gray-300 bg-gray-50 p-3"
        >
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{mode === 'edit' ? 'Edit note' : 'New note'}</p>
                <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Cancel
                </button>
            </div>

            <label className="mt-3 block">
                <span className="text-xs font-medium text-gray-700">Title</span>
                <input
                    type="text"
                    value={form.title}
                    onChange={(event) => onChange('title', event.target.value)}
                    placeholder="e.g. Home visit, 12 Aug"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
            </label>

            {bodyLocked ? (
                <div className="mt-3">
                    <span className="text-xs font-medium text-gray-700">Note</span>
                    <p className="mt-1 text-[11px] text-gray-500">
                        This note was imported, so its body comes from the practice management system. Its title and
                        draft status can be changed here.
                    </p>
                    <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white px-3 py-2">
                        <NoteBody content={form.content} className="max-w-3xl" />
                    </div>
                </div>
            ) : (
                <label className="mt-3 block">
                    <span className="text-xs font-medium text-gray-700">Note</span>
                    <textarea
                        value={form.body}
                        onChange={(event) => onChange('body', event.target.value)}
                        className="mt-1 min-h-[180px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Record the session, handoff details, and follow-up observations."
                    />
                </label>
            )}

            {error && (
                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                        type="checkbox"
                        checked={form.draft === true}
                        onChange={(event) => onChange('draft', event.target.checked)}
                        className="h-4 w-4"
                    />
                    Save as draft
                </label>
                <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {saving ? 'Saving...' : mode === 'edit' ? 'Save changes' : 'Save note'}
                </button>
            </div>
        </form>
    )
}

const EMPTY_NOTE_FORM = { title: '', body: '', draft: false, content: null }

function noteFormFromRow(row) {
    return {
        title: String(row?.title || ''),
        body: String(row?.content_text || '').trim(),
        draft: row?.draft === true,
        content: row?.content || null,
    }
}

// A note written in the app. Imported notes keep the practice-management
// system's body, so only their title and draft flag are editable here.
function isManualNote(row) {
    return String(row?.external_source || '').toLowerCase() === MANUAL_EXTERNAL_SOURCE
}

/**
 * The patient's notes - the patient-record half of the single Notes entity.
 *
 * Notes imported from the practice management system and notes written here
 * share one table, one shape and one list. A note written in the app is a
 * `manual` note and is fully editable; an imported note keeps the external
 * system's body, so only its title and draft flag can be changed here.
 */
export default function PatientNotesPanel({
    patientId,
    patientName,
    domain,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    const [notes, setNotes] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [notice, setNotice] = useState(null)
    const [draftsOnly, setDraftsOnly] = useState(false)
    const [expandedId, setExpandedId] = useState(null)
    const [busyRowId, setBusyRowId] = useState(null)
    const [rowError, setRowError] = useState('')

    // One composer drives both "new note" and "edit note"; `editingId` is null
    // while a brand new note is being written.
    const [composerOpen, setComposerOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [form, setForm] = useState(EMPTY_NOTE_FORM)
    const [saving, setSaving] = useState(false)
    const [formError, setFormError] = useState('')

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    const refreshNotes = useCallback(async () => {
        if (!canManage) return
        // Defer the busy flag so a mount effect doesn't synchronously cascade renders.
        await Promise.resolve()
        setLoading(true)
        setLoadError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '200',
            })
            if (draftsOnly) query.set('draft', '1')

            const data = await requestJson(`/api/database/notes?${query.toString()}`, { cache: 'no-store' })
            setNotes(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setNotes([])
            setLoadError(error?.message || 'Failed to load notes')
        } finally {
            setLoading(false)
        }
    }, [canManage, domain, numericPatientId, draftsOnly])

    // The panel is rendered with a `key` per (domain, patient), so its state
    // starts fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshNotes()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftsOnly])

    const metrics = useMemo(() => {
        const rows = Array.isArray(notes) ? notes : []

        return {
            rows,
            total: rows.length,
            drafts: rows.filter((row) => row?.draft === true).length,
            words: rows.reduce((total, row) => total + noteWordCount(row), 0),
            latest: rows[0] || null,
            practitioners: new Set(rows.map((row) => String(row?.practitioner_name || '').trim()).filter(Boolean)).size,
        }
    }, [notes])

    const deleteNote = useCallback(async (row) => {
        if (typeof window === 'undefined') return
        if (!window.confirm('Delete this note? This cannot be undone.')) return

        setBusyRowId(row.id)
        setRowError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/notes/${row.id}?${query.toString()}`, { method: 'DELETE' })
            flashNotice('Note deleted.')
            await refreshNotes()
        } catch (error) {
            setRowError(error?.message || 'Failed to delete the note')
        } finally {
            setBusyRowId(null)
        }
    }, [domain, flashNotice, refreshNotes])

    const editingNote = useMemo(
        () => (editingId
            ? (Array.isArray(notes) ? notes : []).find((row) => String(row.id) === String(editingId)) || null
            : null),
        [editingId, notes]
    )

    const openComposer = useCallback((row = null) => {
        setForm(row ? noteFormFromRow(row) : EMPTY_NOTE_FORM)
        setEditingId(row?.id ?? null)
        setFormError('')
        setComposerOpen(true)
    }, [])

    const closeComposer = useCallback(() => {
        setComposerOpen(false)
        setEditingId(null)
        setForm(EMPTY_NOTE_FORM)
        setFormError('')
    }, [])

    const updateForm = useCallback((key, value) => {
        setForm((previous) => ({ ...previous, [key]: value }))
    }, [])

    const saveNote = useCallback(async () => {
        const title = String(form.title || '').trim()
        const body = String(form.body || '').trim()
        if (!title && !body) {
            setFormError('A note needs a title or some content.')
            return
        }

        setSaving(true)
        setFormError('')
        try {
            const query = new URLSearchParams({ domain })
            if (editingId) {
                const payload = { title: title || null, draft: form.draft === true }
                // An imported body is owned by the importer - rewriting it here
                // would silently diverge from the practice management system.
                if (!editingNote || isManualNote(editingNote)) payload.content = body

                await requestJson(`/api/database/notes/${editingId}?${query.toString()}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                })
                flashNotice('Note updated.')
            } else {
                await requestJson(`/api/database/notes?${query.toString()}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        domain,
                        title: title || null,
                        content: body,
                        draft: form.draft === true,
                        patient_id: numericPatientId,
                        patient_name: String(patientName || '').trim() || null,
                    }),
                })
                flashNotice('Note saved.')
            }

            closeComposer()
            await refreshNotes()
        } catch (error) {
            setFormError(error?.message || 'Failed to save the note')
        } finally {
            setSaving(false)
        }
    }, [
        closeComposer,
        domain,
        editingId,
        editingNote,
        flashNotice,
        form.body,
        form.draft,
        form.title,
        numericPatientId,
        patientName,
        refreshNotes,
    ])

    if (!canManage) {
        return (
            <section className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Save this patient before reviewing their notes.
            </section>
        )
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Notes</h3>
                    <p className="mt-1 text-xs text-gray-600">
                        Notes for {String(patientName || 'this patient').trim() || 'this patient'} - written here or
                        imported from the practice management system.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                            type="checkbox"
                            checked={draftsOnly}
                            onChange={(event) => setDraftsOnly(event.target.checked)}
                            className="h-4 w-4"
                        />
                        Drafts only
                    </label>
                    <button
                        type="button"
                        onClick={refreshNotes}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => openComposer(null)}
                        disabled={composerOpen && !editingId && !saving}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        New note
                    </button>
                </div>
            </div>

            {notice && (
                <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-green-200 bg-green-50 text-green-700'}`}
                >
                    {notice.message}
                </p>
            )}

            {loadError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
            )}

            {rowError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{rowError}</p>
            )}

            {composerOpen && !editingId && (
                <NoteComposer
                    mode="create"
                    form={form}
                    onChange={updateForm}
                    onSubmit={saveNote}
                    onCancel={closeComposer}
                    saving={saving}
                    error={formError}
                />
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricTile label="Notes" value={metrics.total} />
                <MetricTile label="Drafts" value={metrics.drafts} />
                <MetricTile label="Words" value={metrics.words} />
                <MetricTile
                    label="Latest"
                    value={metrics.latest ? formatNoteDateTime(metrics.latest.updated_at) || '—' : '—'}
                    hint={metrics.practitioners > 0
                        ? `${metrics.practitioners} practitioner${metrics.practitioners === 1 ? '' : 's'}`
                        : ''}
                />
            </div>

            {!loading && metrics.rows.length === 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                    <p className="flex items-center gap-2 font-medium text-gray-800">
                        <NotebookPen className="h-4 w-4" aria-hidden="true" />
                        No notes for this patient yet.
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                        Write one with New note, or import the practice management export from the Notes page.
                    </p>
                </div>
            )}

            <div className="space-y-3">
                {metrics.rows.map((row) => {
                    const isExpanded = String(expandedId) === String(row.id)
                    const isEditing = editingId !== null && String(editingId) === String(row.id)
                    const preview = notePreview(row, 200)

                    return (
                        <article key={row.id} className="rounded-md border border-gray-200 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">
                                        {row.title || 'Untitled note'}
                                        {row.draft === true && (
                                            <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                                Draft
                                            </span>
                                        )}
                                    </p>
                                    <p className="mt-0.5 text-xs text-gray-600">
                                        {row.practitioner_name || 'Unknown practitioner'}
                                        {row.external_appointment_id ? ` · Appointment ${row.external_appointment_id}` : ''}
                                        {' · '}
                                        {noteWordCount(row)} word(s)
                                    </p>
                                    {!isExpanded && preview && (
                                        <p className="mt-1 max-w-2xl text-xs text-gray-500">{preview}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {isEditing ? null : (
                                        <button
                                            type="button"
                                            onClick={() => setExpandedId(isExpanded ? null : row.id)}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            {isExpanded ? 'Hide note' : 'View note'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => (isEditing ? closeComposer() : openComposer(row))}
                                        disabled={saving || busyRowId === row.id}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                        {isEditing ? 'Hide editor' : 'Edit'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => deleteNote(row)}
                                        disabled={busyRowId === row.id}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        {busyRowId === row.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                </div>
                            </div>

                            {isEditing && (
                                <div className="mt-3 border-t border-gray-100 pt-3">
                                    <NoteComposer
                                        mode="edit"
                                        form={form}
                                        onChange={updateForm}
                                        onSubmit={saveNote}
                                        onCancel={closeComposer}
                                        saving={saving}
                                        error={formError}
                                        bodyLocked={!isManualNote(row)}
                                    />
                                </div>
                            )}

                            {isExpanded && !isEditing && (
                                <div className="mt-3 border-t border-gray-100 pt-3">
                                    <NoteBody content={row.content} className="max-w-3xl" />
                                    <p className="mt-3 text-[11px] text-gray-400">
                                        {`Created ${formatNoteDateTime(row.created_at) || 'unknown'}`}
                                        {row.updated_at && row.updated_at !== row.created_at
                                            ? ` · Updated ${formatNoteDateTime(row.updated_at)}`
                                            : ''}
                                        {row.external_id ? ` · External ID ${row.external_id}` : ''}
                                    </p>
                                </div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
