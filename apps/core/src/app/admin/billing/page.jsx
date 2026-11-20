'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { BILLING_EVENT_TYPES } from '@/lib/billingMetadata'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const DEFAULT_FORM = {
    id: null,
    billing_account_id: '',
    billing_account_name: '',
    eventType: 'invoice',
    invoiceId: '',
    paymentId: '',
    status: '',
    amount: '',
    occurredAt: '',
    note: '',
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function toLocalDatetimeInput(value) {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''

    const pad = (num) => String(num).padStart(2, '0')
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toIsoOrNull(localValue) {
    const text = String(localValue || '').trim()
    if (!text) return null
    const date = new Date(text)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function toFormFromRecord(record) {
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
    return {
        id: record?.id || null,
        billing_account_id: String(record?.account_id || '').trim(),
        billing_account_name: String(record?.account_name || '').trim(),
        eventType: String(metadata.eventType || 'note').trim() || 'note',
        invoiceId: String(metadata.invoiceId || '').trim(),
        paymentId: String(metadata.paymentId || '').trim(),
        status: String(metadata.status || '').trim(),
        amount: metadata.amount === null || metadata.amount === undefined ? '' : String(metadata.amount),
        occurredAt: toLocalDatetimeInput(metadata.occurredAt),
        note: String(metadata.note || '').trim(),
    }
}

function formatListAmount(value) {
    if (value === null || value === undefined || value === '') return '-'

    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return '-'

    const absoluteLabel = Math.abs(numericValue).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

    return `${numericValue < 0 ? '-$' : '$'}${absoluteLabel}`
}

function normalizeAccountOptionMap(records, patients) {
    const optionMap = new Map()

    for (const record of Array.isArray(records) ? records : []) {
        const accountId = String(record?.account_id || '').trim()
        const accountName = String(record?.account_name || '').trim()
        if (!accountId || !accountName) continue

        const key = `${accountName.toLowerCase()}::${accountId}`
        if (!optionMap.has(key)) {
            optionMap.set(key, { id: accountId, name: accountName })
        }
    }

    for (const patient of Array.isArray(patients) ? patients : []) {
        const patientId = String(patient?.id || '').trim()
        const patientName = String(patient?.patient_name || '').trim()
        if (!patientId || !patientName) continue

        const key = `${patientName.toLowerCase()}::${patientId}`
        if (!optionMap.has(key)) {
            optionMap.set(key, { id: patientId, name: patientName })
        }
    }

    return Array.from(optionMap.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function BillingModal({
    isOpen,
    form,
    accountOptions,
    submitting,
    deletingId,
    billingEnabled,
    formError,
    onClose,
    onSubmit,
    onReset,
    onDelete,
    onSetFormField,
}) {
    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
            <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">{form.id ? 'Edit Billing Event' : 'Add Billing Event'}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                </div>

                <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Billing account name</span>
                            <input
                                type="text"
                                value={form.billing_account_name}
                                onChange={(event) => onSetFormField('billing_account_name', event.target.value)}
                                list="billing-account-name-options"
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Patient Name"
                            />
                            <datalist id="billing-account-name-options">
                                {accountOptions.map((option) => (
                                    <option key={`${option.id}-${option.name}`} value={option.name} label={`${option.name} (${option.id})`} />
                                ))}
                            </datalist>
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Billing account ID *</span>
                            <input
                                type="text"
                                value={form.billing_account_id}
                                readOnly
                                className="mt-1 w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                                placeholder="Auto-filled from account name"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Event type</span>
                            <select
                                value={form.eventType}
                                onChange={(event) => onSetFormField('eventType', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {BILLING_EVENT_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Status</span>
                            <input
                                type="text"
                                value={form.status}
                                onChange={(event) => onSetFormField('status', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="paid"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Invoice ID</span>
                            <input
                                type="text"
                                value={form.invoiceId}
                                onChange={(event) => onSetFormField('invoiceId', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="inv-0001"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Payment ID</span>
                            <input
                                type="text"
                                value={form.paymentId}
                                onChange={(event) => onSetFormField('paymentId', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="pay-0001"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Occurred at</span>
                            <input
                                type="datetime-local"
                                value={form.occurredAt}
                                onChange={(event) => onSetFormField('occurredAt', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            />
                        </label>

                        <label className="block">
                            <span className="text-xs font-medium text-gray-700">Amount</span>
                            <input
                                type="number"
                                step="0.01"
                                value={form.amount}
                                onChange={(event) => onSetFormField('amount', event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="120.00"
                            />
                        </label>

                        <label className="block md:col-span-3">
                            <span className="text-xs font-medium text-gray-700">Note</span>
                            <textarea
                                value={form.note}
                                onChange={(event) => onSetFormField('note', event.target.value)}
                                className="mt-1 min-h-[88px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Additional billing context"
                            />
                        </label>
                    </div>
                </div>

                {formError && (
                    <p className="mx-6 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
                )}

                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                    <div>
                        {form.id && (
                            <button
                                type="button"
                                onClick={() => onDelete(form.id)}
                                disabled={deletingId === form.id || submitting}
                                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {deletingId === form.id ? 'Deleting...' : 'Delete Billing Event'}
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onReset}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={!billingEnabled || submitting}
                            className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {submitting ? 'Saving...' : form.id ? 'Update Billing Event' : 'Add Billing Event'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function BillingPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const clearCreateQueryParam = useCallback(() => {
        if (typeof window === 'undefined') return

        const url = new URL(window.location.href)
        if (!url.searchParams.has('create')) return

        url.searchParams.delete('create')
        const nextPath = `${url.pathname}${url.search}${url.hash}`
        router.replace(nextPath)
    }, [router])

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [billingEnabled, setBillingEnabled] = useState(false)
    const [billingCurrency, setBillingCurrency] = useState('AUD')

    const [records, setRecords] = useState([])
    const [patients, setPatients] = useState([])
    const [loadingRecords, setLoadingRecords] = useState(false)
    const [searchAccountId, setSearchAccountId] = useState('')
    const [showModal, setShowModal] = useState(false)

    const [form, setForm] = useState(DEFAULT_FORM)
    const [submitting, setSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState(null)

    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')
    const [formError, setFormError] = useState('')

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    const refreshBilling = useCallback(async (domain) => {
        if (!domain) return

        setLoadingRecords(true)
        try {
            const query = new URLSearchParams({ domain, limit: '300' })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/billing?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load billing records')
            }

            setRecords(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setRecords([])
            setStatusMessage(error?.message || 'Failed to load billing records')
            setStatusTone('error')
        } finally {
            setLoadingRecords(false)
        }
    }, [getAdminAuthHeaders])

    const refreshPatients = useCallback(async (domain) => {
        if (!domain) return

        try {
            const response = await fetchWithTimeout(`/api/database/patients?domain=${encodeURIComponent(domain)}&limit=500`, {
                cache: 'no-store',
                headers: await getAdminAuthHeaders(),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load patients')
            }

            setPatients(Array.isArray(data?.data) ? data.data : [])
        } catch {
            setPatients([])
        }
    }, [getAdminAuthHeaders])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { billingEnabled: false, billingCurrency: 'AUD' }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                billingEnabled: domainSettings?.patientsEnabled === true && domainSettings?.patientBillingEnabled === true,
                billingCurrency: String(domainSettings?.billingCurrency || 'AUD').trim().toUpperCase() || 'AUD',
            }
        } catch {
            return { billingEnabled: false, billingCurrency: 'AUD' }
        }
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

                const domainFeatureState = await loadDomainFeatureState(token, effectiveDomain)
                if (cancelled) return

                setActiveDomain(effectiveDomain)
                setBillingEnabled(domainFeatureState.billingEnabled)
                setBillingCurrency(domainFeatureState.billingCurrency)
                setIsAuthenticated(true)
                await Promise.all([
                    refreshBilling(effectiveDomain),
                    refreshPatients(effectiveDomain),
                ])

            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize billing view')
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
    }, [router, loadDomainFeatureState, refreshBilling, refreshPatients])

    useEffect(() => {
        if (!isAuthenticated || !billingEnabled) return
        if (searchParams.get('create') !== '1') return
        if (showModal) return

        const timeoutId = window.setTimeout(() => {
            setForm(DEFAULT_FORM)
            setFormError('')
            setShowModal(true)
            clearCreateQueryParam()
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [isAuthenticated, billingEnabled, searchParams, showModal, clearCreateQueryParam])

    const filteredRecords = useMemo(() => {
        const query = String(searchAccountId || '').trim().toLowerCase()
        if (!query) return records

        return records.filter((record) => String(record?.account_id || '').toLowerCase().includes(query))
    }, [records, searchAccountId])

    const accountOptions = useMemo(() => {
        return normalizeAccountOptionMap(records, patients)
    }, [records, patients])

    const setFormField = (field, value) => {
        if (field === 'billing_account_name') {
            const nextName = String(value || '')
            const exactMatch = accountOptions.find((option) => option.name.toLowerCase() === nextName.trim().toLowerCase())
            setForm((prev) => {
                const nextAccountId = prev?.id
                    ? String(prev.billing_account_id || '')
                    : (exactMatch ? String(exactMatch.id || '') : '')

                return {
                    ...prev,
                    billing_account_name: nextName,
                    billing_account_id: nextAccountId,
                }
            })
            return
        }

        setForm((prev) => ({ ...prev, [field]: value }))
    }

    const resetForm = () => {
        setForm(DEFAULT_FORM)
        setFormError('')
    }

    const openCreateModal = () => {
        resetForm()
        setShowModal(true)
        clearCreateQueryParam()
    }

    const closeModal = () => {
        setShowModal(false)
        resetForm()
        clearCreateQueryParam()
    }

    const handleSubmit = async () => {
        const billingAccountId = String(form.billing_account_id || '').trim()
        if (!billingAccountId) {
            setFormError('Billing account ID is required.')
            return
        }

        setSubmitting(true)
        setFormError('')

        try {
            const amountText = String(form.amount || '').trim()
            const payload = {
                account_id: billingAccountId,
                account_name: String(form.billing_account_name || '').trim() || null,
                domain: activeDomain,
                metadata: {
                    eventType: String(form.eventType || 'note').trim().toLowerCase(),
                    invoiceId: String(form.invoiceId || '').trim() || null,
                    paymentId: String(form.paymentId || '').trim() || null,
                    status: String(form.status || '').trim().toLowerCase() || null,
                    amount: amountText ? Number.parseFloat(amountText) : null,
                    currency: billingCurrency,
                    occurredAt: toIsoOrNull(form.occurredAt),
                    note: String(form.note || '').trim() || null,
                    source: 'admin-billing',
                },
            }

            const isEdit = Boolean(form.id)
            const endpoint = isEdit
                ? `/api/database/billing/${encodeURIComponent(String(form.id))}?domain=${encodeURIComponent(activeDomain)}`
                : '/api/database/billing'
            const authHeaders = await getAdminAuthHeaders()

            const response = await fetch(endpoint, {
                method: isEdit ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify(payload),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || (isEdit ? 'Failed to update billing record' : 'Failed to create billing record'))
            }

            setStatusMessage(isEdit ? 'Billing record updated.' : 'Billing event created.')
            setStatusTone('success')
            await Promise.all([
                refreshBilling(activeDomain),
                refreshPatients(activeDomain),
            ])
            closeModal()
        } catch (error) {
            setFormError(error?.message || 'Failed to save billing record')
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = (record) => {
        setForm(toFormFromRecord(record))
        setFormError('')
        setShowModal(true)
    }

    const handleDelete = async (recordId) => {
        if (!recordId) return

        const confirmed = window.confirm('Delete this billing record? This action cannot be undone.')
        if (!confirmed) return

        setDeletingId(recordId)
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(`/api/database/billing/${encodeURIComponent(String(recordId))}?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete billing record')
            }

            setStatusMessage('Billing record deleted.')
            setStatusTone('success')
            await Promise.all([
                refreshBilling(activeDomain),
                refreshPatients(activeDomain),
            ])

            if (String(form.id || '') === String(recordId)) {
                closeModal()
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to delete billing record')
            setStatusTone('error')
        } finally {
            setDeletingId(null)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading billing...</div>
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

    return (
        <div className="min-h-screen">
            <AdminHeader title="Billing" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
                            <p className="mt-1 text-sm text-gray-600">Create and manage billing events.</p>
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
                                onClick={() => openCreateModal()}
                                disabled={!billingEnabled}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Add Billing Event
                            </button>
                            <button
                                type="button"
                                onClick={() => Promise.all([
                                    refreshBilling(activeDomain),
                                    refreshPatients(activeDomain),
                                ])}
                                disabled={loadingRecords}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingRecords ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {statusMessage && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    )}

                    {!billingEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Billing is disabled. Enable Patients and Patient Billing in Domain Settings first.
                        </p>
                    )}
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-base font-semibold text-gray-900">Billing Records</h2>
                        <input
                            type="text"
                            value={searchAccountId}
                            onChange={(event) => setSearchAccountId(event.target.value)}
                            className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
                            placeholder="Filter by billing account ID"
                        />
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Account ID</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Account Name</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Event</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Amount</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Occurred</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRecords.map((record) => {
                                    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
                                    const amountLabel = formatListAmount(metadata.amount)
                                    const occurredLabel = metadata.occurredAt
                                        ? new Date(metadata.occurredAt).toLocaleString()
                                        : '-'

                                    return (
                                        <tr key={record.id}>
                                            <td className="px-3 py-2 font-medium text-gray-900">{record.account_id}</td>
                                            <td className="px-3 py-2 text-gray-700">{record.account_name || '-'}</td>
                                            <td className="px-3 py-2 text-gray-700">{metadata.eventType || '-'}</td>
                                            <td className="px-3 py-2 text-gray-700">{metadata.status || '-'}</td>
                                            <td className="px-3 py-2 text-gray-700">{amountLabel}</td>
                                            <td className="px-3 py-2 text-gray-700">{occurredLabel}</td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEdit(record)}
                                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(record.id)}
                                                        disabled={deletingId === record.id}
                                                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {deletingId === record.id ? 'Deleting...' : 'Delete'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}

                                {!loadingRecords && filteredRecords.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-5 text-center text-gray-500">
                                            No billing records found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
            <BillingModal
                isOpen={showModal}
                form={form}
                accountOptions={accountOptions}
                submitting={submitting}
                deletingId={deletingId}
                billingEnabled={billingEnabled}
                formError={formError}
                onClose={closeModal}
                onSubmit={handleSubmit}
                onReset={resetForm}
                onDelete={handleDelete}
                onSetFormField={setFormField}
            />
        </div>
    )
}

export default function BillingPage() {
    return (
        <Suspense>
            <BillingPageContent />
        </Suspense>
    )
}
