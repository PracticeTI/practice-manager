'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Ban,
    ChevronDown,
    ChevronRight,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Trash2,
    X,
} from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    CASE_TYPE_OPTIONS,
    STATUS_LABELS,
    STATUS_PILL_STYLES,
    deriveCaseStatus,
    formatAllocation,
    formatDisplayDate,
    getTypeConfig,
} from '@/lib/patientCaseDisplay'

function toLocalDateString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function createBlankCaseForm() {
    return {
        case_number: '',
        case_type: 'budget',
        total_allocation: '',
        practitioner: '',
        issue_date: '',
        expiry_date: '',
        disable_exceeding: false,
        referral_contact: '',
        referral_issue_date: '',
        referral_period: '',
        notes: '',
    }
}

function createBlankUsageForm() {
    return {
        entry_date: toLocalDateString(new Date()),
        quantity: '',
        description: '',
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

function CaseTypeBadge({ caseType }) {
    const config = getTypeConfig(caseType)
    return (
        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            {config.label}
        </span>
    )
}

function StatusPill({ status }) {
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_PILL_STYLES[status] || STATUS_PILL_STYLES.open}`}>
            {STATUS_LABELS[status] || String(status || 'open')}
        </span>
    )
}

export default function PatientCasesPanel({
    patientId,
    patientName,
    domain,
    domainDisplayName,
    openCreate = false,
    onOpenCreateHandled,
}) {
    const numericPatientId = Number.parseInt(String(patientId || ''), 10)
    const canManage = Number.isFinite(numericPatientId) && numericPatientId > 0 && Boolean(domain)

    const [cases, setCases] = useState([])
    const [casesLoading, setCasesLoading] = useState(false)
    const [casesError, setCasesError] = useState('')
    const [notice, setNotice] = useState(null)

    const [showCreateForm, setShowCreateForm] = useState(false)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState('')
    const [newCaseForm, setNewCaseForm] = useState(createBlankCaseForm)

    const [expandedIds, setExpandedIds] = useState([])
    const [usageByCase, setUsageByCase] = useState({})
    const [usageLoadingCaseId, setUsageLoadingCaseId] = useState(null)
    const [usageError, setUsageError] = useState('')
    const [usageForms, setUsageForms] = useState({})
    const [addingUsageCaseId, setAddingUsageCaseId] = useState(null)
    const [usageAddError, setUsageAddError] = useState('')
    const [deletingUsageKey, setDeletingUsageKey] = useState(null)

    const [editingCaseId, setEditingCaseId] = useState(null)
    const [editForm, setEditForm] = useState(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const [editError, setEditError] = useState('')
    const [deletingCaseId, setDeletingCaseId] = useState(null)

    const flashNotice = useCallback((message, tone = 'success') => {
        setNotice({ message, tone })
        window.setTimeout(() => setNotice(null), 3500)
    }, [])

    const refreshCases = useCallback(async () => {
        if (!canManage) return
        // Defer the busy flag so a mount effect doesn't synchronously cascade renders.
        await Promise.resolve()
        setCasesLoading(true)
        setCasesError('')
        try {
            const query = new URLSearchParams({
                domain,
                patient_id: String(numericPatientId),
                limit: '200',
            })
            const data = await requestJson(`/api/database/cases?${query.toString()}`, { cache: 'no-store' })
            setCases(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setCasesError(error?.message || 'Failed to load cases')
        } finally {
            setCasesLoading(false)
        }
    }, [canManage, domain, numericPatientId])

    const refreshUsage = useCallback(async (caseId) => {
        if (!caseId || !domain) return
        setUsageLoadingCaseId(caseId)
        setUsageError('')
        try {
            const query = new URLSearchParams({ domain, limit: '1000' })
            const data = await requestJson(`/api/database/cases/${encodeURIComponent(caseId)}/usage?${query.toString()}`, { cache: 'no-store' })
            setUsageByCase((previous) => ({
                ...previous,
                [caseId]: Array.isArray(data?.data) ? data.data : [],
            }))
        } catch (error) {
            setUsageError(error?.message || 'Failed to load usage')
        } finally {
            setUsageLoadingCaseId(null)
        }
    }, [domain])

    // The panel is rendered with a `key` per (domain, patient), so its state
    // starts fresh for every patient. This effect only fetches the initial list.
    useEffect(() => {
        // Loading on mount is a deliberate external-data fetch (not a derived state
        // update); the rule below flags the loading-state setter inside refreshCases.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshCases()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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

    const isExpanded = useCallback((caseId) => expandedIds.includes(caseId), [expandedIds])

    const toggleExpanded = useCallback(async (caseRow) => {
        const caseId = caseRow?.id
        if (!caseId) return

        if (isExpanded(caseId)) {
            setExpandedIds((previous) => previous.filter((id) => id !== caseId))
            return
        }

        setExpandedIds((previous) => [...previous, caseId])
        if (!(caseId in usageByCase)) {
            await refreshUsage(caseId)
        }
    }, [isExpanded, refreshUsage, usageByCase])

    const handleRefresh = useCallback(async () => {
        await refreshCases()
        for (const caseId of expandedIds) {
            await refreshUsage(caseId)
        }
    }, [expandedIds, refreshCases, refreshUsage])

    const totalUsed = useMemo(() => {
        const totals = {}
        for (const row of cases) {
            totals[row.id] = Number(row.used_quantity || 0)
        }
        return totals
    }, [cases])

    const handleCreateCase = async (event) => {
        event.preventDefault()
        if (!canManage) return
        setCreating(true)
        setCreateError('')
        try {
            const data = await requestJson('/api/database/cases', {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    patient_id: numericPatientId,
                    patient_name: String(patientName || '').trim() || null,
                    ...newCaseForm,
                }),
            })
            const createdCase = data?.case
            flashNotice(`Case ${createdCase?.case_number || ''} created.`)
            setNewCaseForm(createBlankCaseForm())
            setShowCreateForm(false)
            await refreshCases()
            if (createdCase?.id) {
                setExpandedIds((previous) => (previous.includes(createdCase.id) ? previous : [...previous, createdCase.id]))
            }
        } catch (error) {
            setCreateError(error?.message || 'Failed to create case')
        } finally {
            setCreating(false)
        }
    }

    const startEditing = (caseRow) => {
        setEditingCaseId(caseRow.id)
        setEditError('')
        setEditForm({
            case_number: caseRow.case_number || '',
            case_type: caseRow.case_type || 'budget',
            total_allocation: caseRow.total_allocation === 0 && caseRow.total_allocation !== undefined
                ? ''
                : String(caseRow.total_allocation ?? ''),
            practitioner: caseRow.practitioner || '',
            issue_date: caseRow.issue_date || '',
            expiry_date: caseRow.expiry_date || '',
            disable_exceeding: Boolean(caseRow.disable_exceeding),
            referral_contact: caseRow.referral_contact || '',
            referral_issue_date: caseRow.referral_issue_date || '',
            referral_period: caseRow.referral_period || '',
            notes: caseRow.notes || '',
        })
        setExpandedIds((previous) => (previous.includes(caseRow.id) ? previous : [...previous, caseRow.id]))
    }

    const cancelEditing = () => {
        setEditingCaseId(null)
        setEditForm(null)
        setEditError('')
    }

    const handleSaveEdit = async (event, caseRow) => {
        event.preventDefault()
        if (!caseRow?.id || !editForm) return
        setSavingEdit(true)
        setEditError('')
        try {
            const payload = {
                ...editForm,
                disable_exceeding: Boolean(editForm.disable_exceeding),
            }
            const query = new URLSearchParams({ domain })
            const data = await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            })
            flashNotice(`Case ${data?.case?.case_number || ''} updated.`)
            setEditingCaseId(null)
            setEditForm(null)
            await refreshCases()
        } catch (error) {
            setEditError(error?.message || 'Failed to update case')
        } finally {
            setSavingEdit(false)
        }
    }

    const handleCloseCase = async (caseRow) => {
        if (!caseRow?.id) return
        const confirmed = window.confirm(`Close case ${caseRow.case_number || ''}? New usage can no longer be logged until it is reopened.`)
        if (!confirmed) return
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'closed' }),
            })
            flashNotice(`Case ${caseRow.case_number || ''} closed.`)
            await refreshCases()
        } catch (error) {
            setCasesError(error?.message || 'Failed to close case')
        }
    }

    const handleReopenCase = async (caseRow) => {
        if (!caseRow?.id) return
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}?${query.toString()}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'open' }),
            })
            flashNotice(`Case ${caseRow.case_number || ''} reopened.`)
            await refreshCases()
        } catch (error) {
            setCasesError(error?.message || 'Failed to reopen case')
        }
    }

    const handleDeleteCase = async (caseRow) => {
        if (!caseRow?.id) return
        const usageCount = usageByCase[caseRow.id]?.length || 0
        const confirmed = window.confirm(
            `Delete case ${caseRow.case_number || ''}?${usageCount > 0 ? ` This will also delete its ${usageCount} usage entr${usageCount === 1 ? 'y' : 'ies'}.` : ''} This action cannot be undone.`
        )
        if (!confirmed) return
        setDeletingCaseId(caseRow.id)
        setCasesError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}?${query.toString()}`, {
                method: 'DELETE',
            })
            flashNotice(`Case ${caseRow.case_number || ''} deleted.`)
            setExpandedIds((previous) => previous.filter((id) => id !== caseRow.id))
            setUsageByCase((previous) => {
                const next = { ...previous }
                delete next[caseRow.id]
                return next
            })
            await refreshCases()
        } catch (error) {
            setCasesError(error?.message || 'Failed to delete case')
        } finally {
            setDeletingCaseId(null)
        }
    }

    const updateUsageForm = (caseId, field, value) => {
        setUsageForms((previous) => ({
            ...previous,
            [caseId]: {
                ...(previous[caseId] || createBlankUsageForm()),
                [field]: value,
            },
        }))
    }

    const handleAddUsage = async (event, caseRow) => {
        event.preventDefault()
        if (!caseRow?.id) return

        const currentForm = usageForms[caseRow.id] || createBlankUsageForm()
        const quantity = Number(currentForm.quantity)
        if (!currentForm.entry_date) {
            setUsageAddError('Please choose an entry date.')
            return
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setUsageAddError('Quantity must be greater than zero.')
            return
        }

        setAddingUsageCaseId(caseRow.id)
        setUsageAddError('')
        try {
            const data = await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}/usage`, {
                method: 'POST',
                body: JSON.stringify({
                    domain,
                    entry_date: currentForm.entry_date,
                    quantity,
                    description: String(currentForm.description || '').trim() || null,
                    source: 'admin-patient-cases',
                }),
            })
            const unit = getTypeConfig(caseRow.case_type).allocationUnit
            flashNotice(`Logged ${quantity} ${unit} against ${caseRow.case_number || 'case'}.`)
            setUsageForms((previous) => ({
                ...previous,
                [caseRow.id]: createBlankUsageForm(),
            }))
            await refreshUsage(caseRow.id)
            await refreshCases()
        } catch (error) {
            setUsageAddError(error?.message || 'Failed to log usage')
        } finally {
            setAddingUsageCaseId(null)
        }
    }

    const handleDeleteUsage = async (caseRow, usageRow) => {
        if (!caseRow?.id || !usageRow?.id) return
        const confirmed = window.confirm('Delete this usage entry? This action cannot be undone.')
        if (!confirmed) return

        const key = `${caseRow.id}:${usageRow.id}`
        setDeletingUsageKey(key)
        setUsageError('')
        try {
            const query = new URLSearchParams({ domain })
            await requestJson(`/api/database/cases/${encodeURIComponent(caseRow.id)}/usage/${encodeURIComponent(usageRow.id)}?${query.toString()}`, {
                method: 'DELETE',
            })
            flashNotice('Usage entry deleted.')
            await refreshUsage(caseRow.id)
            await refreshCases()
        } catch (error) {
            setUsageError(error?.message || 'Failed to delete usage entry')
        } finally {
            setDeletingUsageKey(null)
        }
    }

    if (!canManage) {
        return (
            <section className="space-y-3">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Save the patient first, then you can add funding cases here.
                </p>
            </section>
        )
    }

    const emptyCreateForm = !newCaseForm || typeof newCaseForm !== 'object'

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">Funding Cases</h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Track an allocation (budget, hours or sessions) issued to {String(domainDisplayName || domain || '').trim() || 'this patient'} for a funding stream.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={casesLoading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {casesLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowCreateForm((previous) => !previous)
                            setCreateError('')
                            if (!showCreateForm) setNewCaseForm(createBlankCaseForm())
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                        {showCreateForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {showCreateForm ? 'Cancel' : 'New case'}
                    </button>
                </div>
            </div>

            {notice && (
                <p className={`rounded-md border px-3 py-2 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {notice.message}
                </p>
            )}
            {casesError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{casesError}</p>
            )}

            {showCreateForm && (
                <form onSubmit={handleCreateCase} className="rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-gray-900">New Case</h4>
                        {creating && <p className="text-xs text-gray-500">Creating…</p>}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Case number</span>
                            <input
                                type="text"
                                value={emptyCreateForm ? '' : newCaseForm.case_number}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, case_number: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Auto (e.g. CASE-0001)"
                            />
                            <span className="mt-1 block text-[11px] text-gray-400">Leave blank to auto-generate a sequential number. You can edit it later.</span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Tracking type</span>
                            <select
                                value={emptyCreateForm ? 'budget' : newCaseForm.case_type}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, case_type: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {CASE_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Total allocation</span>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={emptyCreateForm ? '' : newCaseForm.total_allocation}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, total_allocation: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder={getTypeConfig(emptyCreateForm ? 'budget' : newCaseForm.case_type).value === 'budget' ? '0.00' : '0'}
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Assigned practitioner</span>
                            <input
                                type="text"
                                value={emptyCreateForm ? '' : newCaseForm.practitioner}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, practitioner: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="e.g. Kate"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Issue date</span>
                            <input
                                type="date"
                                value={emptyCreateForm ? '' : newCaseForm.issue_date}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, issue_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Expiry date</span>
                            <input
                                type="date"
                                value={emptyCreateForm ? '' : newCaseForm.expiry_date}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, expiry_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block md:col-span-3">
                            <span className="text-xs font-medium text-gray-700">Referral details</span>
                            <span className="mt-1 block text-[11px] text-gray-400">Referring contact, referral issue date, and validity period for the funding/referral (e.g. Medicare/NDIS/private).</span>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Referring contact</span>
                            <input
                                type="text"
                                value={emptyCreateForm ? '' : newCaseForm.referral_contact}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, referral_contact: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Doctor or plan manager"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Referral issue date</span>
                            <input
                                type="date"
                                value={emptyCreateForm ? '' : newCaseForm.referral_issue_date}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, referral_issue_date: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Referral period</span>
                            <input
                                type="text"
                                value={emptyCreateForm ? '' : newCaseForm.referral_period}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, referral_period: event.target.value }))}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="e.g. 12 months"
                            />
                        </label>
                        <label className="block md:col-span-3">
                            <span className="text-xs font-medium text-gray-700">Notes</span>
                            <textarea
                                value={emptyCreateForm ? '' : newCaseForm.notes}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, notes: event.target.value }))}
                                className="mt-1 min-h-[72px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Internal notes for quick reference"
                            />
                        </label>
                        <label className="flex items-center gap-2 md:col-span-3">
                            <input
                                type="checkbox"
                                checked={emptyCreateForm ? false : Boolean(newCaseForm.disable_exceeding)}
                                onChange={(event) => setNewCaseForm((previous) => ({ ...previous, disable_exceeding: event.target.checked }))}
                                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                            />
                            <span className="text-xs font-medium text-gray-700">Disable exceeding — prevent logging usage once the allocation is fully used</span>
                        </label>
                    </div>

                    {createError && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>
                    )}

                    <div className="mt-3 flex items-center justify-end">
                        <button
                            type="submit"
                            disabled={creating}
                            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {creating ? 'Creating…' : 'Create case'}
                        </button>
                    </div>
                </form>
            )}

            {cases.length === 0 && !casesLoading && (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                    No funding cases yet for this patient. Click “New case” to allocate a budget, hours or session package.
                </p>
            )}

            {cases.length === 0 && casesLoading && (
                <p className="px-2 text-sm text-gray-500">Loading cases…</p>
            )}

            {cases.map((caseRow) => {
                const caseId = caseRow.id
                const config = getTypeConfig(caseRow.case_type)
                const used = Number(totalUsed[caseId] || 0)
                const total = Number(caseRow.total_allocation || 0)
                const remaining = Math.max(total - used, 0)
                const over = total > 0 && used > total
                const percent = total > 0 ? Math.min((used / total) * 100, 100) : 0
                const status = deriveCaseStatus(caseRow)
                const expanded = isExpanded(caseId)
                const usageRows = usageByCase[caseId] || []
                const usageForm = usageForms[caseId] || createBlankUsageForm()
                const editingThis = editingCaseId === caseId
                const caseClosed = status === 'closed'
                const caseExpired = status === 'expired'

                return (
                    <div key={caseId} className="rounded-md border border-gray-200">
                        <div className="border-b border-gray-100 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => toggleExpanded(caseRow)}
                                        className="inline-flex items-center gap-1 rounded text-sm font-semibold text-gray-900 hover:text-gray-600"
                                        title={expanded ? 'Collapse case' : 'Expand case'}
                                    >
                                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        {caseRow.case_number || `Case #${caseId}`}
                                    </button>
                                    <CaseTypeBadge caseType={caseRow.case_type} />
                                    <StatusPill status={status} />
                                    {caseRow.external_id && (
                                        <span
                                            className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"
                                            title={`Imported from ${caseRow.external_source || 'an external source'}`}
                                        >
                                            Imported
                                        </span>
                                    )}
                                    {caseRow.practitioner && (
                                        <span className="text-xs text-gray-500">· {caseRow.practitioner}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {!editingThis && (
                                        <button
                                            type="button"
                                            onClick={() => startEditing(caseRow)}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            <Pencil className="h-3 w-3" /> Edit
                                        </button>
                                    )}
                                    {!caseClosed && !caseExpired && (
                                        <button
                                            type="button"
                                            onClick={() => handleCloseCase(caseRow)}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        >
                                            <Ban className="h-3 w-3" /> Close
                                        </button>
                                    )}
                                    {caseClosed && (
                                        <button
                                            type="button"
                                            onClick={() => handleReopenCase(caseRow)}
                                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                        >
                                            <RotateCcw className="h-3 w-3" /> Reopen
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteCase(caseRow)}
                                        disabled={deletingCaseId === caseId}
                                        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {deletingCaseId === caseId ? 'Deleting…' : <Trash2 className="h-3 w-3" />}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-500 md:grid-cols-3">
                                <span>
                                    Issue: <span className="font-medium text-gray-700">{formatDisplayDate(caseRow.issue_date)}</span>
                                </span>
                                <span>
                                    Expires: <span className="font-medium text-gray-700">{formatDisplayDate(caseRow.expiry_date)}</span>
                                </span>
                                <span className="md:text-right">
                                    Used: <span className={`font-semibold ${over ? 'text-red-600' : 'text-gray-900'}`}>{formatAllocation(caseRow.case_type, used)}</span>
                                    {' · '}
                                    Remaining: <span className="font-semibold text-gray-900">{formatAllocation(caseRow.case_type, remaining)}</span>
                                    {' · '}
                                    of {formatAllocation(caseRow.case_type, total)}
                                </span>
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                    <div
                                        className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${percent}%` }}
                                    />
                                </div>
                                <span className={`text-xs font-semibold ${over ? 'text-red-600' : 'text-gray-600'}`}>
                                    {total > 0 ? `${Math.round((used / total) * 100)}%` : 'No allocation'}
                                </span>
                            </div>

                            {caseRow.disable_exceeding && (
                                <p className="mt-2 text-[11px] text-gray-400">
                                    Exceeding this allocation is disabled — usage stops at {formatAllocation(caseRow.case_type, total)}.
                                </p>
                            )}
                        </div>

                        {expanded && (
                            <div className="space-y-4 p-4">
                                {editingThis ? (
                                    <form onSubmit={(event) => handleSaveEdit(event, caseRow)} className="rounded-md border border-gray-200 p-3">
                                        <h5 className="text-sm font-semibold text-gray-900">Edit case</h5>
                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Case number</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.case_number || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, case_number: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Tracking type</span>
                                                <select
                                                    value={editForm?.case_type || 'budget'}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, case_type: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                >
                                                    {CASE_TYPE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Total allocation</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={editForm?.total_allocation ?? ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, total_allocation: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Assigned practitioner</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.practitioner || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, practitioner: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Issue date</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.issue_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, issue_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Expiry date</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.expiry_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, expiry_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Referring contact</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.referral_contact || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, referral_contact: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Referral issue date</span>
                                                <input
                                                    type="date"
                                                    value={editForm?.referral_issue_date || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, referral_issue_date: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="text-xs font-medium text-gray-700">Referral period</span>
                                                <input
                                                    type="text"
                                                    value={editForm?.referral_period || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, referral_period: event.target.value }))}
                                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    placeholder="e.g. 12 months"
                                                />
                                            </label>
                                            <label className="block md:col-span-3">
                                                <span className="text-xs font-medium text-gray-700">Notes</span>
                                                <textarea
                                                    value={editForm?.notes || ''}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, notes: event.target.value }))}
                                                    className="mt-1 min-h-[64px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="flex items-center gap-2 md:col-span-3">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(editForm?.disable_exceeding)}
                                                    onChange={(event) => setEditForm((previous) => ({ ...previous, disable_exceeding: event.target.checked }))}
                                                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                                                />
                                                <span className="text-xs font-medium text-gray-700">Disable exceeding</span>
                                            </label>
                                        </div>

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
                                ) : (
                                    <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-gray-600 md:grid-cols-2">
                                        <div>
                                            <span className="font-semibold text-gray-900">Practitioner:</span> {caseRow.practitioner || '-'}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">Total allocation:</span> {formatAllocation(caseRow.case_type, total)}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">Disable exceeding:</span> {caseRow.disable_exceeding ? 'Yes' : 'No'}
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-900">Created:</span> {formatDisplayDate(caseRow.created_at ? String(caseRow.created_at).slice(0, 10) : '')}
                                        </div>
                                        {caseRow.referral_contact && (
                                            <div>
                                                <span className="font-semibold text-gray-900">Referring contact:</span> {caseRow.referral_contact}
                                            </div>
                                        )}
                                        {caseRow.referral_issue_date && (
                                            <div>
                                                <span className="font-semibold text-gray-900">Referral issue date:</span> {formatDisplayDate(caseRow.referral_issue_date)}
                                            </div>
                                        )}
                                        {caseRow.referral_period && (
                                            <div>
                                                <span className="font-semibold text-gray-900">Referral period:</span> {caseRow.referral_period}
                                            </div>
                                        )}
                                        {caseRow.notes && (
                                            <div className="md:col-span-2">
                                                <span className="font-semibold text-gray-900">Notes:</span> {caseRow.notes}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {(caseClosed || caseExpired) && (
                                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        {caseExpired
                                            ? 'This case has expired. Extend the expiry date to log more usage.'
                                            : 'This case is closed. Reopen it to log more usage.'}
                                    </p>
                                )}

                                <div>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Usage log</h5>
                                        {usageLoadingCaseId === caseId && <p className="text-xs text-gray-500">Loading…</p>}
                                    </div>
                                    <div className="mt-2 overflow-x-auto rounded-md border border-gray-200">
                                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Date</th>
                                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Description</th>
                                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">{config.quantityLabel}</th>
                                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 bg-white">
                                                {usageRows.map((usage) => {
                                                    const deletingKey = `${caseId}:${usage.id}`
                                                    return (
                                                        <tr key={usage.id}>
                                                            <td className="px-3 py-2 text-gray-700">{formatDisplayDate(usage.entry_date)}</td>
                                                            <td className="px-3 py-2 text-gray-700">{usage.description || '-'}</td>
                                                            <td className="px-3 py-2 text-gray-700">
                                                                {config.value === 'budget'
                                                                    ? `$${Number(usage.quantity || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                                                    : `${usage.quantity} ${config.allocationUnit}`}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteUsage(caseRow, usage)}
                                                                    disabled={deletingUsageKey === deletingKey}
                                                                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {deletingUsageKey === deletingKey ? 'Deleting…' : 'Delete'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                                {usageLoadingCaseId !== caseId && usageRows.length === 0 && (
                                                    <tr>
                                                        <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                                                            No usage logged for this case yet.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    {!caseClosed && !caseExpired && (
                                        <form onSubmit={(event) => handleAddUsage(event, caseRow)} className="mt-2 rounded-md border border-gray-200 p-3">
                                            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Log usage</h5>
                                            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-4">
                                                <label className="block">
                                                    <span className="text-xs font-medium text-gray-700">Date</span>
                                                    <input
                                                        type="date"
                                                        value={usageForm.entry_date}
                                                        onChange={(event) => updateUsageForm(caseId, 'entry_date', event.target.value)}
                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                    />
                                                </label>
                                                <label className="block">
                                                    <span className="text-xs font-medium text-gray-700">{config.quantityLabel}</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step={config.quantityStep}
                                                        value={usageForm.quantity}
                                                        onChange={(event) => updateUsageForm(caseId, 'quantity', event.target.value)}
                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        placeholder={config.value === 'budget' ? '0.00' : '0'}
                                                    />
                                                    <span className="mt-1 block text-[11px] text-gray-400">{config.quantityHint}</span>
                                                </label>
                                                <label className="block md:col-span-2">
                                                    <span className="text-xs font-medium text-gray-700">Description</span>
                                                    <input
                                                        type="text"
                                                        value={usageForm.description}
                                                        onChange={(event) => updateUsageForm(caseId, 'description', event.target.value)}
                                                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        placeholder="e.g. OT functional capacity assessment"
                                                    />
                                                </label>
                                            </div>
                                            {usageAddError && (
                                                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{usageAddError}</p>
                                            )}
                                            <div className="mt-2 flex items-center justify-end">
                                                <button
                                                    type="submit"
                                                    disabled={addingUsageCaseId === caseId}
                                                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {addingUsageCaseId === caseId ? 'Logging…' : 'Log usage'}
                                                </button>
                                            </div>
                                        </form>
                                    )}
                                    {usageError && (
                                        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{usageError}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </section>
    )
}
