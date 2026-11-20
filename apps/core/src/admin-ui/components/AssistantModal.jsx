'use client'

import { useCallback, useEffect, useRef } from 'react'
import { X, ExternalLink } from 'lucide-react'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import AssistantModelMenu from '@/admin-ui/components/AssistantModelMenu'
import AssistantChat from '@/app/admin/assistant/AssistantChat'
import { getDomainDisplayLabel } from '@/lib/assistantConfig'

/**
 * Floating "app within an app" window for the AI Assistant.
 *
 * Renders a centered modal by default (backdrop + Esc close it) with an
 * icon-only header: a "pop out" affordance (opens the full-screen
 * /admin/assistant app) and a close affordance.
 *
 * `initialPrompt` is sent as a user message when the chat mounts (or whenever
 * `initialPromptKey` changes), which lets other admin surfaces hand a prompt to
 * the assistant.
 */
export default function AssistantModal({
    open = false,
    domainKey = '',
    displayName = '',
    provider = '',
    model = '',
    modelTier = '',
    welcome = '',
    suggestions = [],
    initialPrompt = '',
    initialPromptKey = 0,
    onClose,
    onPopOut,
}) {
    const dialogRef = useRef(null)

    const handleKeyDown = useCallback(
        (event) => {
            if (event.key === 'Escape' && typeof onClose === 'function') {
                onClose()
            }
        },
        [onClose]
    )

    useEffect(() => {
        if (!open) return undefined

        document.addEventListener('keydown', handleKeyDown)
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        // Move focus into the dialog so keyboard users land in the app.
        const focusTimer = window.setTimeout(() => {
            dialogRef.current?.focus()
        }, 0)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            document.body.style.overflow = previousOverflow
            window.clearTimeout(focusTimer)
        }
    }, [open, handleKeyDown])

    if (!open) return null

    const label = getDomainDisplayLabel(domainKey, displayName)

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
                aria-hidden="true"
                onClick={onClose}
            />

            {/* App window */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={`AI Assistant for ${label}`}
                tabIndex={-1}
                className="relative flex h-[min(76vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl outline-none"
            >
                {/* App header */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                            <AssistantAvatar domainKey={domainKey} iconClassName="h-4 w-4" imageClassName="h-5 w-5" />
                        </span>
                        <div className="min-w-0 leading-tight">
                            <p className="truncate text-sm font-semibold text-gray-900">Assistant</p>
                            <p className="truncate text-[11px] text-gray-400">{label}</p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <AssistantModelMenu
                            provider={provider}
                            model={model}
                            modelTier={modelTier}
                            domainKey={domainKey}
                            displayName={displayName}
                        />
                        <button
                            type="button"
                            onClick={onPopOut}
                            title="Pop out"
                            aria-label="Pop out to full-screen assistant"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title="Close"
                            aria-label="Close assistant"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Chat body */}
                <div className="min-h-0 flex-1">
                    <AssistantChat
                        bare
                        domainKey={domainKey}
                        welcome={welcome}
                        suggestions={suggestions}
                        initialPrompt={initialPrompt}
                        initialPromptKey={initialPromptKey}
                    />
                </div>
            </div>
        </div>
    )
}
