'use client'

import { useState } from 'react'
import { FOCUS_RING } from '@/components/AlliedHealthShell'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'

/**
 * Marks in unreachable.json that no longer belong to any provider in the directory.
 *
 * A mark is keyed by hostname but a provider is looked up by id, so the two can drift apart —
 * un-publishing a provider, or clearing its website, strands its mark. Those entries cannot be
 * rendered as cards (there is no provider to show a screenshot for), but they would otherwise be
 * invisible and impossible to clear, so the unreachable view lists them here.
 */
export default function ProviderUnreachableOrphans({ entries }) {
    const [cleared, setCleared] = useState([])
    const [busy, setBusy] = useState('')
    const [error, setError] = useState('')

    const visible = entries.filter((entry) => !cleared.includes(entry.host))
    if (visible.length === 0) return null

    const clear = async (entry) => {
        setBusy(entry.host)
        setError('')
        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            const response = await fetch('/api/allied-health/provider-unreachable', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                // The unmark endpoint keys on hostname, so a stored URL is a convenience rather than
                // a requirement — an entry without one can still be cleared.
                body: JSON.stringify({ action: 'unmark', url: entry.websiteUrl || `https://${entry.host}/` }),
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) throw new Error(data?.error || 'The request failed')
            setCleared((current) => [...current, entry.host])
        } catch (caught) {
            setError(caught.message)
        } finally {
            setBusy('')
        }
    }

    return (
        <section
            aria-label="Unreachable marks with no matching provider"
            className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
        >
            <p className="text-xs font-semibold text-amber-900">
                {visible.length} mark{visible.length === 1 ? '' : 's'} no longer match a provider in the directory
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
                The provider was unpublished or its website was cleared, so these cannot be reviewed as cards.
                Clearing the mark is safe — it only removes the entry from{' '}
                <span className="font-mono text-[11px]">unreachable.json</span>.
            </p>

            <ul className="mt-3 space-y-2">
                {visible.map((entry) => (
                    <li key={entry.host} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-4 py-2">
                        <span className="min-w-0 break-all font-mono text-[11px] text-slate-600">{entry.host}</span>
                        <button
                            type="button"
                            onClick={() => clear(entry)}
                            disabled={busy === entry.host}
                            className={`shrink-0 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            {busy === entry.host ? 'Clearing…' : 'Clear mark'}
                        </button>
                    </li>
                ))}
            </ul>

            {error ? <p className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
        </section>
    )
}
