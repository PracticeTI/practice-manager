'use client'

import { useEffect, useMemo, useState } from 'react'
import BookingAssistant from './BookingAssistant'

function formatDayLabel(iso, timezone) {
    return new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    }).format(new Date(iso))
}

function formatTimeLabel(iso, timezone) {
    return new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(iso))
}

function formatRange(startIso, endIso, timezone) {
    return `${formatTimeLabel(startIso, timezone)} – ${formatTimeLabel(endIso, timezone)}`
}

function StepBadge({ index, label, active, done }) {
    return (
        <li className={`flex items-center gap-2 text-sm ${active ? 'text-gray-900' : done ? 'text-emerald-700' : 'text-gray-400'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                active ? 'border-gray-900 bg-gray-900 text-white' : done ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300'
            }`}>
                {done ? '✓' : index}
            </span>
            {label}
        </li>
    )
}

export default function BookingClient({ domain }) {
    const [catalog, setCatalog] = useState(null)
    const [loadError, setLoadError] = useState('')
    const [step, setStep] = useState('service')
    const [serviceId, setServiceId] = useState(null)
    const [practitionerId, setPractitionerId] = useState(null)
    const [slots, setSlots] = useState([])
    const [slotMeta, setSlotMeta] = useState({ timezone: 'Australia/Sydney', loading: false, error: '' })
    const [selectedSlot, setSelectedSlot] = useState(null)
    const [refreshKey, setRefreshKey] = useState(0)
    const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', consent: false })
    const [submitting, setSubmitting] = useState(false)
    const [formError, setFormError] = useState('')
    const [result, setResult] = useState(null)

    useEffect(() => {
        if (!domain) return
        let cancelled = false

        const load = async () => {
            try {
                const response = await fetch(`/api/scheduling/booking?domain=${encodeURIComponent(domain)}`)
                const payload = await response.json().catch(() => ({}))
                if (cancelled) return
                if (!response.ok || payload.success === false) {
                    setLoadError(payload.error || 'Could not load booking options.')
                    return
                }
                setCatalog(payload.data)
            } catch {
                if (!cancelled) setLoadError('Could not load booking options.')
            }
        }

        load()
        return () => { cancelled = true }
    }, [domain])

    useEffect(() => {
        if (step !== 'time' || !serviceId) return
        let cancelled = false

        const load = async () => {
            setSlotMeta((current) => ({ ...current, loading: true, error: '' }))
            try {
                const params = new URLSearchParams({ domain, service_id: String(serviceId) })
                if (practitionerId) params.set('practitioner_id', String(practitionerId))
                const response = await fetch(`/api/scheduling/booking/availability?${params.toString()}`)
                const payload = await response.json().catch(() => ({}))
                if (cancelled) return
                if (!response.ok || payload.success === false) {
                    setSlots([])
                    setSlotMeta((current) => ({ ...current, loading: false, error: payload.error || 'Could not load times.' }))
                    return
                }
                setSlots(Array.isArray(payload.data?.slots) ? payload.data.slots : [])
                setSlotMeta({
                    timezone: payload.data?.timezone || 'Australia/Sydney',
                    loading: false,
                    error: '',
                })
            } catch {
                if (!cancelled) {
                    setSlots([])
                    setSlotMeta((current) => ({ ...current, loading: false, error: 'Could not load times.' }))
                }
            }
        }

        load()
        return () => { cancelled = true }
    }, [domain, serviceId, practitionerId, step, refreshKey])

    const service = useMemo(
        () => catalog?.services?.find((item) => item.id === serviceId) || null,
        [catalog, serviceId]
    )
    const eligiblePractitioners = useMemo(() => {
        if (!catalog?.practitioners || !serviceId) return []
        return catalog.practitioners.filter((item) => item.service_ids.includes(serviceId))
    }, [catalog, serviceId])

    const groupedSlots = useMemo(() => {
        const groups = []
        let current = null
        for (const slot of slots) {
            const label = formatDayLabel(slot.starts_at, slotMeta.timezone)
            if (!current || current.label !== label) {
                current = { label, slots: [] }
                groups.push(current)
            }
            current.slots.push(slot)
        }
        return groups
    }, [slots, slotMeta.timezone])

    function resolvePractitionerName(id) {
        return catalog?.practitioners?.find((item) => item.id === id)?.display_name || ''
    }

    function startService(nextServiceId) {
        setServiceId(nextServiceId)
        setPractitionerId(null)
        setSelectedSlot(null)
        setFormError('')
        setStep('time')
        setRefreshKey((value) => value + 1)
    }

    function handleAssistantSlot(slot, data) {
        const nextServiceId = Number(data?.service?.id) || serviceId
        if (nextServiceId) setServiceId(nextServiceId)
        setPractitionerId(slot.practitioner_id || null)
        setSelectedSlot(slot)
        setFormError('')
        setStep('details')
    }

    function chooseSlot(slot) {
        setSelectedSlot(slot)
        setFormError('')
        setStep('details')
    }

    async function submitBooking(event) {
        event.preventDefault()
        if (submitting || !selectedSlot || !serviceId) return

        setSubmitting(true)
        setFormError('')
        try {
            const response = await fetch('/api/scheduling/booking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain,
                    patient_name: form.name,
                    email: form.email,
                    phone: form.phone,
                    notes: form.notes,
                    consent: form.consent,
                    company_website: '',
                    service_id: serviceId,
                    practitioner_id: selectedSlot.practitioner_id || practitionerId,
                    starts_at: selectedSlot.starts_at,
                }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || payload.success === false) {
                if (response.status === 409) {
                    setSelectedSlot(null)
                    setStep('time')
                    setRefreshKey((value) => value + 1)
                    setSlotMeta((current) => ({
                        ...current,
                        error: payload.error || 'That time was just taken. Please choose another time.',
                    }))
                    return
                }
                setFormError(payload.error || 'We could not book that time. Please try again.')
                return
            }

            setResult(payload.data)
            setStep('done')
        } catch {
            setFormError('We could not book that time. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    const practiceName = catalog?.practice?.name || ''

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-10">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                <header>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Online booking</p>
                    <h1 className="mt-2 text-3xl font-semibold text-slate-900">
                        {practiceName ? `Book with ${practiceName}` : 'Book an appointment'}
                    </h1>
                    {catalog?.settings?.introText ? (
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{catalog.settings.introText}</p>
                    ) : null}
                </header>

                {step !== 'done' ? (
                    <ol className="flex flex-wrap gap-x-6 gap-y-2">
                        <StepBadge index={1} label="Choose a service" active={step === 'service'} done={step !== 'service'} />
                        <StepBadge index={2} label="Pick a time" active={step === 'time'} done={step === 'details'} />
                        <StepBadge index={3} label="Your details" active={step === 'details'} done={false} />
                    </ol>
                ) : null}

                {loadError ? (
                    <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{loadError}</section>
                ) : null}

                {!loadError && !catalog ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading booking options…</section>
                ) : null}

                {catalog && !catalog.enabled ? (
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                        <p className="font-semibold">Online booking is not open right now.</p>
                        <p className="mt-1">
                            {catalog.settings?.contactNote || 'Please call the practice and we will find a time that works.'}
                        </p>
                    </section>
                ) : null}

                {catalog?.enabled && step === 'done' && result ? (
                    <section className="rounded-2xl border border-emerald-200 bg-white p-6">
                        <h2 className="text-xl font-semibold text-emerald-800">You’re booked</h2>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                                <dt className="text-slate-500">Reference</dt>
                                <dd className="font-semibold text-slate-900">{result.reference}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">When</dt>
                                <dd className="font-semibold text-slate-900">{result.time_label}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Appointment</dt>
                                <dd className="font-semibold text-slate-900">{result.service?.name}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Practitioner</dt>
                                <dd className="font-semibold text-slate-900">{result.practitioner?.display_name || 'To be confirmed'}</dd>
                            </div>
                            {result.location?.name ? (
                                <div>
                                    <dt className="text-slate-500">Location</dt>
                                    <dd className="font-semibold text-slate-900">{result.location.name}</dd>
                                </div>
                            ) : null}
                        </dl>
                        <p className="mt-4 text-sm text-slate-600">
                            {result.confirmation_email
                                ? 'A confirmation email is on its way. We will also send a reminder before your visit.'
                                : 'We will be in touch to confirm the details.'}
                        </p>
                    </section>
                ) : null}

                {catalog?.enabled && step === 'service' ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-900">What do you need?</h2>
                        {catalog.services.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-600">No appointment types are published yet.</p>
                        ) : (
                            <ul className="mt-4 grid gap-3">
                                {catalog.services.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            onClick={() => startService(item.id)}
                                            className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-slate-400 hover:bg-slate-50"
                                        >
                                            <span>
                                                <span className="block font-medium text-slate-900">{item.name}</span>
                                                <span className="block text-sm text-slate-500">{item.duration_minutes} minutes</span>
                                            </span>
                                            <span className="text-sm font-semibold text-slate-900">Choose</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                ) : null}

                {catalog?.enabled && step === 'time' ? (
                    <section className="flex flex-col gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900">{service?.name || 'Choose a time'}</h2>
                                    <p className="text-sm text-slate-500">{service ? `${service.duration_minutes} minutes` : ''}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setStep('service')}
                                    className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                                >
                                    Change service
                                </button>
                            </div>

                            {eligiblePractitioners.length > 1 ? (
                                <label className="mt-4 block text-sm">
                                    <span className="text-slate-600">Practitioner</span>
                                    <select
                                        value={practitionerId || ''}
                                        onChange={(event) => {
                                            setPractitionerId(event.target.value ? Number(event.target.value) : null)
                                            setRefreshKey((value) => value + 1)
                                        }}
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        <option value="">Any available practitioner</option>
                                        {eligiblePractitioners.map((item) => (
                                            <option key={item.id} value={item.id}>{item.display_name}</option>
                                        ))}
                                    </select>
                                </label>
                            ) : null}

                            {slotMeta.error ? <p className="mt-4 text-sm text-amber-700">{slotMeta.error}</p> : null}

                            {slotMeta.loading ? (
                                <p className="mt-6 text-sm text-slate-500">Finding available times…</p>
                            ) : groupedSlots.length === 0 ? (
                                <p className="mt-6 text-sm text-slate-600">
                                    No times are free in the next few weeks. Try the assistant below or call the practice.
                                </p>
                            ) : (
                                <div className="mt-6 space-y-6">
                                    {groupedSlots.map((group) => (
                                        <div key={group.label}>
                                            <h3 className="text-sm font-semibold text-slate-700">{group.label}</h3>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {group.slots.map((slot) => (
                                                    <button
                                                        key={`${slot.starts_at}-${slot.practitioner_id}`}
                                                        type="button"
                                                        onClick={() => chooseSlot(slot)}
                                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                                                    >
                                                        {formatTimeLabel(slot.starts_at, slotMeta.timezone)}
                                                        {!practitionerId && slot.practitioner_name ? (
                                                            <span className="ml-1 text-xs font-normal opacity-75">· {slot.practitioner_name.split(' ')[0]}</span>
                                                        ) : null}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <BookingAssistant domain={domain} onPickSlot={handleAssistantSlot} />
                    </section>
                ) : null}

                {catalog?.enabled && step === 'details' && selectedSlot ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Your details</h2>
                                <p className="mt-1 text-sm text-slate-600">
                                    {formatDayLabel(selectedSlot.starts_at, slotMeta.timezone)} ·{' '}
                                    {formatRange(selectedSlot.starts_at, selectedSlot.ends_at, slotMeta.timezone)}
                                    {selectedSlot.practitioner_name
                                        ? ` with ${selectedSlot.practitioner_name}`
                                        : practitionerId
                                            ? ` with ${resolvePractitionerName(practitionerId)}`
                                            : ''}
                                </p>
                                <p className="text-sm text-slate-500">{service?.name}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setStep('time')}
                                className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                            >
                                Change time
                            </button>
                        </div>

                        <form onSubmit={submitBooking} className="mt-6 grid gap-4">
                            <label className="block text-sm">
                                <span className="font-medium text-slate-700">Full name</span>
                                <input
                                    required
                                    value={form.name}
                                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                                    maxLength={120}
                                    autoComplete="name"
                                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <span className="font-medium text-slate-700">Email</span>
                                    <input
                                        type="email"
                                        value={form.email}
                                        onChange={(event) => setForm({ ...form, email: event.target.value })}
                                        maxLength={180}
                                        autoComplete="email"
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="block text-sm">
                                    <span className="font-medium text-slate-700">Mobile</span>
                                    <input
                                        type="tel"
                                        value={form.phone}
                                        onChange={(event) => setForm({ ...form, phone: event.target.value })}
                                        maxLength={40}
                                        autoComplete="tel"
                                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </label>
                            </div>
                            <p className="text-xs text-slate-500">Give us at least one way to reach you.</p>

                            <label className="block text-sm">
                                <span className="font-medium text-slate-700">Anything we should know? (optional)</span>
                                <textarea
                                    value={form.notes}
                                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                                    rows={3}
                                    maxLength={1000}
                                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <input
                                type="text"
                                name="company_website"
                                value=""
                                onChange={() => { }}
                                tabIndex={-1}
                                autoComplete="off"
                                aria-hidden="true"
                                className="hidden"
                            />

                            {catalog.settings?.requireConsent ? (
                                <label className="flex items-start gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={form.consent}
                                        onChange={(event) => setForm({ ...form, consent: event.target.checked })}
                                        className="mt-1"
                                    />
                                    <span>I agree to be contacted about this appointment.</span>
                                </label>
                            ) : null}

                            {formError ? <p className="text-sm text-red-700">{formError}</p> : null}

                            <button
                                type="submit"
                                disabled={submitting}
                                className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                            >
                                {submitting ? 'Booking…' : 'Confirm booking'}
                            </button>
                        </form>
                    </section>
                ) : null}

                {catalog?.settings?.contactNote && step === 'service' ? (
                    <p className="text-center text-sm text-slate-500">{catalog.settings.contactNote}</p>
                ) : null}
            </div>
        </main>
    )
}
