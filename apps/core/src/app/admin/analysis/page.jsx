'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getAdminDomainMode } from '@/lib/adminActiveDomain'

function formatRelativeTime(value) {
    if (!value) return 'Unknown time'

    const timestamp = new Date(value).getTime()
    if (!Number.isFinite(timestamp)) return 'Unknown time'

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} minute(s) ago`
    if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} hour(s) ago`
    return `${Math.max(1, Math.floor(diffMs / day))} day(s) ago`
}

function formatDateTime(value) {
    if (!value) return 'Unknown time'
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return 'Unknown time'

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function getAnalysisStats(analysis) {
    const payload = analysis?.analysisPayload && typeof analysis.analysisPayload === 'object'
        ? analysis.analysisPayload
        : {}
    const sourceStats = payload?.sourceStats && typeof payload.sourceStats === 'object'
        ? payload.sourceStats
        : {}
    const recommendations = Array.isArray(payload?.recommendedInterventions) ? payload.recommendedInterventions : []
    const recommendationCount = recommendations.filter((item) => String(item?.intervention || '').trim()).length

    return {
        recommendationCount,
        transcriptCount: Number(sourceStats.transcriptCount || analysis?.transcriptCount || 0),
        notesLength: Number(sourceStats.notesLength || analysis?.sourceNotesLength || 0),
    }
}

export default function AnalysisListPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [analyses, setAnalyses] = useState([])
    const [error, setError] = useState('')
    const [refreshing, setRefreshing] = useState(false)
    const [search, setSearch] = useState('')
    const [activeDomainMode, setActiveDomainMode] = useState(() => getAdminDomainMode())

    useEffect(() => {
        document.title = 'Analysis'
    }, [])

    const activeDomain = useMemo(() => {
        const currentUser = getCurrentUser()
        const scopedDomainKey = String(currentUser?.domain || '').trim().toLowerCase()
        return scopedDomainKey || activeDomainMode
    }, [activeDomainMode])

    const fetchAnalyses = useCallback(async () => {
        if (!activeDomain) return

        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) {
            return { redirectToLogin: true, analyses: [] }
        }

        const query = new URLSearchParams({
            domain: activeDomain,
            limit: '100',
        })
        const response = await fetch(`/api/database/patients/analysis?${query.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load analyses')
        }

        return { redirectToLogin: false, analyses: Array.isArray(data?.data) ? data.data : [] }
    }, [activeDomain])

    useEffect(() => {
        let cancelled = false

        async function loadInitialAnalyses() {
            try {
                const result = await fetchAnalyses()
                if (cancelled) return
                if (result?.redirectToLogin) {
                    router.push('/login')
                    return
                }

                setAnalyses(Array.isArray(result?.analyses) ? result.analyses : [])
                setError('')
            } catch (loadError) {
                if (cancelled) return
                setAnalyses([])
                setError(loadError?.message || 'Failed to load analyses')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadInitialAnalyses()

        return () => {
            cancelled = true
        }
    }, [fetchAnalyses, router])

    const refreshAnalyses = async () => {
        setRefreshing(true)
        try {
            const result = await fetchAnalyses()
            if (result?.redirectToLogin) {
                router.push('/login')
                return
            }

            setAnalyses(Array.isArray(result?.analyses) ? result.analyses : [])
            setError('')
        } catch (loadError) {
            setAnalyses([])
            setError(loadError?.message || 'Failed to load analyses')
        } finally {
            setRefreshing(false)
            setLoading(false)
        }
    }

    const filteredAnalyses = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return analyses

        return analyses.filter((analysis) => {
            const haystack = [
                analysis?.patientName,
                analysis?.summaryText,
                analysis?.status,
                analysis?.patientId,
            ].join(' ').toLowerCase()
            return haystack.includes(needle)
        })
    }, [analyses, search])

    const openAnalysis = (analysis) => {
        const patientId = String(analysis?.patientId || '').trim()
        if (!patientId) return

        router.push(`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=analysis&returnTo=${encodeURIComponent('/admin/analysis')}`)
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Analysis" />

            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Recent Analyses</h1>
                        <p className="mt-1 text-sm text-gray-600">FCA Analyst intervention recommendations prepared from patient notes and transcripts.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm sm:w-72"
                            placeholder="Search analyses"
                        />
                        <button
                            type="button"
                            onClick={refreshAnalyses}
                            disabled={refreshing}
                            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {refreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 px-5 py-4">
                        <p className="text-sm font-medium text-gray-900">{filteredAnalyses.length} analysis record{filteredAnalyses.length === 1 ? '' : 's'}</p>
                    </div>

                    {error && (
                        <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>
                    )}

                    {loading ? (
                        <div className="px-5 py-10 text-sm text-gray-600">Loading analyses...</div>
                    ) : filteredAnalyses.length === 0 ? (
                        <div className="px-5 py-10 text-sm text-gray-600">No analyses found.</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {filteredAnalyses.map((analysis) => {
                                const stats = getAnalysisStats(analysis)
                                const updatedAt = analysis.updatedAt || analysis.createdAt

                                return (
                                    <button
                                        key={analysis.id || `${analysis.patientId}:${updatedAt}`}
                                        type="button"
                                        onClick={() => openAnalysis(analysis)}
                                        className="block w-full px-5 py-4 text-left transition-colors hover:bg-gray-50"
                                    >
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h2 className="truncate text-base font-semibold text-gray-900">{analysis.patientName || 'Untitled patient'}</h2>
                                                    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Ready</span>
                                                </div>
                                                <p className="mt-1 line-clamp-2 text-sm text-gray-600">{analysis.summaryText || 'Analysis ready.'}</p>
                                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                                                    <span>{stats.recommendationCount} recommendation{stats.recommendationCount === 1 ? '' : 's'}</span>
                                                    <span>{stats.transcriptCount} transcript{stats.transcriptCount === 1 ? '' : 's'}</span>
                                                    <span>{stats.notesLength.toLocaleString()} note chars</span>
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-sm text-gray-500 lg:text-right">
                                                <p>{formatRelativeTime(updatedAt)}</p>
                                                <p className="mt-1 text-xs">{formatDateTime(updatedAt)}</p>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}