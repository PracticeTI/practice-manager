'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAdminAuthHeaders } from '@/lib/clientAdminAuth'

function buildMetadata(rawValue) {
    const text = String(rawValue || '').trim()
    if (!text) return null

    try {
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: 'Metadata must be a JSON object or empty' }
        }
        return { value: parsed }
    } catch {
        return { error: 'Metadata must be valid JSON' }
    }
}

export default function PatientsPanel({ domainKey, enabled }) {
    const [loading, setLoading] = useState(false)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState('')
    const [patients, setPatients] = useState([])
    const [patientName, setPatientName] = useState('')
    const [metadataInput, setMetadataInput] = useState('')

    const scopedDomain = useMemo(() => String(domainKey || '').trim(), [domainKey])

    const loadPatients = useCallback(async () => {
        if (!enabled || !scopedDomain) {
            setPatients([])
            return
        }

        setLoading(true)
        setError('')
        try {
            const authHeaders = await getAdminAuthHeaders()
            const response = await fetch(`/api/database/patients?domain=${encodeURIComponent(scopedDomain)}&limit=20`, {
                cache: 'no-store',
                headers: authHeaders,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load patients')
            }
            setPatients(Array.isArray(data?.data) ? data.data : [])
        } catch (fetchError) {
            setPatients([])
            setError(fetchError?.message || 'Failed to load patients')
        } finally {
            setLoading(false)
        }
    }, [enabled, scopedDomain])

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            loadPatients()
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [loadPatients])

    const createPatient = async (event) => {
        event.preventDefault()
        if (!enabled || !scopedDomain) return

        const name = String(patientName || '').trim()
        if (!name) {
            setError('Patient name is required')
            return
        }

        const metadataResult = buildMetadata(metadataInput)
        if (metadataResult?.error) {
            setError(metadataResult.error)
            return
        }

        setCreating(true)
        setError('')
        try {
            const response = await fetch('/api/database/patients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await getAdminAuthHeaders()),
                },
                body: JSON.stringify({
                    patient_name: name,
                    domain: scopedDomain,
                    metadata: metadataResult?.value ?? null,
                }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to create patient')
            }

            setPatientName('')
            setMetadataInput('')
            await loadPatients()
        } catch (createError) {
            setError(createError?.message || 'Failed to create patient')
        } finally {
            setCreating(false)
        }
    }

    return (
        <section className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Patients</h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Manage patient records for domain
                        {' '}
                        <span className="font-semibold text-gray-800">{scopedDomain || 'unknown'}</span>
                        .
                    </p>
                </div>
                <button
                    type="button"
                    onClick={loadPatients}
                    disabled={loading || !enabled}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {!enabled && (
                <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Patients is disabled. Enable it in Domain Settings to manage records.
                </p>
            )}

            {enabled && (
                <>
                    <form onSubmit={createPatient} className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3">
                        <label className="md:col-span-4 block">
                            <span className="text-xs font-medium text-gray-700">Patient Name</span>
                            <input
                                type="text"
                                value={patientName}
                                onChange={(event) => setPatientName(event.target.value)}
                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                placeholder="Jane Doe"
                            />
                        </label>

                        <label className="md:col-span-6 block">
                            <span className="text-xs font-medium text-gray-700">Metadata JSON (optional)</span>
                            <input
                                type="text"
                                value={metadataInput}
                                onChange={(event) => setMetadataInput(event.target.value)}
                                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                                placeholder='{"source":"manual"}'
                            />
                        </label>

                        <div className="md:col-span-2 flex items-end">
                            <button
                                type="submit"
                                disabled={creating}
                                className="w-full inline-flex justify-center rounded-md border border-transparent bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {creating ? 'Saving...' : 'Add Patient'}
                            </button>
                        </div>
                    </form>

                    {error && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </p>
                    )}

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-3 py-2 text-left font-semibold text-gray-700">ID</th>
                                    <th scope="col" className="px-3 py-2 text-left font-semibold text-gray-700">Patient Name</th>
                                    <th scope="col" className="px-3 py-2 text-left font-semibold text-gray-700">Domain</th>
                                    <th scope="col" className="px-3 py-2 text-left font-semibold text-gray-700">Metadata</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {patients.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 text-gray-700">{item.id}</td>
                                        <td className="px-3 py-2 text-gray-900 font-medium">{item.patient_name}</td>
                                        <td className="px-3 py-2 text-gray-700">{item.domain}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            <span className="line-clamp-2 break-all">{item.metadata ? JSON.stringify(item.metadata) : ''}</span>
                                        </td>
                                    </tr>
                                ))}

                                {!loading && patients.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                                            No patients found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    )
}