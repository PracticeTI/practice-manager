'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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

function formatCompactSessionId(sessionId) {
    const value = String(sessionId || '').trim()
    if (!value) return 'n/a'
    if (value.length <= 28) return value
    return `${value.slice(0, 12)}...${value.slice(-12)}`
}

async function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
    }

    if (typeof document === 'undefined') {
        return false
    }

    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    textArea.style.pointerEvents = 'none'
    document.body.appendChild(textArea)
    textArea.select()
    textArea.setSelectionRange(0, textArea.value.length)

    let copied = false
    try {
        copied = document.execCommand('copy')
    } catch {
        copied = false
    } finally {
        document.body.removeChild(textArea)
    }

    return copied
}

export default function ChatDetailPage() {
    const router = useRouter()
    const params = useParams()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [chat, setChat] = useState(null)
    const [adjacentChatIds, setAdjacentChatIds] = useState({ previous: null, next: null })
    const [errorMessage, setErrorMessage] = useState('')
    const [sessionIdCopied, setSessionIdCopied] = useState(false)

    const chatId = useMemo(() => String(params?.id || '').trim(), [params])

    const handleCopySessionId = useCallback(async () => {
        const value = String(chat?.sessionId || '').trim()
        if (!value) return

        try {
            const copied = await copyText(value)
            if (!copied) {
                throw new Error('Copy failed')
            }
            setSessionIdCopied(true)
            setTimeout(() => setSessionIdCopied(false), 1500)
        } catch {
            setSessionIdCopied(false)
        }
    }, [chat?.sessionId])

    const loadChat = useCallback(async (domain) => {
        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setErrorMessage('Missing admin session')
            return
        }

        const query = new URLSearchParams()
        if (domain) query.set('domain', domain)

        const response = await fetchWithTimeout(
            `/api/database/chats/${encodeURIComponent(chatId)}${query.toString() ? `?${query.toString()}` : ''}`,
            {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            }
        )

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load chat')
        }

        setChat(data?.chat || null)
    }, [chatId])

    const loadAdjacentChatIds = useCallback(async (domain) => {
        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setAdjacentChatIds({ previous: null, next: null })
            return
        }

        const query = new URLSearchParams({ domain: String(domain || '').trim(), limit: '500' })
        const response = await fetchWithTimeout(`/api/database/chats?${query.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load adjacent chats')
        }

        const list = Array.isArray(data?.data) ? data.data : []
        const currentId = Number.parseInt(chatId, 10)
        if (!Number.isFinite(currentId) || currentId <= 0) {
            setAdjacentChatIds({ previous: null, next: null })
            return
        }

        const index = list.findIndex((item) => Number(item?.id) === currentId)
        if (index === -1) {
            setAdjacentChatIds({ previous: null, next: null })
            return
        }

        setAdjacentChatIds({
            previous: list[index - 1]?.id ? String(list[index - 1].id) : null,
            next: list[index + 1]?.id ? String(list[index + 1].id) : null,
        })
    }, [chatId])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                if (!chatId) {
                    setErrorMessage('Invalid chat id')
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
                    loadChat(effectiveDomain),
                    loadAdjacentChatIds(effectiveDomain),
                ])
            } catch (error) {
                if (cancelled) return
                setErrorMessage(error?.message || 'Failed to initialize chat detail view')
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
    }, [router, chatId, loadChat, loadAdjacentChatIds])

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading chat...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Chat Detail" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Chat #{chatId}</p>
                            <h1 className="mt-1 text-2xl font-bold text-gray-900">{chat?.title || `Chat #${chatId}`}</h1>
                            <p className="mt-2 max-w-3xl text-sm text-gray-600">{chat?.summary || 'Full transcript and metadata'}</p>
                            {chat && (
                                <p className="mt-2 text-xs text-gray-500">Updated {formatRelativeTime(chat.timestamp)}</p>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => router.push('/admin/chat')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Back to Chat List
                            </button>
                            <button
                                type="button"
                                disabled={!adjacentChatIds.previous}
                                onClick={() => {
                                    if (!adjacentChatIds.previous) return
                                    router.push(`/admin/chat/${encodeURIComponent(adjacentChatIds.previous)}`)
                                }}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                disabled={!adjacentChatIds.next}
                                onClick={() => {
                                    if (!adjacentChatIds.next) return
                                    router.push(`/admin/chat/${encodeURIComponent(adjacentChatIds.next)}`)
                                }}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>

                    {errorMessage && (
                        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    {!errorMessage && !chat && (
                        <div className="mt-4 rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                            Chat not found.
                        </div>
                    )}

                    {chat && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-700">
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="font-medium text-gray-500">From</p>
                                <p className="mt-0.5 text-sm text-gray-900">{chat.from || 'Unknown'}</p>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="font-medium text-gray-500">Role</p>
                                <p className="mt-0.5 text-sm text-gray-900">{chat.role || 'Contact'}</p>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="font-medium text-gray-500">Status</p>
                                <p className="mt-0.5 text-sm text-gray-900">{chat.status || 'unknown'}</p>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="font-medium text-gray-500">Updated</p>
                                <p className="mt-0.5 text-sm text-gray-900">{formatRelativeTime(chat.timestamp)}</p>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 md:col-span-2">
                                <p className="font-medium text-gray-500">Session ID</p>
                                <div className="mt-0.5 flex items-center gap-2">
                                    <p
                                        className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900"
                                        title={chat.sessionId || 'n/a'}
                                    >
                                        {formatCompactSessionId(chat.sessionId)}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleCopySessionId}
                                        disabled={!chat.sessionId}
                                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Copy session id"
                                    >
                                        {sessionIdCopied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="font-medium text-gray-500">Message Count</p>
                                <p className="mt-0.5 text-sm text-gray-900">{chat.messageCount || 0}</p>
                            </div>
                        </div>
                    )}
                </section>

                {chat && (
                    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-gray-900">Transcript</h2>

                        <div className="mt-4 space-y-3">
                            {Array.isArray(chat.messages) && chat.messages.length > 0 ? chat.messages.map((message, index) => {
                                const role = String(message?.role || 'unknown').toLowerCase()
                                const isUser = role === 'user'
                                const isAssistant = role === 'assistant'
                                const bubbleClass = isUser
                                    ? 'border-blue-200 bg-blue-50'
                                    : isAssistant
                                        ? 'border-gray-200 bg-gray-50'
                                        : 'border-gray-200 bg-white'

                                return (
                                    <div key={`${role}-${index}`} className={`rounded-md border px-3 py-2 ${bubbleClass}`}>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{role || 'message'}</p>
                                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{String(message?.content || '').trim() || '(no content)'}</p>
                                    </div>
                                )
                            }) : (
                                <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                                    No transcript messages stored for this chat.
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {chat && (
                    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-gray-900">Metadata</h2>
                        <pre className="mt-4 max-h-[420px] overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                            {JSON.stringify(chat.metadata || {}, null, 2)}
                        </pre>
                    </section>
                )}
            </main>
        </div>
    )
}
