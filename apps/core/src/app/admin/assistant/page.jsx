'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import AssistantModelMenu from '@/admin-ui/components/AssistantModelMenu'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getEffectiveDomainMode } from '@/lib/domainMode'
import { getDomainDisplayLabel } from '@/lib/assistantConfig'
import AssistantChat from './AssistantChat'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const PROVIDER_HINTS = {
    'google-vertex': {
        title: 'Vertex AI is not configured yet',
        body: 'Add a Google Cloud project ID and service-account credentials, then save Domain Settings.',
    },
    google: {
        title: 'Gemini API key is not configured',
        body: 'Set GOOGLE_GENERATIVE_AI_API_KEY so the assistant can authenticate with Google.',
    },
    openai: {
        title: 'OpenAI key is not configured',
        body: 'Add an OpenAI API key in the AI & Defaults section of Domain Settings.',
    },
}

export default function AssistantAdminPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [enabled, setEnabled] = useState(false)
    const [configured, setConfigured] = useState(false)
    const [config, setConfig] = useState(null)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const loadAssistantConfig = useCallback(async (token, domain) => {
        try {
            const response = await fetch('/api/admin/assistant', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                return { error: data?.error || `Assistant status check failed (${response.status})` }
            }

            return {
                enabled: data.enabled === true,
                configured: data.configured === true,
                provider: data.provider,
                model: data.model,
                modelTier: data.modelTier || '',
                reason: data.reason || '',
                displayName: data.displayName,
                welcome: data.welcome || '',
                focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas : [],
                suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
                domainKey: data.domainKey,
            }
        } catch (error) {
            return { error: error?.message || 'Unable to reach the assistant endpoint.' }
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

                const result = await loadAssistantConfig(token, effectiveDomain)
                if (cancelled) return

                if (result?.error) {
                    setStatusMessage(result.error)
                    setStatusTone('error')
                    setEnabled(false)
                } else {
                    setEnabled(result.enabled === true)
                    setConfigured(result.configured === true)
                    setConfig(result)
                }

                setIsAuthenticated(true)
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize assistant')
                setStatusTone('error')
                setEnabled(false)
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
    }, [router, loadAssistantConfig])

    const content = useMemo(() => {
        if (loading || !isAuthenticated) {
            return (
                <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
                    Loading…
                </div>
            )
        }

        if (!enabled) {
            const reason = config?.reason
            const domainLabel = getDomainDisplayLabel(config?.domainKey, config?.displayName)
            return (
                <div className="mx-auto max-w-xl py-16 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                        <AssistantAvatar domainKey={config?.domainKey || ''} iconClassName="h-6 w-6" imageClassName="h-8 w-8" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900">Assistant disabled for {domainLabel}</h2>
                    <p className="mt-2 text-sm text-gray-500">
                        {reason || `Enable the AI Assistant flag in Domain Settings to use this page for ${domainLabel}.`}
                    </p>
                    <Link
                        href="/admin/settings/domains"
                        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                    >
                        Open Domain Settings
                    </Link>
                </div>
            )
        }

        if (!configured) {
            const hint = PROVIDER_HINTS[config?.provider] || { title: 'Assistant provider not configured', body: '' }
            return (
                <div className="mx-auto max-w-xl py-16 text-center">
                    <h2 className="text-lg font-semibold text-gray-900">{hint.title}</h2>
                    <p className="mt-2 text-sm text-gray-500">
                        {config?.reason || hint.body}
                    </p>
                    <Link
                        href="/admin/settings/domains"
                        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                    >
                        Configure in Domain Settings
                    </Link>
                </div>
            )
        }

        return (
            <div className="flex h-[calc(100vh-160px)] min-h-[420px] flex-col">
                <AssistantChat
                    domainKey={config?.domainKey || ''}
                    welcome={config?.welcome || ''}
                    suggestions={Array.isArray(config?.suggestions) ? config.suggestions : []}
                />
            </div>
        )
    }, [loading, isAuthenticated, enabled, configured, config])

    return (
        <>
            <AdminHeader title="Assistant" brandingDomainKey={config?.domainKey} />
            <main className="mx-auto max-w-7xl px-4 py-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">AI Assistant</h1>
                        <p className="text-sm text-gray-500">
                            {enabled
                                ? `A general assistant for ${getDomainDisplayLabel(config?.domainKey, config?.displayName)}.`
                                : `General AI assistant for ${getDomainDisplayLabel(config?.domainKey, config?.displayName)}.`}
                        </p>
                    </div>
                    {enabled && config?.model && (
                        <AssistantModelMenu
                            provider={config.provider}
                            model={config.model}
                            modelTier={config.modelTier}
                            domainKey={config.domainKey}
                            displayName={config.displayName}
                        />
                    )}
                </div>

                {statusMessage && (
                    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                        }`}>
                        {statusMessage}
                    </div>
                )}

                {content}
            </main>
        </>
    )
}
