'use client'

import { useState } from 'react'

/**
 * Free-text booking assistant. It only narrows the search: every time it offers
 * came from the same availability engine the calendar uses.
 */
export default function BookingAssistant({ domain, onPickSlot }) {
    const [message, setMessage] = useState('')
    const [history, setHistory] = useState([])
    const [loading, setLoading] = useState(false)
    const [reply, setReply] = useState('')
    const [slots, setSlots] = useState([])
    const [agentData, setAgentData] = useState(null)
    const [error, setError] = useState('')

    async function submit(event) {
        event.preventDefault()
        const text = message.trim()
        if (text.length < 2 || loading) return

        setLoading(true)
        setError('')
        try {
            const response = await fetch('/api/scheduling/agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, message: text, history }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || payload.success === false) {
                setError(payload.error || 'The assistant is unavailable right now.')
                return
            }

            const data = payload.data || {}
            setReply(data.reply || '')
            setSlots(Array.isArray(data.slots) ? data.slots : [])
            setAgentData(data)
            setHistory([
                ...history,
                { role: 'user', content: text },
                { role: 'assistant', content: data.reply || '' },
            ].slice(-6))
            setMessage('')
        } catch {
            setError('The assistant is unavailable right now.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">Ask the assistant</h2>
            <p className="mt-1 text-sm text-indigo-900/80">
                Describe what you need in your own words — for example “an OT assessment next week, mornings”.
            </p>
            <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="assistant-message">Message</label>
                <input
                    id="assistant-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={600}
                    placeholder="What are you looking for?"
                    className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none"
                />
                <button
                    type="submit"
                    disabled={loading || message.trim().length < 2}
                    className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {loading ? 'Looking…' : 'Find times'}
                </button>
            </form>

            {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

            {reply ? (
                <div className="mt-4 rounded-lg bg-white p-3 text-sm text-gray-800 shadow-sm" aria-live="polite">
                    {reply}
                </div>
            ) : null}

            {slots.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    {slots.map((slot) => (
                        <button
                            key={`${slot.starts_at}-${slot.practitioner_id}`}
                            type="button"
                            onClick={() => onPickSlot(slot, agentData || {})}
                            className="rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 hover:border-indigo-500"
                        >
                            {slot.time_label || new Date(slot.starts_at).toLocaleString()}
                            {slot.practitioner_name ? (
                                <span className="ml-1 text-xs font-normal text-indigo-600">· {slot.practitioner_name}</span>
                            ) : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    )
}
