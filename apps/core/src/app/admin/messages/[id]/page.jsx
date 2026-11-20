'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import MessageFriendlyView from '@/admin-ui/components/MessageFriendlyView'
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

function formatDateTime(isoString) {
  if (!isoString) return 'n/a'
  const date = new Date(isoString)
  if (!Number.isFinite(date.getTime())) return 'n/a'
  return date.toLocaleString()
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

export default function MessageDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
  const [message, setMessage] = useState(null)
  const [adjacentMessageIds, setAdjacentMessageIds] = useState({ previous: null, next: null })
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState('friendly')
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [showMessageDetails, setShowMessageDetails] = useState(false)
  const detailsMenuRef = useRef(null)

  const messageId = useMemo(() => String(params?.id || '').trim(), [params])
  const directionParam = useMemo(() => String(searchParams?.get('direction') || '').trim(), [searchParams])

  const loadMessage = useCallback(async (domain) => {
    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setErrorMessage('Missing admin session')
      return
    }

    const query = new URLSearchParams()
    if (domain) query.set('domain', domain)
    if (directionParam) query.set('direction', directionParam)

    const response = await fetchWithTimeout(
      `/api/database/messages/${encodeURIComponent(messageId)}${query.toString() ? `?${query.toString()}` : ''}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }
    )

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load message')
    }

    const msg = data?.message || null
    setMessage(msg)

    // Opening a website enquiry is what marks it reviewed, which is what takes it
    // off the practice-wide Tasks queue. Fire-and-forget: reading the message must
    // not wait on the marker.
    if (msg?.direction === 'outbound' && msg?.category === 'contact_form') {
      const reviewQuery = domain ? `?domain=${encodeURIComponent(String(domain))}` : ''
      fetch(`/api/database/messages/${encodeURIComponent(messageId)}${reviewQuery}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mark-reviewed' }),
      }).catch(() => { })
    }

    // The friendly view is the default read experience for every message; the
    // raw tabs stay one click away.
    setActiveTab('friendly')
  }, [messageId, directionParam])

  const loadAdjacentMessageIds = useCallback(async (domain) => {
    const token = window.localStorage.getItem('adminToken')
    if (!token) {
      setAdjacentMessageIds({ previous: null, next: null })
      return
    }

    const query = new URLSearchParams({ domain: String(domain || '').trim(), limit: '500' })
    if (directionParam) query.set('direction', directionParam)

    const response = await fetchWithTimeout(`/api/database/messages?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load adjacent messages')
    }

    const list = Array.isArray(data?.data) ? data.data : []
    const currentId = Number.parseInt(messageId, 10)
    if (!Number.isFinite(currentId) || currentId <= 0) {
      setAdjacentMessageIds({ previous: null, next: null })
      return
    }

    const index = list.findIndex((item) => Number(item?.id) === currentId)
    if (index === -1) {
      setAdjacentMessageIds({ previous: null, next: null })
      return
    }

    setAdjacentMessageIds({
      previous: list[index - 1] ? { id: String(list[index - 1].id), direction: list[index - 1].direction } : null,
      next: list[index + 1] ? { id: String(list[index + 1].id), direction: list[index + 1].direction } : null,
    })
  }, [messageId, directionParam])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        if (!messageId) {
          setErrorMessage('Invalid message id')
          return
        }

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

        await Promise.all([
          loadMessage(effectiveDomain),
          loadAdjacentMessageIds(effectiveDomain),
        ])
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error?.message || 'Failed to initialize message detail view')
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
  }, [router, messageId, loadMessage, loadAdjacentMessageIds])

  // The message metadata lives in a kebab menu, so close it on an outside click
  // or Escape like any other dropdown.
  useEffect(() => {
    if (!showMessageDetails) return

    const handlePointerDown = (event) => {
      if (detailsMenuRef.current && !detailsMenuRef.current.contains(event.target)) {
        setShowMessageDetails(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowMessageDetails(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showMessageDetails])

  const copyPayloadJson = () => {
    if (!message?.payload) return
    navigator.clipboard.writeText(JSON.stringify(message.payload, null, 2))
    setCopiedPayload(true)
    setTimeout(() => setCopiedPayload(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-600">Loading message...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const isInbound = message?.direction === 'inbound'

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Message Detail" brandingDomainKey={activeDomain} />

      <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-xs font-semibold ${isInbound
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-blue-100 text-blue-800'
                  }`}>
                  {isInbound ? '↓ Inbound Message' : '↑ Outbound Message'}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(message?.status)}`}>
                  {message?.status || (isInbound ? 'received' : 'queued')}
                </span>
                {message?.provider && (
                  <span className="text-xs text-gray-500 font-mono">
                    via {message.provider}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                {message?.subject || (isInbound ? `Inbound email from ${message?.fromEmail || 'unknown'}` : `Outbound message #${messageId}`)}
              </h1>
              {message && (
                <p className="mt-2 text-xs text-gray-500">
                  {isInbound ? 'Received' : 'Created'} {formatDateTime(message.createdAt)} ({formatRelativeTime(message.timestamp)})
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(directionParam ? `/admin/messages?direction=${directionParam}` : '/admin/messages')}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                ← Back to Messages
              </button>
              <button
                type="button"
                disabled={!adjacentMessageIds.previous}
                onClick={() => {
                  if (!adjacentMessageIds.previous) return
                  const prev = adjacentMessageIds.previous
                  router.push(`/admin/messages/${encodeURIComponent(prev.id)}?direction=${encodeURIComponent(prev.direction || '')}`)
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!adjacentMessageIds.next}
                onClick={() => {
                  if (!adjacentMessageIds.next) return
                  const next = adjacentMessageIds.next
                  router.push(`/admin/messages/${encodeURIComponent(next.id)}?direction=${encodeURIComponent(next.direction || '')}`)
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
              {message && (
                <div className="relative" ref={detailsMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowMessageDetails((current) => !current)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-lg leading-none text-gray-600 hover:bg-gray-50"
                    aria-label="Message details"
                    aria-haspopup="true"
                    aria-expanded={showMessageDetails}
                    title="Message details"
                  >
                    ⋮
                  </button>
                  {showMessageDetails && (
                    <div className="absolute right-0 z-20 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-xl">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Message details</p>
                      <dl className="mt-2 space-y-2 text-xs">
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">From</dt>
                          <dd className="min-w-0 flex-1 break-all font-medium text-gray-900">{message.fromEmail || (isInbound ? 'Unknown' : 'System')}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">To</dt>
                          <dd className="min-w-0 flex-1 break-all font-medium text-gray-900">{message.toEmail || 'Unknown'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">Category</dt>
                          <dd className="min-w-0 flex-1 text-gray-900">{message.category || (isInbound ? 'inbound_email' : 'generic')}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">Domain</dt>
                          <dd className="min-w-0 flex-1 text-gray-900">{message.domain || 'n/a'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">Provider ID</dt>
                          <dd className="min-w-0 flex-1 break-all font-mono text-gray-900">{message.providerMessageId || 'n/a'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">Attempts</dt>
                          <dd className="min-w-0 flex-1 text-gray-900">{message.attempts}{message.maxAttempts != null ? ` / ${message.maxAttempts}` : ''}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">Created</dt>
                          <dd className="min-w-0 flex-1 text-gray-900">{formatDateTime(message.createdAt)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 font-medium text-gray-500">{isInbound ? 'Processed' : 'Sent'}</dt>
                          <dd className="min-w-0 flex-1 text-gray-900">{formatDateTime(isInbound ? message.processedAt : message.sentAt)}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {errorMessage && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {!errorMessage && !message && (
            <div className="mt-4 rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
              Message not found.
            </div>
          )}
        </section>

        {message && message.errorMessage && (
          <section className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-red-900">Processing / Delivery Error</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-red-800 font-mono">{message.errorMessage}</p>
          </section>
        )}

        {message && (
          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between border-b border-gray-200 pb-3 gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('friendly')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${activeTab === 'friendly'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  Message
                </button>
                {message.htmlBody && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('html')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${activeTab === 'html'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    HTML Preview
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('text')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${activeTab === 'text'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  Plain Text
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('payload')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${activeTab === 'payload'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  Raw Payload JSON
                </button>
              </div>

              {activeTab === 'payload' && (
                <button
                  type="button"
                  onClick={copyPayloadJson}
                  className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {copiedPayload ? '✓ Copied' : 'Copy JSON'}
                </button>
              )}
            </div>

            <div className="mt-4">
              {activeTab === 'friendly' && (
                <MessageFriendlyView
                  message={message}
                  onOpenHtml={() => setActiveTab('html')}
                  onOpenRaw={() => setActiveTab('payload')}
                />
              )}

              {activeTab === 'html' && message.htmlBody && (
                <div className="rounded-md border border-gray-200 p-4 bg-white">
                  <iframe
                    title="Email HTML Preview"
                    sandbox="allow-same-origin"
                    srcDoc={message.htmlBody}
                    className="w-full min-h-[400px] border-0"
                  />
                </div>
              )}

              {activeTab === 'text' && (
                <pre className="whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 font-mono">
                  {message.textBody || message.preview || '(No text body content)'}
                </pre>
              )}

              {activeTab === 'payload' && (
                <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800 font-mono">
                  {JSON.stringify(message.payload || {}, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
