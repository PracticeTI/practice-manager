'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import AssistantModal from '@/admin-ui/components/AssistantModal'
import { ASSISTANT_FULL_APP_PATH, ASSISTANT_PROMPT_EVENT, loadAssistantStatus } from '@/lib/assistantClient'

/**
 * Discreet, icon-only launcher for the AI Assistant shown on every admin page
 * (via AdminHeader) when the current domain has the assistant enabled and
 * configured.
 *
 * Clicking the floating icon opens the assistant in a modal by default; the
 * modal header exposes a pop-out control that opens the dedicated full-screen
 * /admin/assistant app.
 *
 * Other admin surfaces can also drive it: dispatching `ASSISTANT_PROMPT_EVENT`
 * (see `requestAssistantPrompt`) opens the modal with that prompt already sent,
 * e.g. the header practice search box's "Assistant" result.
 */
export default function AssistantLauncher() {
    const [status, setStatus] = useState('checking') // 'checking' | 'ready' | 'hidden'
    const [config, setConfig] = useState(null)
    const [open, setOpen] = useState(false)
    // { text, key } – `key` re-triggers the send even for a repeated prompt.
    const [pendingPrompt, setPendingPrompt] = useState(null)
    const promptKeyRef = useRef(0)

    useEffect(() => {
        let cancelled = false

        async function checkStatus() {
            // The dedicated full-screen app manages itself – no launcher there.
            const result = await loadAssistantStatus()
            if (cancelled) return

            if (result.available) {
                setConfig(result.config)
                setStatus('ready')
            } else {
                setStatus('hidden')
            }
        }

        checkStatus()
        return () => {
            cancelled = true
        }
    }, [])

    // Let other admin surfaces open the assistant with a prompt to send.
    useEffect(() => {
        if (status !== 'ready') return undefined

        const handlePromptRequest = (event) => {
            const prompt = String(event?.detail?.prompt || '').trim()
            if (!prompt) return

            promptKeyRef.current += 1
            setPendingPrompt({ text: prompt, key: promptKeyRef.current })
            setOpen(true)
        }

        window.addEventListener(ASSISTANT_PROMPT_EVENT, handlePromptRequest)
        return () => window.removeEventListener(ASSISTANT_PROMPT_EVENT, handlePromptRequest)
    }, [status])

    const closeModal = useCallback(() => {
        setOpen(false)
        setPendingPrompt(null)
    }, [])

    const popOut = () => {
        // Open the dedicated full-screen assistant app in a new tab.
        if (typeof window !== 'undefined') {
            window.open(ASSISTANT_FULL_APP_PATH, '_blank', 'noopener,noreferrer')
        }
        closeModal()
    }

    if (status !== 'ready' || !config) return null

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Assistant"
                aria-label="Open AI Assistant"
                className="fixed bottom-5 right-5 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg ring-1 ring-gray-200 transition-all hover:scale-105 hover:bg-gray-50 hover:ring-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
                <AssistantAvatar domainKey={config.domainKey} iconClassName="h-4 w-4" imageClassName="h-7 w-7" />
            </button>

            <AssistantModal
                open={open}
                domainKey={config.domainKey}
                displayName={config.displayName}
                provider={config.provider}
                model={config.model}
                modelTier={config.modelTier || ''}
                welcome={config.welcome || ''}
                suggestions={Array.isArray(config.suggestions) ? config.suggestions : []}
                initialPrompt={pendingPrompt?.text || ''}
                initialPromptKey={pendingPrompt?.key || 0}
                onClose={closeModal}
                onPopOut={popOut}
            />
        </>
    )
}
