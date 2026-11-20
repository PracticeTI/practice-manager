'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const MODE_OPTIONS = [
    {
        value: 'splose',
        label: 'Splose form (current)',
        help: 'Keeps the guided assistant over the practice’s Splose form. Nothing changes.',
    },
    {
        value: 'native',
        label: 'Native form',
        help: 'Visitors fill in the form built here. Submissions land in Forms and fill Intake Data.',
    },
    {
        value: 'both',
        label: 'Let the client choose',
        help: 'Shows both options and lets the client pick.',
    },
]

const QUESTION_TYPE_LABELS = {
    text: 'Short text',
    textarea: 'Long text',
    email: 'Email',
    phone: 'Phone',
    date: 'Date',
    number: 'Number',
    select: 'Dropdown',
    radio: 'Single choice',
    checkboxes: 'Multiple choice',
    yesno: 'Yes / no',
}

const OPTION_TYPES = new Set(['select', 'radio', 'checkboxes'])

function questionSummary(question) {
    const flags = [QUESTION_TYPE_LABELS[question.type] || question.type]
    if (question.required) flags.push('required')
    return flags.join(' · ')
}

export default function IntakeAdminPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)

    const [settings, setSettings] = useState(null)
    const [definition, setDefinition] = useState(null)
    const [questionTypes, setQuestionTypes] = useState([])
    const [savingSettings, setSavingSettings] = useState(false)
    const [savingForm, setSavingForm] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    const load = useCallback(async (domain) => {
        if (!domain) return
        const headers = await getAdminAuthHeaders()

        const [settingsResponse, formResponse] = await Promise.all([
            fetch(`/api/database/intake-settings?domain=${encodeURIComponent(domain)}`, { headers, cache: 'no-store' }),
            fetch(`/api/database/intake-form?domain=${encodeURIComponent(domain)}`, { headers, cache: 'no-store' }),
        ])

        const settingsBody = await settingsResponse.json().catch(() => ({}))
        const formBody = await formResponse.json().catch(() => ({}))

        if (!settingsResponse.ok || settingsBody.success === false) {
            throw new Error(settingsBody.error || 'Failed to load intake settings')
        }
        if (!formResponse.ok || formBody.success === false) {
            throw new Error(formBody.error || 'Failed to load the intake form')
        }

        setSettings(settingsBody.data)
        setDefinition(formBody.data)
        setQuestionTypes(Array.isArray(formBody.questionTypes) ? formBody.questionTypes : [])
    }, [getAdminAuthHeaders])

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

                setActiveDomain(effectiveDomain)
                setIsAuthenticated(true)
                await load(effectiveDomain)
            } catch (error) {
                if (!cancelled) {
                    setStatusMessage(error?.message || 'Failed to initialize intake settings')
                    setStatusTone('error')
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        bootstrap()
        return () => { cancelled = true }
    }, [load, router])

    async function saveSettings(event) {
        event.preventDefault()
        if (!settings || savingSettings) return
        setSavingSettings(true)
        setStatusMessage('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch('/api/database/intake-settings', {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: activeDomain, settings }),
            })
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.success === false) {
                setStatusMessage(body.error || 'Failed to save intake settings')
                setStatusTone('error')
                return
            }
            setSettings(body.data)
            setStatusMessage('Intake settings saved.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to save intake settings')
            setStatusTone('error')
        } finally {
            setSavingSettings(false)
        }
    }

    async function saveForm(event) {
        event.preventDefault()
        if (!definition || savingForm) return
        setSavingForm(true)
        setStatusMessage('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch('/api/database/intake-form', {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: activeDomain, definition }),
            })
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.success === false) {
                setStatusMessage(body.error || 'Failed to save the intake form')
                setStatusTone('error')
                return
            }
            setDefinition(body.data)
            setStatusMessage('Intake form saved.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to save the intake form')
            setStatusTone('error')
        } finally {
            setSavingForm(false)
        }
    }

    async function resetForm() {
        if (!window.confirm('Replace your edits with the shipped default intake form?')) return
        setSavingForm(true)
        setStatusMessage('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(`/api/database/intake-form?domain=${encodeURIComponent(activeDomain)}`, {
                method: 'DELETE',
                headers,
            })
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.success === false) {
                setStatusMessage(body.error || 'Failed to reset the intake form')
                setStatusTone('error')
                return
            }
            setDefinition(body.data)
            setStatusMessage('Intake form reset to the default.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to reset the intake form')
            setStatusTone('error')
        } finally {
            setSavingForm(false)
        }
    }

    function updateSection(sectionIndex, patch) {
        setDefinition((current) => {
            const sections = current.sections.map((section, index) => (
                index === sectionIndex ? { ...section, ...patch } : section
            ))
            return { ...current, sections }
        })
    }

    function updateQuestion(sectionIndex, questionIndex, patch) {
        setDefinition((current) => {
            const sections = current.sections.map((section, index) => {
                if (index !== sectionIndex) return section
                return {
                    ...section,
                    questions: section.questions.map((question, qIndex) => (
                        qIndex === questionIndex ? { ...question, ...patch } : question
                    )),
                }
            })
            return { ...current, sections }
        })
    }

    function addQuestion(sectionIndex) {
        setDefinition((current) => {
            const sections = current.sections.map((section, index) => {
                if (index !== sectionIndex) return section
                return {
                    ...section,
                    questions: [
                        ...section.questions,
                        {
                            id: '',
                            label: '',
                            type: 'text',
                            required: false,
                            help: '',
                            placeholder: '',
                            options: [],
                        },
                    ],
                }
            })
            return { ...current, sections }
        })
    }

    function removeQuestion(sectionIndex, questionIndex) {
        setDefinition((current) => {
            const sections = current.sections.map((section, index) => {
                if (index !== sectionIndex) return section
                return { ...section, questions: section.questions.filter((_q, qIndex) => qIndex !== questionIndex) }
            })
            return { ...current, sections }
        })
    }

    function addSection() {
        setDefinition((current) => ({
            ...current,
            sections: [
                ...current.sections,
                { id: '', title: 'New section', description: '', questions: [] },
            ],
        }))
    }

    function removeSection(sectionIndex) {
        setDefinition((current) => ({
            ...current,
            sections: current.sections.filter((_section, index) => index !== sectionIndex),
        }))
    }

    if (loading) {
        return (
            <div className="min-h-screen">
                <AdminHeader title="Intake" brandingDomainKey={activeDomain} />
                <main className="mx-auto max-w-5xl px-4 py-8 text-sm text-gray-600">Loading intake settings…</main>
            </div>
        )
    }

    if (!isAuthenticated) return null

    return (
        <div className="min-h-screen">
            <AdminHeader title="Intake" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Intake form</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Choose which intake form clients see at <code className="font-mono text-xs">/intake</code>.
                                Submissions from the native form appear under Forms and fill the patient&apos;s Intake Data.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link
                                href="/admin/forms"
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Forms
                            </Link>
                            <a
                                href={`/intake?domain=${encodeURIComponent(activeDomain)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Open intake
                            </a>
                        </div>
                    </div>

                    {statusMessage ? (
                        <p className={`mt-4 text-sm ${statusTone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                            {statusMessage}
                        </p>
                    ) : null}

                    {settings ? (
                        <form onSubmit={saveSettings} className="mt-6 grid gap-4">
                            <fieldset className="grid gap-3">
                                <legend className="text-sm font-medium text-gray-800">Which form to show</legend>
                                {MODE_OPTIONS.map((option) => (
                                    <label key={option.value} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                                        <input
                                            type="radio"
                                            name="intake-mode"
                                            value={option.value}
                                            checked={settings.mode === option.value}
                                            onChange={() => setSettings({ ...settings, mode: option.value })}
                                            className="mt-1"
                                        />
                                        <span>
                                            <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                                            <span className="block text-xs text-gray-500">{option.help}</span>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>

                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Email me when a form is submitted</span>
                                <input
                                    type="email"
                                    value={settings.notificationEmail}
                                    onChange={(event) => setSettings({ ...settings, notificationEmail: event.target.value })}
                                    placeholder="reception@practice.com.au"
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Intro text</span>
                                <textarea
                                    rows={2}
                                    maxLength={600}
                                    value={settings.introText}
                                    onChange={(event) => setSettings({ ...settings, introText: event.target.value })}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Consent statement</span>
                                <textarea
                                    rows={2}
                                    maxLength={600}
                                    value={settings.consentText}
                                    onChange={(event) => setSettings({ ...settings, consentText: event.target.value })}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Thank-you message</span>
                                <textarea
                                    rows={2}
                                    maxLength={600}
                                    value={settings.thankYouText}
                                    onChange={(event) => setSettings({ ...settings, thankYouText: event.target.value })}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            <div>
                                <button
                                    type="submit"
                                    disabled={savingSettings}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                                >
                                    {savingSettings ? 'Saving…' : 'Save intake settings'}
                                </button>
                            </div>
                        </form>
                    ) : null}
                </section>

                {definition ? (
                    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Native form questions</h2>
                                <p className="mt-1 text-sm text-gray-600">
                                    Titles that match the standard intake fields (&ldquo;Patient full name&rdquo;,
                                    &ldquo;Client Phone&rdquo;, &ldquo;Reason for Referral&rdquo;…) fill the patient record automatically.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={resetForm}
                                disabled={savingForm}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                            >
                                Reset to default
                            </button>
                        </div>

                        <form onSubmit={saveForm} className="mt-5 space-y-6">
                            <label className="block text-sm">
                                <span className="font-medium text-gray-700">Form title</span>
                                <input
                                    value={definition.title}
                                    onChange={(event) => setDefinition({ ...definition, title: event.target.value })}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </label>

                            {definition.sections.map((section, sectionIndex) => (
                                <fieldset key={`${section.id || 'section'}-${sectionIndex}`} className="rounded-lg border border-gray-200 p-4">
                                    <div className="flex flex-wrap items-end gap-3">
                                        <label className="flex-1 text-sm">
                                            <span className="font-medium text-gray-700">Section title</span>
                                            <input
                                                value={section.title}
                                                onChange={(event) => updateSection(sectionIndex, { title: event.target.value })}
                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => removeSection(sectionIndex)}
                                            className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                                        >
                                            Remove section
                                        </button>
                                    </div>

                                    <label className="mt-3 block text-sm">
                                        <span className="font-medium text-gray-700">Section description (optional)</span>
                                        <input
                                            value={section.description || ''}
                                            onChange={(event) => updateSection(sectionIndex, { description: event.target.value })}
                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>

                                    <ul className="mt-4 space-y-3">
                                        {section.questions.map((question, questionIndex) => (
                                            <li key={`${question.id || 'question'}-${questionIndex}`} className="rounded-md bg-gray-50 p-3">
                                                <div className="flex flex-wrap items-end gap-3">
                                                    <label className="flex-1 text-sm">
                                                        <span className="font-medium text-gray-700">Question</span>
                                                        <input
                                                            value={question.label}
                                                            onChange={(event) => updateQuestion(sectionIndex, questionIndex, { label: event.target.value })}
                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        />
                                                    </label>
                                                    <label className="text-sm">
                                                        <span className="font-medium text-gray-700">Type</span>
                                                        <select
                                                            value={question.type}
                                                            onChange={(event) => updateQuestion(sectionIndex, questionIndex, { type: event.target.value })}
                                                            className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        >
                                                            {(questionTypes.length > 0 ? questionTypes : Object.keys(QUESTION_TYPE_LABELS)).map((type) => (
                                                                <option key={type} value={type}>{QUESTION_TYPE_LABELS[type] || type}</option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={question.required}
                                                            onChange={(event) => updateQuestion(sectionIndex, questionIndex, { required: event.target.checked })}
                                                        />
                                                        Required
                                                    </label>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeQuestion(sectionIndex, questionIndex)}
                                                        className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-white"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>

                                                {OPTION_TYPES.has(question.type) ? (
                                                    <label className="mt-2 block text-sm">
                                                        <span className="font-medium text-gray-700">Options (comma separated)</span>
                                                        <input
                                                            value={(question.options || []).join(', ')}
                                                            onChange={(event) => updateQuestion(sectionIndex, questionIndex, {
                                                                options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean),
                                                            })}
                                                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                        />
                                                    </label>
                                                ) : null}

                                                <p className="mt-2 text-xs text-gray-500">{questionSummary(question)}</p>
                                            </li>
                                        ))}
                                    </ul>

                                    <button
                                        type="button"
                                        onClick={() => addQuestion(sectionIndex)}
                                        className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-white"
                                    >
                                        Add question
                                    </button>
                                </fieldset>
                            ))}

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={addSection}
                                    className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                                >
                                    Add section
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingForm}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                                >
                                    {savingForm ? 'Saving…' : 'Save form'}
                                </button>
                            </div>
                        </form>
                    </section>
                ) : null}
            </main>
        </div>
    )
}
