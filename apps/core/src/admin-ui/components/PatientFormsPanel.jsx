'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, RefreshCw, Trash2 } from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { buildFormSections, countFormAnswers, formatFormDateTime } from '@/lib/formDisplay'

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
 * Patient record tab: the intake forms this patient has submitted.
 *
 * Submissions arrive through the Forms import, so the panel is read-only apart
 * from deleting a row; the answers the importer matched are shown alongside the
 * questions so a clinician can see exactly what populated Intake Data.
 */
export default function PatientFormsPanel({
    patientId,
    patientName,
    domain,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    const [forms, setForms] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [notice, setNotice] = useState(null)
    const [showArchived, setShowArchived] = useState(false)
    const [expandedId, setExpandedId] = useState(null)
    const [busyRowId, setBusyRowId] = useState(null)
    const [rowError, setRowError] = useState('')

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    const refreshForms = useCallback(async () => {
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
            if (showArchived) query.set('includeArchived', '1')

            const data = await requestJson(`/api/database/forms?${query.toString()}`, { cache: 'no-store' })
            setForms(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setForms([])
            setLoadError(error?.message || 'Failed to load forms')
        } finally {
            setLoading(false)
        }
    }, [canManage, domain, numericPatientId, showArchived])

    // The panel is rendered with a `key` per (domain, patient), so its state
    // starts fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshForms()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showArchived])

    const metrics = useMemo(() => {
        const rows = Array.isArray(forms) ? forms : []
        const sorted = [...rows].sort((a, b) => {
            const aTime = new Date(a?.submitted_at || 0).getTime()
            const bTime = new Date(b?.submitted_at || 0).getTime()
            return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
        })
        const mappedFields = sorted.reduce((total, row) => total + Object.keys(row?.answers || {}).length, 0)

        return {
            rows: sorted,
            total: sorted.length,
            answerCount: sorted.reduce((total, row) => total + countFormAnswers(row), 0),
            mappedFields,
            latest: sorted[0] || null,
        }
    }, [forms])

    const deleteForm = useCallback(async (row) => {
        if (typeof window === 'undefined') return
        if (!window.confirm('Delete this form submission? The patient intake data it filled is kept.')) return

        setBusyRowId(row.id)
        setRowError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/forms/${row.id}?${query.toString()}`, { method: 'DELETE' })
            flashNotice('Form submission deleted.')
            await refreshForms()
        } catch (error) {
            setRowError(error?.message || 'Failed to delete the form')
        } finally {
            setBusyRowId(null)
        }
    }, [domain, flashNotice, refreshForms])

    if (!canManage) {
        return (
            <section className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Save this patient before reviewing their submitted forms.
            </section>
        )
    }

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Submitted Forms</h3>
                    <p className="mt-1 text-xs text-gray-600">
                        Intake forms imported for {String(patientName || 'this patient').trim() || 'this patient'}. Importing
                        fills any Intake Data answers that were still blank.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                            type="checkbox"
                            checked={showArchived}
                            onChange={(event) => setShowArchived(event.target.checked)}
                            className="h-4 w-4"
                        />
                        Include archived
                    </label>
                    <button
                        type="button"
                        onClick={refreshForms}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {loading ? 'Refreshing...' : 'Refresh'}
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricTile label="Submissions" value={metrics.total} />
                <MetricTile label="Answered questions" value={metrics.answerCount} />
                <MetricTile
                    label="Intake fields"
                    value={metrics.mappedFields}
                    hint="Matched to the intake schema"
                />
                <MetricTile
                    label="Latest"
                    value={metrics.latest ? formatFormDateTime(metrics.latest.submitted_at) || '—' : '—'}
                    hint={metrics.latest?.title || ''}
                />
            </div>

            {!loading && metrics.rows.length === 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                    <p className="flex items-center gap-2 font-medium text-gray-800">
                        <ClipboardList className="h-4 w-4" aria-hidden="true" />
                        No forms for this patient yet.
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                        Import the practice management export from Forms on the admin dashboard to pull submissions in.
                    </p>
                </div>
            )}

            <div className="space-y-3">
                {metrics.rows.map((row) => {
                    const isExpanded = String(expandedId) === String(row.id)
                    const sections = isExpanded ? buildFormSections(row) : []
                    const mappedCount = Object.keys(row?.answers || {}).length

                    return (
                        <article key={row.id} className="rounded-md border border-gray-200 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">{row.title || 'Untitled form'}</p>
                                    <p className="mt-0.5 text-xs text-gray-600">
                                        Submitted {formatFormDateTime(row.submitted_at) || 'unknown'}
                                        {row.archived === true ? ' · Archived' : ''}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">
                                        {countFormAnswers(row)} answer(s)
                                        {mappedCount > 0 ? ` · ${mappedCount} mapped to Intake Data` : ' · nothing mapped to Intake Data'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        {isExpanded ? 'Hide answers' : 'View answers'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => deleteForm(row)}
                                        disabled={busyRowId === row.id}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        {busyRowId === row.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="mt-3 space-y-4 border-t border-gray-100 pt-3">
                                    {sections.length === 0 ? (
                                        <p className="text-xs text-gray-500">This submission has no readable answers.</p>
                                    ) : (
                                        sections.map((section) => (
                                            <div key={section.name}>
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    {section.name}
                                                </p>
                                                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
                                                    {section.entries.map((entry) => (
                                                        <div key={entry.key}>
                                                            <dt className="text-xs font-medium text-gray-600">
                                                                {entry.question}
                                                                {entry.matched && (
                                                                    <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                                        Intake
                                                                    </span>
                                                                )}
                                                            </dt>
                                                            <dd className="mt-0.5 whitespace-pre-wrap text-xs text-gray-800">
                                                                {entry.answer || '—'}
                                                            </dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                            </div>
                                        ))
                                    )}
                                    {row.submitted_message && (
                                        <p className="text-[11px] text-gray-400">{row.submitted_message}</p>
                                    )}
                                </div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
