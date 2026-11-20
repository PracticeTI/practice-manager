'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import AppointmentsCalendar from './AppointmentsCalendar'
import CalendarConnectionsPanel from './CalendarConnectionsPanel'
import WaitlistPanel from './WaitlistPanel'
import BookingSettingsPanel from './BookingSettingsPanel'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { APPOINTMENT_STATUSES } from '@/lib/scheduling'
import {
    DEFAULT_EXTERNAL_SOURCE,
    PROGRESS_NOTE_STATUSES,
    formatStatusLabel,
    parseAppointmentCsv,
} from '@/lib/appointments'
import {
    formatAppointmentDateTime,
    formatAppointmentDuration,
} from '@/lib/appointmentDisplay'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const PAGE_LIMIT = '500'

const STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'All statuses' },
    ...PROGRESS_NOTE_STATUSES.map((status) => ({ value: status, label: formatStatusLabel(status) })),
]

const APPOINTMENT_STATUS_LABELS = {
    tentative: 'Tentative',
    confirmed: 'Confirmed',
    arrived: 'Arrived',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No show',
}

const APPOINTMENT_STATUS_BADGES = {
    tentative: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-blue-100 text-blue-800',
    arrived: 'bg-violet-100 text-violet-800',
    completed: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-gray-100 text-gray-600',
    no_show: 'bg-red-100 text-red-800',
}

const CONFIRMATION_LABELS = {
    pending: 'Awaiting reply',
    confirmed: 'Confirmed',
    declined: 'Declined',
    reschedule_requested: 'Reschedule requested',
    not_required: 'Not required',
}

function formatReminderTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date)
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function SummaryTile({ label, value, tone = 'neutral' }) {
    const toneClasses = tone === 'warning' ? 'text-amber-700' : 'text-gray-900'

    return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${toneClasses}`}>{value}</p>
        </div>
    )
}

function AppointmentsPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [appointmentsEnabled, setAppointmentsEnabled] = useState(false)

    const [appointments, setAppointments] = useState([])
    const [loadingAppointments, setLoadingAppointments] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [includeArchived, setIncludeArchived] = useState(false)

    const [viewMode, setViewMode] = useState('calendar')
    const [practitioners, setPractitioners] = useState([])
    const [services, setServices] = useState([])
    const [calendarAppointments, setCalendarAppointments] = useState([])
    const [calendarLoading, setCalendarLoading] = useState(false)
    const [calendarRefreshKey, setCalendarRefreshKey] = useState(0)
    const [selectedAppointment, setSelectedAppointment] = useState(null)
    const [reminders, setReminders] = useState([])
    const [remindersLoading, setRemindersLoading] = useState(false)
    const [sendingConfirmation, setSendingConfirmation] = useState(false)
    const [waitlistOffering, setWaitlistOffering] = useState(false)
    const [waitlistResult, setWaitlistResult] = useState(null)
    const [updatingStatus, setUpdatingStatus] = useState(false)

    // Kept in a ref so `refreshAppointments` stays stable and the checkbox can
    // trigger a refetch with the freshly toggled value.
    const includeArchivedRef = useRef(false)

    const [importSource, setImportSource] = useState(DEFAULT_EXTERNAL_SOURCE)
    const [importFile, setImportFile] = useState(null)
    const [importText, setImportText] = useState('')
    const [importDryRun, setImportDryRun] = useState(true)
    const [importRunning, setImportRunning] = useState(false)
    const [importResult, setImportResult] = useState(null)
    const fileInputRef = useRef(null)

    // Importing lives behind the page menu: it is an occasional, advanced tool
    // rather than part of the day-to-day list view.
    const [importMenuOpen, setImportMenuOpen] = useState(false)
    const importMenuRef = useRef(null)

    const [now] = useState(() => new Date())

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    const refreshAppointments = useCallback(async (domain) => {
        if (!domain) return

        setLoadingAppointments(true)
        try {
            const query = new URLSearchParams({ domain, limit: PAGE_LIMIT })
            if (includeArchivedRef.current) query.set('includeArchived', '1')

            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/appointments?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load appointments')
            }

            setAppointments(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setAppointments([])
            setStatusMessage(error?.message || 'Failed to load appointments')
            setStatusTone('error')
        } finally {
            setLoadingAppointments(false)
        }
    }, [getAdminAuthHeaders])

    const loadPractitioners = useCallback(async (domain) => {
        if (!domain) return

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain, active: 'true', limit: '200' })
            const response = await fetchWithTimeout(`/api/database/practitioners?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load practitioners')
            }
            setPractitioners(Array.isArray(data?.data) ? data.data : [])
        } catch {
            setPractitioners([])
        }
    }, [getAdminAuthHeaders])

    const loadServices = useCallback(async (domain) => {
        if (!domain) return

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain, active: 'true', limit: '200' })
            const response = await fetchWithTimeout(`/api/database/services?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load services')
            setServices(Array.isArray(data?.data) ? data.data : [])
        } catch {
            setServices([])
        }
    }, [getAdminAuthHeaders])

    const loadReminders = useCallback(async (appointment) => {
        if (!appointment?.id || !activeDomain) return

        setRemindersLoading(true)
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(
                `/api/database/appointments/${appointment.id}/reminders?${query.toString()}`,
                { headers, cache: 'no-store' }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load reminders')
            setReminders(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setReminders([])
            setStatusMessage(error?.message || 'Failed to load reminders')
            setStatusTone('error')
        } finally {
            setRemindersLoading(false)
        }
    }, [activeDomain, getAdminAuthHeaders])

    const openAppointment = useCallback((appointment) => {
        setSelectedAppointment(appointment)
        setWaitlistResult(null)
        setReminders([])
        loadReminders(appointment)
    }, [loadReminders])

    const loadCalendarAppointments = useCallback(async (range) => {
        if (!activeDomain || !range?.from || !range?.to) return

        setCalendarLoading(true)
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({
                domain: activeDomain,
                from: range.from,
                to: range.to,
                limit: '1000',
            })
            const response = await fetchWithTimeout(`/api/database/appointments?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load calendar appointments')
            }
            setCalendarAppointments(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setCalendarAppointments([])
            setStatusMessage(error?.message || 'Failed to load calendar appointments')
            setStatusTone('error')
        } finally {
            setCalendarLoading(false)
        }
    }, [activeDomain, getAdminAuthHeaders])

    const handleCalendarRangeChange = useCallback((range) => {
        loadCalendarAppointments(range)
    }, [loadCalendarAppointments])

    const createCalendarFeed = useCallback(async (practitionerId) => {
        const headers = await getAdminAuthHeaders()
        const query = new URLSearchParams({ domain: activeDomain })
        if (practitionerId) query.set('practitioner_id', String(practitionerId))

        const response = await fetchWithTimeout(`/api/database/calendar-feed?${query.toString()}`, {
            headers,
            cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to create calendar feed URL')
        }
        return data?.data?.url || ''
    }, [activeDomain, getAdminAuthHeaders])

    const updateAppointmentStatus = useCallback(async (appointment, status) => {
        if (!appointment?.id) return

        setUpdatingStatus(true)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const headers = await getAdminAuthHeaders()
            const payload = { appointment_status: status }
            const nowIso = new Date().toISOString()
            if (status === 'tentative' || status === 'confirmed') {
                payload.arrived_at = null
                payload.completed_at = null
                payload.cancelled_at = null
            }
            if (status === 'arrived') {
                payload.arrived_at = nowIso
                payload.completed_at = null
                payload.cancelled_at = null
            }
            if (status === 'completed') {
                payload.completed_at = nowIso
                payload.cancelled_at = null
            }
            if (status === 'cancelled') {
                payload.cancelled_at = nowIso
                payload.completed_at = null
            }
            if (status === 'no_show') {
                payload.completed_at = null
                payload.cancelled_at = null
            }

            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/appointments/${appointment.id}?${query.toString()}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to update appointment')
            }

            const updated = data?.appointment || { ...appointment, ...payload }
            setSelectedAppointment(updated)
            setAppointments((rows) => rows.map((row) => (
                String(row.id) === String(updated.id) ? { ...row, ...updated } : row
            )))
            setCalendarAppointments((rows) => rows.map((row) => (
                String(row.id) === String(updated.id) ? { ...row, ...updated } : row
            )))
            setStatusMessage(`Appointment marked ${APPOINTMENT_STATUS_LABELS[status] || status}.`)
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to update appointment')
            setStatusTone('error')
        } finally {
            setUpdatingStatus(false)
        }
    }, [activeDomain, getAdminAuthHeaders])

    const sendConfirmation = useCallback(async () => {
        if (!selectedAppointment?.id) return

        setSendingConfirmation(true)
        setStatusMessage('')
        setStatusTone('neutral')
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(
                `/api/database/appointments/${selectedAppointment.id}/reminders?${query.toString()}`,
                {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send_confirmation' }),
                }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to send the confirmation')
            }
            setStatusMessage(`Confirmation sent via ${data?.data?.channel || 'message'}.`)
            setStatusTone('success')
            await loadReminders(selectedAppointment)
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to send the confirmation')
            setStatusTone('error')
        } finally {
            setSendingConfirmation(false)
        }
    }, [selectedAppointment, activeDomain, getAdminAuthHeaders, loadReminders])

    const offerToWaitlist = useCallback(async () => {
        if (!selectedAppointment?.id) return

        setWaitlistOffering(true)
        setWaitlistResult(null)
        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/waitlist/backfill?${query.toString()}`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ appointment_id: selectedAppointment.id }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to offer the slot')
            }
            const result = {
                offered: data?.data?.offered ?? 0,
                reason: data?.data?.reason || '',
                results: data?.data?.results || [],
            }
            setWaitlistResult(result)
            setStatusMessage(result.offered
                ? `Offered the slot to ${result.offered} waitlist ${result.offered === 1 ? 'entry' : 'entries'}.`
                : 'No matching waitlist entries.')
            setStatusTone(result.offered ? 'success' : 'neutral')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to offer the slot')
            setStatusTone('error')
        } finally {
            setWaitlistOffering(false)
        }
    }, [selectedAppointment, activeDomain, getAdminAuthHeaders])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { appointmentsEnabled: false }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                appointmentsEnabled: domainSettings?.patientsEnabled === true
                    && domainSettings?.appointmentsCardEnabled !== false,
            }
        } catch {
            return { appointmentsEnabled: false }
        }
    }, [])

    // Dismiss the import menu on an outside click or Escape so it never traps
    // the page in a half-open state.
    useEffect(() => {
        if (!importMenuOpen) return undefined

        const handlePointerDown = (event) => {
            if (importMenuRef.current && !importMenuRef.current.contains(event.target)) {
                setImportMenuOpen(false)
            }
        }
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setImportMenuOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [importMenuOpen])

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

                const domainFeatureState = await loadDomainFeatureState(token, effectiveDomain)
                if (cancelled) return

                setActiveDomain(effectiveDomain)
                setAppointmentsEnabled(domainFeatureState.appointmentsEnabled)
                setIsAuthenticated(true)
                await refreshAppointments(effectiveDomain)
                await loadPractitioners(effectiveDomain)
                await loadServices(effectiveDomain)
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize appointments view')
                setStatusTone('error')
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
    }, [router, loadDomainFeatureState, refreshAppointments, loadPractitioners, loadServices])

    const summary = useMemo(() => {
        return appointments.reduce((acc, row) => {
            acc.total += 1
            const startsAt = row?.starts_at ? new Date(row.starts_at) : null
            if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() >= now.getTime()) {
                acc.upcoming += 1
            }
            const status = String(row?.progress_note_status || '').toLowerCase()
            if (status.startsWith('finalised')) acc.finalised += 1
            else if (status.startsWith('draft')) acc.draft += 1
            return acc
        }, { total: 0, upcoming: 0, finalised: 0, draft: 0 })
    }, [appointments, now])

    const filteredRows = useMemo(() => {
        const query = String(searchQuery || '').trim().toLowerCase()

        return appointments.filter((row) => {
            if (statusFilter !== 'all') {
                const status = String(row?.progress_note_status || '').toLowerCase()
                if (statusFilter === 'no status') {
                    if (status && !status.startsWith('no status')) return false
                } else if (!status.startsWith(statusFilter)) {
                    return false
                }
            }
            if (!query) return true

            const haystack = [
                row?.patient_name,
                row?.linked_patient_name,
                row?.practitioner,
                row?.service,
                row?.location,
                row?.external_id,
            ]
                .map((value) => String(value || '').toLowerCase())
                .join(' ')

            return haystack.includes(query)
        })
    }, [appointments, searchQuery, statusFilter])

    const calendarNotice = useMemo(() => {
        const status = searchParams.get('calendar')
        if (!status) return null
        if (status === 'connected') {
            const provider = searchParams.get('provider') === 'microsoft' ? 'Microsoft 365' : 'Google Calendar'
            const synced = searchParams.get('sync') === 'synced'
            return {
                tone: 'success',
                message: `${provider} connected${synced ? ' and busy time synced' : ''}.`,
            }
        }
        return {
            tone: 'error',
            message: `Calendar connection failed: ${searchParams.get('reason') || 'unknown error'}`,
        }
    }, [searchParams])

    const importPreview = useMemo(() => {
        if (!importText) return null
        try {
            const parsed = parseAppointmentCsv(importText)
            return {
                rowCount: parsed.rowCount,
                unknownHeaders: parsed.unknownHeaders,
                firstRow: parsed.records[0]?.raw || null,
            }
        } catch (error) {
            return { error: error?.message || 'Failed to parse CSV' }
        }
    }, [importText])

    const handleFileSelected = useCallback(async (file) => {
        if (!file) return

        setImportFile(file)
        setImportResult(null)

        try {
            const text = await file.text()
            setImportText(text)
        } catch (error) {
            setImportText('')
            setStatusMessage(error?.message || 'Failed to read the selected file')
            setStatusTone('error')
        }
    }, [])

    const runImport = useCallback(async (dryRun) => {
        if (!importText) {
            setStatusMessage('Choose a CSV file to import first')
            setStatusTone('error')
            return
        }

        setImportRunning(true)
        setImportResult(null)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/appointments/import', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: activeDomain,
                    csv: importText,
                    source: importSource || DEFAULT_EXTERNAL_SOURCE,
                    fileName: importFile?.name || null,
                    dryRun,
                }),
            }, 120000)

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to import appointments')
            }

            setImportResult(data?.data || null)
            setStatusTone('success')

            if (!dryRun) {
                setStatusMessage(`Import complete: ${data?.data?.inserted ?? 0} added, ${data?.data?.updated ?? 0} updated.`)
                await refreshAppointments(activeDomain)
                setCalendarRefreshKey((key) => key + 1)
            } else {
                setStatusMessage('Dry run complete — nothing was written.')
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to import appointments')
            setStatusTone('error')
        } finally {
            setImportRunning(false)
        }
    }, [importText, importSource, importFile, activeDomain, getAdminAuthHeaders, refreshAppointments])

    const deleteAppointment = useCallback(async (row) => {
        if (typeof window !== 'undefined' && !window.confirm('Delete this appointment? This cannot be undone.')) {
            return
        }

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/appointments/${row.id}?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete appointment')
            }
            await refreshAppointments(activeDomain)
            setCalendarAppointments((rows) => rows.filter((entry) => String(entry.id) !== String(row.id)))
            setSelectedAppointment(null)
            setStatusMessage('Appointment deleted.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to delete appointment')
            setStatusTone('error')
        }
    }, [activeDomain, getAdminAuthHeaders, refreshAppointments])

    const openPatient = (row) => {
        const patientId = String(row?.patient_id || '').trim()
        if (!patientId) return
        router.push(`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=appointments`)
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading appointments...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    const selectedStatus = selectedAppointment?.appointment_status || 'confirmed'
    const selectedPatientName = selectedAppointment?.linked_patient_name
        || selectedAppointment?.patient_name
        || 'Unnamed patient'
    const selectedDuration = selectedAppointment
        ? formatAppointmentDuration(selectedAppointment.starts_at, selectedAppointment.ends_at)
        : ''
    const selectedTimeLabel = selectedAppointment?.starts_at
        ? new Intl.DateTimeFormat('en-AU', {
            timeZone: selectedAppointment.timezone || 'Australia/Sydney',
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(new Date(selectedAppointment.starts_at))
        : ''

    return (
        <div className="min-h-screen">
            <AdminHeader title="Appointments" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Run the appointment calendar, update session statuses, and manage slots.
                                Imported records keep their upstream ID.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => router.push('/admin')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Back to Admin
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    refreshAppointments(activeDomain)
                                    setCalendarRefreshKey((key) => key + 1)
                                }}
                                disabled={loadingAppointments || calendarLoading}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingAppointments || calendarLoading ? 'Refreshing...' : 'Refresh'}
                            </button>

                            {/* Import lives behind this menu: it is an occasional,
                                advanced tool rather than part of the daily list view. */}
                            <div className="relative" ref={importMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setImportMenuOpen((open) => !open)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                                    aria-label="More actions"
                                    aria-haspopup="true"
                                    aria-expanded={importMenuOpen}
                                    title="More actions"
                                >
                                    <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                                </button>

                                {importMenuOpen && (
                                    <div className="absolute right-0 top-full z-20 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 text-left shadow-lg">
                                        <h2 className="text-sm font-semibold text-gray-900">Import appointments</h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Upload a CSV export from the practice management system. Rows are matched on the
                                            external appointment ID, so re-importing the same file only touches records that
                                            changed. Start with a dry run to preview the changes.
                                        </p>

                                        <label className="mt-4 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">CSV file</span>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".csv,text/csv"
                                                onChange={(event) => handleFileSelected(event.target.files?.[0] || null)}
                                                className="mt-1 w-full text-sm text-gray-700"
                                            />
                                        </label>

                                        <label className="mt-3 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">External source</span>
                                            <input
                                                type="text"
                                                value={importSource}
                                                onChange={(event) => setImportSource(event.target.value)}
                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="splose"
                                            />
                                        </label>

                                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={importDryRun}
                                                onChange={(event) => setImportDryRun(event.target.checked)}
                                                className="h-4 w-4"
                                            />
                                            Dry run
                                        </label>

                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => runImport(true)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Working...' : 'Preview changes'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => runImport(importDryRun)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Importing...' : (importDryRun ? 'Import (dry run)' : 'Import')}
                                            </button>
                                        </div>

                                        {importPreview && (
                                            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                                {importPreview.error ? (
                                                    <span className="text-red-700">{importPreview.error}</span>
                                                ) : (
                                                    <>
                                                        <p>
                                                            <span className="font-semibold">{importPreview.rowCount}</span> data row(s) detected
                                                            {importFile?.name ? ` in ${importFile.name}` : ''}.
                                                        </p>
                                                        {importPreview.unknownHeaders?.length > 0 && (
                                                            <p className="mt-1 text-amber-800">
                                                                Unrecognised column(s) will be ignored: {importPreview.unknownHeaders.join(', ')}
                                                            </p>
                                                        )}
                                                        {importPreview.firstRow && (
                                                            <p className="mt-1 text-gray-500">
                                                                First row: {importPreview.firstRow.patient_name || 'no patient'} ·{' '}
                                                                {importPreview.firstRow.external_id || 'no external ID'}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {importResult && (
                                            <div className="mt-3 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                                                <p className="font-semibold text-gray-900">
                                                    {importResult.dryRun ? 'Dry run result' : 'Import result'}
                                                </p>
                                                <ul className="mt-1 space-y-0.5">
                                                    <li>Rows read: {importResult.total}</li>
                                                    <li>Added: {importResult.inserted}</li>
                                                    <li>Updated: {importResult.updated}</li>
                                                    <li>Unchanged: {importResult.unchanged}</li>
                                                    <li>Skipped: {importResult.skipped}</li>
                                                </ul>
                                                {importResult.errors?.length > 0 && (
                                                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-700">
                                                        {importResult.errors.map((entry) => (
                                                            <li key={`${entry.row}-${entry.message}`}>Row {entry.row}: {entry.message}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {statusMessage && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    )}

                    {calendarNotice && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${calendarNotice.tone === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                            {calendarNotice.message}
                        </p>
                    )}

                    {!appointmentsEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Appointments are disabled. Enable Patients and the Appointments card in
                            Domain Settings first.
                        </p>
                    )}
                </section>

                <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <SummaryTile label="Total" value={summary.total} />
                    <SummaryTile label="Upcoming" value={summary.upcoming} />
                    <SummaryTile label="Finalised notes" value={summary.finalised} />
                    <SummaryTile label="Draft notes" value={summary.draft} tone={summary.draft > 0 ? 'warning' : 'neutral'} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold text-gray-900">
                                {viewMode === 'calendar' ? 'Calendar' : 'All Appointments'}
                            </h2>
                            <p className="mt-1 text-xs text-gray-500">
                                {viewMode === 'calendar'
                                    ? 'Click an appointment to review it or update its status.'
                                    : `Showing ${filteredRows.length} of ${appointments.length} loaded records.`}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('calendar')}
                                    className={`px-3 py-2 text-sm ${viewMode === 'calendar' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                    Calendar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('list')}
                                    className={`border-l border-gray-300 px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                    List
                                </button>
                            </div>
                            {viewMode === 'list' && (
                                <>
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="Filter by patient, practitioner, service or ID"
                                    />
                                    <select
                                        value={statusFilter}
                                        onChange={(event) => setStatusFilter(event.target.value)}
                                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    >
                                        {STATUS_FILTER_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={includeArchived}
                                            onChange={(event) => {
                                                const next = event.target.checked
                                                includeArchivedRef.current = next
                                                setIncludeArchived(next)
                                                refreshAppointments(activeDomain)
                                            }}
                                            className="h-4 w-4"
                                        />
                                        Include archived
                                    </label>
                                </>
                            )}
                        </div>
                    </div>

                    {viewMode === 'calendar' ? (
                        <div className="mt-4">
                            <AppointmentsCalendar
                                appointments={calendarAppointments}
                                practitioners={practitioners}
                                defaultTimezone="Australia/Sydney"
                                loading={calendarLoading}
                                refreshKey={calendarRefreshKey}
                                selectedAppointmentId={selectedAppointment?.id || null}
                                onSelectAppointment={openAppointment}
                                onRangeChange={handleCalendarRangeChange}
                                onSubscribe={createCalendarFeed}
                            />
                        </div>
                    ) : (
                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Start</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Practitioner</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Service</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Location</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Note status</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">External ID</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRows.map((row) => {
                                    const duration = formatAppointmentDuration(row.starts_at, row.ends_at)
                                    return (
                                        <tr key={row.id}>
                                            <td className="px-3 py-2 text-gray-700">
                                                {formatAppointmentDateTime(row.starts_at)}
                                                {duration && (
                                                    <span className="block text-xs text-gray-500">{duration}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-gray-900">
                                                {row.linked_patient_name || row.patient_name || '—'}
                                                {row.patient_id ? (
                                                    <span className="block text-xs text-emerald-700">Linked</span>
                                                ) : row.patient_name ? (
                                                    <span className="block text-xs text-gray-400">Not linked</span>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">{row.practitioner || '—'}</td>
                                            <td className="px-3 py-2 text-gray-700">{row.service || '—'}</td>
                                            <td className="px-3 py-2 text-gray-700">{row.location || '—'}</td>
                                            <td className="px-3 py-2 text-gray-700">{formatStatusLabel(row.progress_note_status)}</td>
                                            <td className="px-3 py-2 text-xs text-gray-500">
                                                {row.external_id || '—'}
                                                <span className="block text-gray-400">{row.external_source}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    {row.patient_id ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openPatient(row)}
                                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                        >
                                                            Open patient
                                                        </button>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteAppointment(row)}
                                                        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}

                                {!loadingAppointments && filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-3 py-5 text-center text-gray-500">
                                            No appointments found. Use the ⋮ menu above to import a CSV export.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    )}
                </section>

                <CalendarConnectionsPanel
                    domain={activeDomain}
                    practitioners={practitioners}
                    getAuthHeaders={getAdminAuthHeaders}
                    onChanged={() => setCalendarRefreshKey((key) => key + 1)}
                />

                <WaitlistPanel
                    domain={activeDomain}
                    practitioners={practitioners}
                    services={services}
                    getAuthHeaders={getAdminAuthHeaders}
                    onChanged={() => setCalendarRefreshKey((key) => key + 1)}
                />

                <BookingSettingsPanel
                    domain={activeDomain}
                    getAuthHeaders={getAdminAuthHeaders}
                />
            </main>

            {selectedAppointment && (
                <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Appointment details">
                    <button
                        type="button"
                        onClick={() => setSelectedAppointment(null)}
                        className="absolute inset-0 h-full w-full cursor-default bg-black/20"
                        aria-label="Close appointment details"
                    />
                    <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
                        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">{selectedPatientName}</h2>
                                <p className="mt-1 text-sm text-gray-500">
                                    {selectedTimeLabel}
                                    {selectedDuration ? ` · ${selectedDuration}` : ''}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedAppointment(null)}
                                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="space-y-5 px-5 py-5">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${APPOINTMENT_STATUS_BADGES[selectedStatus] || APPOINTMENT_STATUS_BADGES.confirmed}`}>
                                {APPOINTMENT_STATUS_LABELS[selectedStatus] || selectedStatus}
                            </span>

                            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                                <dt className="text-gray-500">Practitioner</dt>
                                <dd className="col-span-2 text-gray-900">{selectedAppointment.practitioner || '—'}</dd>
                                <dt className="text-gray-500">Service</dt>
                                <dd className="col-span-2 text-gray-900">{selectedAppointment.service || '—'}</dd>
                                <dt className="text-gray-500">Location</dt>
                                <dd className="col-span-2 text-gray-900">{selectedAppointment.location || '—'}</dd>
                                <dt className="text-gray-500">Timezone</dt>
                                <dd className="col-span-2 text-gray-900">{selectedAppointment.timezone || 'Australia/Sydney'}</dd>
                                <dt className="text-gray-500">Patient</dt>
                                <dd className="col-span-2 text-gray-900">
                                    {selectedAppointment.patient_id ? 'Linked to patient record' : 'Not linked'}
                                </dd>
                                <dt className="text-gray-500">External ID</dt>
                                <dd className="col-span-2 text-gray-900">{selectedAppointment.external_id || '—'}</dd>
                                <dt className="text-gray-500">Confirmation</dt>
                                <dd className="col-span-2 text-gray-900">
                                    {CONFIRMATION_LABELS[selectedAppointment.confirmation_status] || 'Awaiting reply'}
                                </dd>
                            </dl>

                            <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Update status</h3>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {APPOINTMENT_STATUSES.map((nextStatus) => (
                                        <button
                                            key={nextStatus}
                                            type="button"
                                            disabled={updatingStatus || nextStatus === selectedStatus}
                                            onClick={() => updateAppointmentStatus(selectedAppointment, nextStatus)}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            {APPOINTMENT_STATUS_LABELS[nextStatus]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border-t border-gray-200 pt-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reminders</h3>
                                    <button
                                        type="button"
                                        onClick={sendConfirmation}
                                        disabled={sendingConfirmation}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {sendingConfirmation ? 'Sending…' : 'Send confirmation now'}
                                    </button>
                                </div>
                                {remindersLoading ? (
                                    <p className="mt-2 text-xs text-gray-500">Loading reminders…</p>
                                ) : reminders.length > 0 ? (
                                    <ul className="mt-2 space-y-1 text-xs text-gray-600">
                                        {reminders.map((reminder) => (
                                            <li key={reminder.id} className="flex items-center justify-between gap-2">
                                                <span>
                                                    {reminder.kind === 'confirmation' ? 'Confirmation request' : `Reminder ${reminder.offset_hours}h before`}
                                                    {' · '}
                                                    {formatReminderTime(reminder.scheduled_for)}
                                                </span>
                                                <span className={`rounded-full px-2 py-0.5 font-semibold ${reminder.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : reminder.status === 'skipped' || reminder.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>
                                                    {reminder.status}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-xs text-gray-500">No reminders scheduled.</p>
                                )}
                            </div>

                            {selectedAppointment.appointment_status === 'cancelled' && (
                                <div className="border-t border-gray-200 pt-4">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Waitlist</h3>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Offer this cancelled slot to the best-matching waiting participant.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={offerToWaitlist}
                                        disabled={waitlistOffering}
                                        className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {waitlistOffering ? 'Offering…' : 'Offer this slot to the waitlist'}
                                    </button>
                                    {waitlistResult && (
                                        <p className={`mt-2 text-xs ${waitlistResult.offered ? 'text-emerald-700' : 'text-gray-600'}`}>
                                            {waitlistResult.offered
                                                ? `Offer sent to ${waitlistResult.offered} participant(s).`
                                                : waitlistResult.reason === 'no_matching_waitlist_entries'
                                                    ? 'No matching waitlist entries.'
                                                    : 'No offer was sent. Check contact details or provider configuration.'}
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
                                {selectedAppointment.patient_id ? (
                                    <button
                                        type="button"
                                        onClick={() => openPatient(selectedAppointment)}
                                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                        Open patient
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => deleteAppointment(selectedAppointment)}
                                    className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                                >
                                    Delete appointment
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            )}
        </div>
    )
}

export default function AppointmentsPage() {
    return (
        <Suspense>
            <AppointmentsPageContent />
        </Suspense>
    )
}
