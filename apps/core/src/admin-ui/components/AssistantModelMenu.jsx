'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MoreVertical } from 'lucide-react'
import { assistantProviderLabel, getDomainDisplayLabel } from '@/lib/assistantConfig'

const MODEL_TIER_LABELS = {
    flagship: 'Flagship',
    balanced: 'Balanced',
    value: 'Value',
}

/**
 * Kebab menu for the assistant header. The configured provider/model is
 * reference information, not part of the daily chat surface, so it lives here
 * alongside a link to the Domain Settings where it is changed.
 */
export default function AssistantModelMenu({
    provider = '',
    model = '',
    modelTier = '',
    domainKey = '',
    displayName = '',
} = {}) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)

    useEffect(() => {
        if (!open) return undefined

        function handlePointerDown(event) {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false)
            }
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open])

    if (!provider && !model) return null

    const providerLabel = provider ? assistantProviderLabel(provider) : 'Assistant'
    const tierLabel = MODEL_TIER_LABELS[String(modelTier || '').trim().toLowerCase()] || ''
    const domainLabel = getDomainDisplayLabel(domainKey, displayName)

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Assistant model settings"
                aria-haspopup="true"
                aria-expanded={open}
                title="Assistant model"
            >
                <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 text-left shadow-lg"
                >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Assistant model</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">
                        {providerLabel}
                        {tierLabel ? ` · ${tierLabel}` : ''}
                    </p>
                    {model && <p className="mt-0.5 break-all font-mono text-xs text-gray-600">{model}</p>}
                    <p className="mt-2 text-[11px] text-gray-400">{domainLabel}</p>
                    <Link
                        href="/admin/settings/domains"
                        onClick={() => setOpen(false)}
                        className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Change in Domain Settings
                    </Link>
                </div>
            )}
        </div>
    )
}
