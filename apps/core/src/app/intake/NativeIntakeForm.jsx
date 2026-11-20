'use client'

import { useEffect, useMemo, useState } from 'react'

function FieldLabel({ question }) {
    return (
        <span className="block font-medium text-gray-800">
            {question.label}
            {question.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
        </span>
    )
}

function QuestionField({ question, value, onChange, onToggle }) {
    const baseClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none'

    if (question.type === 'textarea') {
        return (
            <label className="block text-sm">
                <FieldLabel question={question} />
                <textarea
                    rows={3}
                    value={value || ''}
                    placeholder={question.placeholder || ''}
                    onChange={(event) => onChange(question.id, event.target.value)}
                    className={baseClass}
                />
                {question.help ? <span className="mt-1 block text-xs text-gray-500">{question.help}</span> : null}
            </label>
        )
    }

    if (question.type === 'select') {
        return (
            <label className="block text-sm">
                <FieldLabel question={question} />
                <select
                    value={value || ''}
                    onChange={(event) => onChange(question.id, event.target.value)}
                    className={baseClass}
                >
                    <option value="">Choose…</option>
                    {question.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
                {question.help ? <span className="mt-1 block text-xs text-gray-500">{question.help}</span> : null}
            </label>
        )
    }

    if (question.type === 'radio' || question.type === 'yesno') {
        const options = question.type === 'yesno' ? ['Yes', 'No'] : question.options
        return (
            <fieldset className="text-sm">
                <legend className="block font-medium text-gray-800">
                    {question.label}
                    {question.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
                </legend>
                <div className="mt-2 flex flex-wrap gap-4">
                    {options.map((option) => (
                        <label key={option} className="flex items-center gap-2 text-gray-700">
                            <input
                                type="radio"
                                name={question.id}
                                value={option}
                                checked={value === option}
                                onChange={() => onChange(question.id, option)}
                            />
                            {option}
                        </label>
                    ))}
                </div>
                {question.help ? <span className="mt-1 block text-xs text-gray-500">{question.help}</span> : null}
            </fieldset>
        )
    }

    if (question.type === 'checkboxes') {
        const selected = Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
        return (
            <fieldset className="text-sm">
                <legend className="block font-medium text-gray-800">
                    {question.label}
                    {question.required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
                </legend>
                <div className="mt-2 grid gap-2">
                    {question.options.map((option) => (
                        <label key={option} className="flex items-center gap-2 text-gray-700">
                            <input
                                type="checkbox"
                                value={option}
                                checked={selected.includes(option)}
                                onChange={() => onToggle(question.id, option)}
                            />
                            {option}
                        </label>
                    ))}
                </div>
                {question.help ? <span className="mt-1 block text-xs text-gray-500">{question.help}</span> : null}
            </fieldset>
        )
    }

    const inputType = question.type === 'email'
        ? 'email'
        : question.type === 'phone'
            ? 'tel'
            : question.type === 'date'
                ? 'date'
                : question.type === 'number'
                    ? 'number'
                    : 'text'

    return (
        <label className="block text-sm">
            <FieldLabel question={question} />
            <input
                type={inputType}
                value={value || ''}
                placeholder={question.placeholder || ''}
                onChange={(event) => onChange(question.id, event.target.value)}
                className={baseClass}
            />
            {question.help ? <span className="mt-1 block text-xs text-gray-500">{question.help}</span> : null}
        </label>
    )
}

/**
 * The native intake form. It renders whatever definition the domain publishes and
 * posts the answers to /api/intake/submit, which validates them again server-side.
 */
export default function NativeIntakeForm({ domain, form: requestedForm }) {
    const [payload, setPayload] = useState(null)
    const [loadError, setLoadError] = useState('')
    const [answers, setAnswers] = useState({})
    const [errors, setErrors] = useState({})
    const [formError, setFormError] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState(null)

    useEffect(() => {
        let cancelled = false
        const query = new URLSearchParams({ domain })
        if (requestedForm) query.set('form', requestedForm)

        const load = async () => {
            try {
                const response = await fetch(`/api/intake/form?${query.toString()}`, { cache: 'no-store' })
                const body = await response.json().catch(() => ({}))
                if (cancelled) return
                if (!response.ok || body.success === false) {
                    setLoadError(body.error || 'Could not load the intake form.')
                    return
                }
                setPayload(body.data)
            } catch {
                if (!cancelled) setLoadError('Could not load the intake form.')
            }
        }

        load()
        return () => { cancelled = true }
    }, [domain, requestedForm])

    const definition = payload?.definition || null
    const settings = payload?.settings || {}

    const questionCount = useMemo(
        () => (definition?.sections || []).reduce((total, section) => total + section.questions.length, 0),
        [definition]
    )

    function setAnswer(questionId, value) {
        setAnswers((current) => ({ ...current, [questionId]: value }))
        setErrors((current) => {
            if (!current[questionId]) return current
            const next = { ...current }
            delete next[questionId]
            return next
        })
    }

    function toggleAnswer(questionId, option) {
        setAnswers((current) => {
            const existing = Array.isArray(current[questionId]) ? current[questionId] : []
            const next = existing.includes(option)
                ? existing.filter((item) => item !== option)
                : [...existing, option]
            return { ...current, [questionId]: next }
        })
        setErrors((current) => {
            if (!current[questionId]) return current
            const next = { ...current }
            delete next[questionId]
            return next
        })
    }

    function validateLocally() {
        const nextErrors = {}
        ;(definition?.sections || []).forEach((section) => {
            section.questions.forEach((question) => {
                if (!question.required) return
                const value = answers[question.id]
                const empty = Array.isArray(value)
                    ? value.length === 0
                    : String(value || '').trim() === ''
                if (empty) nextErrors[question.id] = `${question.label} is required`
            })
        })
        setErrors(nextErrors)
        return Object.keys(nextErrors).length === 0
    }

    async function submit(event) {
        event.preventDefault()
        if (submitting || !definition) return
        if (!validateLocally()) {
            setFormError('Please complete the highlighted questions.')
            return
        }

        setSubmitting(true)
        setFormError('')
        try {
            const response = await fetch('/api/intake/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain,
                    answers,
                    consent: true,
                    company_website: '',
                }),
            })
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.success === false) {
                setFormError(body.error || 'We could not save your answers. Please try again.')
                return
            }
            setResult(body.data)
        } catch {
            setFormError('We could not save your answers. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    if (loadError) {
        return (
            <main className="min-h-screen bg-slate-50 px-4 py-16">
                <div className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
                    {loadError}
                </div>
            </main>
        )
    }

    if (!payload) {
        return (
            <main className="min-h-screen bg-slate-50 px-4 py-16">
                <div className="mx-auto max-w-2xl text-sm text-slate-600">Loading the intake form…</div>
            </main>
        )
    }

    const practiceName = payload.practice?.name || ''

    if (result) {
        return (
            <main className="min-h-screen bg-slate-50 px-4 py-16">
                <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-white p-8 shadow-sm">
                    <h1 className="text-2xl font-semibold text-emerald-800">Intake received</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{result.thank_you || settings.thankYouText}</p>
                    <p className="mt-4 text-sm text-slate-500">
                        Reference <span className="font-semibold text-slate-900">{result.reference}</span>
                    </p>
                </div>
            </main>
        )
    }

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-12">
            <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-6" noValidate>
                <header>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {practiceName ? `${practiceName} intake` : 'New client intake'}
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold text-slate-900">{definition?.title || 'Intake form'}</h1>
                    {settings.introText || definition?.introText ? (
                        <p className="mt-2 text-sm leading-6 text-slate-600">{settings.introText || definition.introText}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">{questionCount} questions · about 5 minutes</p>
                </header>

                {(definition?.sections || []).map((section) => (
                    <section key={section.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
                        {section.description ? (
                            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
                        ) : null}
                        <div className="mt-4 grid gap-5">
                            {section.questions.map((question) => (
                                <div key={question.id}>
                                    <QuestionField
                                        question={question}
                                        value={answers[question.id]}
                                        onChange={setAnswer}
                                        onToggle={toggleAnswer}
                                    />
                                    {errors[question.id] ? (
                                        <p className="mt-1 text-sm text-red-700">{errors[question.id]}</p>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}

                <p className="text-xs leading-5 text-slate-500">{settings.consentText}</p>

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

                {formError ? <p className="text-sm text-red-700">{formError}</p> : null}

                <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                >
                    {submitting ? 'Sending…' : 'Send my intake form'}
                </button>
            </form>
        </main>
    )
}
