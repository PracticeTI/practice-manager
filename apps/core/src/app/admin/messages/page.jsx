'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'Unknown time'
  const timestamp = new Date(isoString).getTime()
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

function getStatusBadgeClass(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'sent' || s === 'processed' || s === 'delivered') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
  if (s === 'received' || s === 'queued' || s === 'processing') {
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }
  if (s === 'failed' || s === 'error' || s === 'bounced') {
    return 'bg-red-50 text-red-700 border-red-200'
  }
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

export default function MessagesAdminPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)

  const [messages, setMessages] = useState([])
  const [counts, setCounts] = useState({ total: 0, inbound: 0, outbound: 0 })
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState('neutral')

  const [selectedDirection, setSelectedDirection] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState('all')

  const [statusOptions, setStatusOptions] = useState([])
  const [categoryOptions, setCategoryOptions] = useState([])

  const refreshMessages = useCallback(async ({ domain, direction = 'all', status = 'all', category = 'all', search = '' } = {}) => {
    if (!domain) return

    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setMessages([])
      return
    }

    setLoadingMessages(true)
    try {
      const query = new URLSearchParams({ domain, limit: '500' })
      if (direction && direction !== 'all') query.set('direction', direction)
      if (status && status !== 'all') query.set('status', status)
      if (category && category !== 'all') query.set('category', category)
      if (search.trim()) query.set('search', search.trim())

      const response = await fetchWithTimeout(`/api/database/messages?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load messages')
      }

      setMessages(Array.isArray(data?.data) ? data.data : [])
      if (data?.counts) {
        setCounts(data.counts)
      }
      setStatusOptions(Array.isArray(data?.filters?.statuses) ? data.filters.statuses : [])
      setCategoryOptions(Array.isArray(data?.filters?.categories) ? data.filters.categories : [])
      setStatusMessage('')
      setStatusTone('neutral')
    } catch (error) {
      setMessages([])
      setStatusMessage(error?.message || 'Failed to load messages')
      setStatusTone('error')
    } finally {
      setLoadingMessages(false)
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

        setActiveDomain(effectiveDomain)
        setIsAuthenticated(true)

        await refreshMessages({ domain: effectiveDomain, direction: 'all', status: 'all', category: 'all', search: '' })
      } catch (error) {
        if (cancelled) return
        setStatusMessage(error?.message || 'Failed to initialize messages view')
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
  }, [router, refreshMessages])

  const filteredMessages = useMemo(() => messages, [messages])

  const handleApplyFilters = async () => {
    await refreshMessages({
      domain: activeDomain,
      direction: selectedDirection,
      status: selectedStatus,
      category: selectedCategory,
      search: searchText,
    })
  }

  const handleDirectionTabChange = async (dir) => {
    setSelectedDirection(dir)
    await refreshMessages({
      domain: activeDomain,
      direction: dir,
      status: selectedStatus,
      category: selectedCategory,
      search: searchText,
    })
  }

  const handleResetFilters = async () => {
    setSearchText('')
    setSelectedDirection('all')
    setSelectedStatus('all')
    setSelectedCategory('all')
    await refreshMessages({ domain: activeDomain, direction: 'all', status: 'all', category: 'all', search: '' })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-600">Loading messages admin...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Messages" brandingDomainKey={activeDomain} />

      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
              <p className="mt-1 text-sm text-gray-600">
                Inbound and outbound email messages for the active domain, including Resend receiving and sending logs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshMessages({ domain: activeDomain, direction: selectedDirection, status: selectedStatus, category: selectedCategory, search: searchText })}
              disabled={loadingMessages}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMessages ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {statusMessage && (
            <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-green-200 bg-green-50 text-green-700'
              }`}>
              {statusMessage}
            </div>
          )}

          {/* Quick Direction Tabs */}
          <div className="mt-6 border-b border-gray-200 flex gap-4">
            <button
              type="button"
              onClick={() => handleDirectionTabChange('all')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${selectedDirection === 'all'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              All Messages
              {counts.total > 0 && (
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 font-normal">
                  {counts.total}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleDirectionTabChange('inbound')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${selectedDirection === 'inbound'
                ? 'border-emerald-600 text-emerald-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              ↓ Inbound (Received)
              {counts.inbound > 0 && (
                <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 font-normal">
                  {counts.inbound}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleDirectionTabChange('outbound')}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${selectedDirection === 'outbound'
                ? 'border-blue-600 text-blue-700 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              ↑ Outbound (Sent)
              {counts.outbound > 0 && (
                <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-normal">
                  {counts.outbound}
                </span>
              )}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="md:col-span-2">
              <span className="text-xs font-medium text-gray-700">Search</span>
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleApplyFilters()
                  }
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Search subject, sender, recipient, status, category, provider"
              />
            </label>

            <label>
              <span className="text-xs font-medium text-gray-700">Status</span>
              <select
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-xs font-medium text-gray-700">Category</span>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={loadingMessages}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              disabled={loadingMessages}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Messages</h2>
            <span className="text-xs text-gray-500">{filteredMessages.length} result(s)</span>
          </div>

          <div className="mt-4 space-y-3">
            {loadingMessages && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Loading messages...
              </div>
            )}

            {!loadingMessages && filteredMessages.length === 0 && (
              <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                No messages matched your current filters.
              </div>
            )}

            {!loadingMessages && filteredMessages.map((message) => {
              const isInbound = message.direction === 'inbound'
              return (
                <button
                  key={`${message.direction || 'msg'}-${message.id}`}
                  type="button"
                  onClick={() => router.push(`/admin/messages/${encodeURIComponent(String(message.id))}?direction=${encodeURIComponent(message.direction || 'outbound')}`)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition shadow-sm hover:shadow"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${isInbound
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                          }`}>
                          {isInbound ? '↓ Inbound' : '↑ Outbound'}
                        </span>
                        {message.provider && (
                          <span className="text-xs text-gray-400 font-mono">
                            {message.provider}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900">
                        {message.subject || (isInbound ? `Inbound email from ${message.fromEmail || 'unknown'}` : `Outbound to ${message.toEmail || 'unknown'}`)}
                      </p>
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">{message.preview || 'No preview text available'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(message.status)}`}>
                        {message.status || (isInbound ? 'received' : 'queued')}
                      </span>
                      <p className="text-xs text-gray-500">Updated {formatRelativeTime(message.timestamp)}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-xs text-gray-600 border-t border-gray-100 pt-2">
                    <div>
                      <p className="font-medium text-gray-500">{isInbound ? 'From' : 'To'}</p>
                      <p className="mt-0.5 text-gray-800 break-all font-medium">
                        {isInbound ? (message.fromEmail || 'Unknown sender') : (message.toEmail || 'Unknown')}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">{isInbound ? 'To' : 'Category'}</p>
                      <p className="mt-0.5 text-gray-800 break-all">
                        {isInbound ? (message.toEmail || 'support') : (message.category || 'generic')}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">{isInbound ? 'Category' : 'Attempts'}</p>
                      <p className="mt-0.5 text-gray-800">
                        {isInbound
                          ? (message.category || 'inbound_email')
                          : `${message.attempts}${message.maxAttempts != null ? ` / ${message.maxAttempts}` : ''}`}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">Date</p>
                      <p className="mt-0.5 text-gray-800">{formatRelativeTime(message.createdAt)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
