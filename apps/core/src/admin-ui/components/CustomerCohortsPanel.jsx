'use client'

import { useEffect, useState } from 'react'
import { normalizeCustomerCohortKey } from '@/lib/customerCohorts'

function makeEmptyCohort() {
    return {
        key: '',
        label: '',
        usageMarkupPercent: 0,
        notes: '',
    }
}

function parseMarkupPercent(value) {
    const parsed = Number.parseFloat(String(value ?? '').trim())
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, parsed)
}

export default function CustomerCohortsPanel() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [cohorts, setCohorts] = useState([])
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    useEffect(() => {
        let cancelled = false

        async function loadCohorts() {
            try {
                const token = window.localStorage.getItem('adminToken')
                const response = await fetch('/api/settings/customer-cohorts', {
                    cache: 'no-store',
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to load customer cohorts')
                }

                if (!cancelled) {
                    setCohorts(Array.isArray(data?.cohorts) ? data.cohorts : [])
                }
            } catch (error) {
                if (!cancelled) {
                    setStatusMessage(error?.message || 'Failed to load customer cohorts')
                    setStatusTone('error')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadCohorts()
        return () => {
            cancelled = true
        }
    }, [])

    function updateCohort(index, field, value) {
        setCohorts((prev) => prev.map((cohort, cohortIndex) => {
            if (cohortIndex !== index) return cohort

            if (field === 'usageMarkupPercent') {
                return { ...cohort, usageMarkupPercent: parseMarkupPercent(value) }
            }

            if (field === 'key') {
                return { ...cohort, key: normalizeCustomerCohortKey(value) }
            }

            if (field === 'label') {
                const nextLabel = String(value || '')
                return {
                    ...cohort,
                    label: nextLabel,
                    key: cohort.key || normalizeCustomerCohortKey(nextLabel),
                }
            }

            return { ...cohort, [field]: value }
        }))
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function addCohort() {
        setCohorts((prev) => [...prev, makeEmptyCohort()])
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    function removeCohort(index) {
        setCohorts((prev) => prev.filter((_, cohortIndex) => cohortIndex !== index))
        setHasUnsavedChanges(true)
        setStatusMessage('')
        setStatusTone('neutral')
    }

    async function saveCohorts() {
        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setStatusMessage('Missing admin token. Please log in again.')
            setStatusTone('error')
            return
        }

        const preparedCohorts = cohorts.map((cohort) => ({
            ...cohort,
            key: normalizeCustomerCohortKey(cohort.key || cohort.label),
            label: String(cohort.label || '').trim(),
            notes: String(cohort.notes || '').trim(),
            usageMarkupPercent: parseMarkupPercent(cohort.usageMarkupPercent),
        }))

        if (preparedCohorts.some((cohort) => !cohort.key || !cohort.label)) {
            setStatusMessage('Each cohort needs both a key and a label.')
            setStatusTone('error')
            return
        }

        const keySet = new Set()
        for (const cohort of preparedCohorts) {
            if (keySet.has(cohort.key)) {
                setStatusMessage(`Duplicate cohort key: ${cohort.key}`)
                setStatusTone('error')
                return
            }
            keySet.add(cohort.key)
        }

        setSaving(true)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const response = await fetch('/api/settings/customer-cohorts', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ cohorts: preparedCohorts }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save customer cohorts')
            }

            setCohorts(Array.isArray(data?.cohorts) ? data.cohorts : [])
            setHasUnsavedChanges(false)
            setStatusMessage('Customer cohorts saved.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to save customer cohorts')
            setStatusTone('error')
        } finally {
            setSaving(false)
        }
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    return (
        <div className="border border-gray-300 rounded-lg p-4 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h3 className="font-semibold text-gray-900">Customer Cohorts</h3>
                    <p className="text-xs text-gray-500 mt-1">
                        Define reusable cohorts and their usage markup percentages, then assign them to domains in Domain Settings.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={addCohort}
                        className="px-3 py-2 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50"
                    >
                        Add Cohort
                    </button>
                    <button
                        type="button"
                        onClick={saveCohorts}
                        disabled={saving || loading}
                        className="px-3 py-2 text-xs text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Saving…' : 'Save Cohorts'}
                    </button>
                </div>
            </div>

            {statusMessage && (
                <p className={`mb-4 text-sm border rounded-md px-3 py-2 ${statusClasses}`}>
                    {statusMessage}
                </p>
            )}
            {hasUnsavedChanges && (
                <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    You have unsaved cohort changes.
                </p>
            )}

            {loading ? (
                <p className="text-sm text-gray-500">Loading customer cohorts…</p>
            ) : (
                <div className="space-y-3">
                    {cohorts.length === 0 && (
                        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                            No cohorts yet. Create one for cases like Family and Friends or Charter.
                        </div>
                    )}

                    {cohorts.map((cohort, index) => (
                        <div key={cohort.key || `cohort-${index}`} className="rounded-lg border border-gray-200 p-4">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                <label className="block md:col-span-3">
                                    <span className="text-xs font-medium text-gray-700">Label</span>
                                    <input
                                        type="text"
                                        value={cohort.label || ''}
                                        onChange={(e) => updateCohort(index, 'label', e.target.value)}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        placeholder="Family and Friends"
                                    />
                                </label>
                                <label className="block md:col-span-3">
                                    <span className="text-xs font-medium text-gray-700">Key</span>
                                    <input
                                        type="text"
                                        value={cohort.key || ''}
                                        onChange={(e) => updateCohort(index, 'key', e.target.value)}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        placeholder="family-and-friends"
                                    />
                                </label>
                                <label className="block md:col-span-3">
                                    <span className="text-xs font-medium text-gray-700">Usage Markup %</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={cohort.usageMarkupPercent ?? 0}
                                        onChange={(e) => updateCohort(index, 'usageMarkupPercent', e.target.value)}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        placeholder="20"
                                    />
                                </label>
                                <div className="md:col-span-3 flex items-end justify-end">
                                    <button
                                        type="button"
                                        onClick={() => removeCohort(index)}
                                        className="px-3 py-2 text-xs border border-red-200 text-red-700 rounded-md bg-red-50 hover:bg-red-100"
                                    >
                                        Remove
                                    </button>
                                </div>
                                <label className="block md:col-span-12">
                                    <span className="text-xs font-medium text-gray-700">Notes</span>
                                    <input
                                        type="text"
                                        value={cohort.notes || ''}
                                        onChange={(e) => updateCohort(index, 'notes', e.target.value)}
                                        className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                        placeholder="Optional internal note about when this cohort should be used"
                                    />
                                </label>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}