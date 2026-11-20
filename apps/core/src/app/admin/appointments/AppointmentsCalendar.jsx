'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Copy,
    Link2,
    Loader2,
} from 'lucide-react'
import { APPOINTMENT_STATUSES } from '@/lib/scheduling'
import {
    addDaysToDateString,
    formatDateInTimeZone,
    getZonedParts,
    weekdayForDateString,
    zonedDateTimeToUtc,
} from '@/lib/practitionerAvailability'

const HOUR_HEIGHT = 64
const DEFAULT_START_HOUR = 7
const DEFAULT_END_HOUR = 19

const STATUS_LABELS = {
    tentative: 'Tentative',
    confirmed: 'Confirmed',
    arrived: 'Arrived',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No show',
}

const STATUS_STYLES = {
    tentative: 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100',
    confirmed: 'border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100',
    arrived: 'border-violet-300 bg-violet-50 text-violet-950 hover:bg-violet-100',
    completed: 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
    cancelled: 'border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200',
    no_show: 'border-red-300 bg-red-50 text-red-950 hover:bg-red-100',
}

const STATUS_DOTS = {
    tentative: 'bg-amber-400',
    confirmed: 'bg-blue-500',
    arrived: 'bg-violet-500',
    completed: 'bg-emerald-500',
    cancelled: 'bg-gray-400',
    no_show: 'bg-red-500',
}

function formatHour(hour) {
    return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(iso, timezone) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date)
}

function formatDayHeader(dateString) {
    return new Intl.DateTimeFormat('en-AU', {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(new Date(`${dateString}T00:00:00Z`))
}

function formatRangeLabel(days) {
    if (days.length === 0) return ''
    const first = new Date(`${days[0]}T00:00:00Z`)
    const last = new Date(`${days[days.length - 1]}T00:00:00Z`)
    const formatter = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
    if (days.length === 1) return formatter.format(first)
    return `${formatter.format(first)} – ${formatter.format(last)}`
}

function buildDayLayout(appointments, timezone, hourStart) {
    const items = (appointments || [])
        .map((appointment) => {
            const start = getZonedParts(new Date(appointment.starts_at), timezone)
            const end = getZonedParts(new Date(appointment.ends_at || appointment.starts_at), timezone)
            const startMinutes = start.hour * 60 + start.minute
            const sameDay = start.date === end.date
            const endMinutes = sameDay
                ? Math.max(startMinutes + 15, end.hour * 60 + end.minute)
                : 24 * 60
            return { appointment, startMinutes, endMinutes }
        })
        .sort((a, b) => a.startMinutes - b.startMinutes)

    // Group overlapping appointments into clusters, then place each cluster's
    // members in side-by-side columns.
    const clusters = []
    let current = []
    let clusterEnd = -1

    for (const item of items) {
        if (current.length > 0 && item.startMinutes >= clusterEnd) {
            clusters.push(current)
            current = []
            clusterEnd = -1
        }
        current.push(item)
        clusterEnd = Math.max(clusterEnd, item.endMinutes)
    }
    if (current.length > 0) clusters.push(current)

    const layout = new Map()
    for (const cluster of clusters) {
        const columnEnds = []
        const assignments = cluster.map((item) => {
            let column = columnEnds.findIndex((end) => item.startMinutes >= end)
            if (column === -1) {
                column = columnEnds.length
                columnEnds.push(item.endMinutes)
            } else {
                columnEnds[column] = item.endMinutes
            }
            return { item, column }
        })

        const total = Math.max(1, columnEnds.length)
        for (const { item, column } of assignments) {
            const top = Math.max(0, ((item.startMinutes - hourStart * 60) / 60) * HOUR_HEIGHT)
            const visibleStart = Math.max(item.startMinutes, hourStart * 60)
            const height = Math.max(26, ((item.endMinutes - visibleStart) / 60) * HOUR_HEIGHT)
            layout.set(item.appointment.id, { top, height, column, total })
        }
    }

    return layout
}

export default function AppointmentsCalendar({
    appointments = [],
    practitioners = [],
    defaultTimezone = 'Australia/Sydney',
    loading = false,
    selectedAppointmentId = null,
    refreshKey = 0,
    onSelectAppointment,
    onRangeChange,
    onSubscribe,
}) {
    const [viewMode, setViewMode] = useState('week')
    const [anchorDate, setAnchorDate] = useState(() => formatDateInTimeZone(new Date(), defaultTimezone))
    const [practitionerFilter, setPractitionerFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [feedUrl, setFeedUrl] = useState('')
    const [feedError, setFeedError] = useState('')
    const [feedLoading, setFeedLoading] = useState(false)
    const [copyState, setCopyState] = useState('')
    const [now, setNow] = useState(() => new Date())

    const selectedPractitioner = useMemo(
        () => practitioners.find((item) => String(item.id) === String(practitionerFilter)) || null,
        [practitioners, practitionerFilter]
    )
    const timezone = selectedPractitioner?.timezone || defaultTimezone

    useEffect(() => {
        const handle = setInterval(() => setNow(new Date()), 60000)
        return () => clearInterval(handle)
    }, [])

    const days = useMemo(() => {
        if (viewMode === 'day') return [anchorDate]
        const weekday = weekdayForDateString(anchorDate)
        const mondayOffset = (weekday + 6) % 7
        const start = addDaysToDateString(anchorDate, -mondayOffset)
        return Array.from({ length: 7 }, (_value, index) => addDaysToDateString(start, index))
    }, [anchorDate, viewMode])

    const rangeStartDate = days[0]
    const rangeEndDate = days[days.length - 1]

    useEffect(() => {
        if (!onRangeChange || !rangeStartDate || !rangeEndDate) return
        onRangeChange({
            from: new Date(zonedDateTimeToUtc(rangeStartDate, '00:00', timezone)).toISOString(),
            to: new Date(
                zonedDateTimeToUtc(addDaysToDateString(rangeEndDate, 1), '00:00', timezone) - 1
            ).toISOString(),
        })
    }, [onRangeChange, rangeStartDate, rangeEndDate, timezone, refreshKey])

    const daySet = useMemo(() => new Set(days), [days])

    const visibleAppointments = useMemo(() => {
        return (appointments || []).filter((appointment) => {
            if (!appointment?.starts_at) return false
            if (practitionerFilter !== 'all'
                && Number(appointment.practitioner_id) !== Number(practitionerFilter)) {
                return false
            }
            const status = appointment.appointment_status || 'confirmed'
            if (statusFilter !== 'all' && status !== statusFilter) return false
            return daySet.has(formatDateInTimeZone(new Date(appointment.starts_at), timezone))
        })
    }, [appointments, practitionerFilter, statusFilter, daySet, timezone])

    const appointmentsByDay = useMemo(() => {
        const map = new Map(days.map((day) => [day, []]))
        visibleAppointments.forEach((appointment) => {
            const day = formatDateInTimeZone(new Date(appointment.starts_at), timezone)
            if (map.has(day)) map.get(day).push(appointment)
        })
        map.forEach((list) => list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))))
        return map
    }, [days, visibleAppointments, timezone])

    const hourRange = useMemo(() => {
        let start = DEFAULT_START_HOUR
        let end = DEFAULT_END_HOUR

        visibleAppointments.forEach((appointment) => {
            const startParts = getZonedParts(new Date(appointment.starts_at), timezone)
            const endParts = getZonedParts(new Date(appointment.ends_at || appointment.starts_at), timezone)
            start = Math.min(start, startParts.hour)
            end = Math.max(end, endParts.hour + (endParts.minute > 0 ? 1 : 0))
        })

        const safeStart = Math.max(0, Math.min(22, start))
        const safeEnd = Math.min(24, Math.max(safeStart + 2, end))
        return { start: safeStart, end: safeEnd }
    }, [visibleAppointments, timezone])

    const hours = useMemo(() => {
        const list = []
        for (let hour = hourRange.start; hour < hourRange.end; hour += 1) list.push(hour)
        return list
    }, [hourRange])

    const bodyHeight = (hourRange.end - hourRange.start) * HOUR_HEIGHT

    const layoutByDay = useMemo(() => {
        const map = new Map()
        days.forEach((day) => {
            map.set(day, buildDayLayout(appointmentsByDay.get(day) || [], timezone, hourRange.start))
        })
        return map
    }, [appointmentsByDay, days, timezone, hourRange.start])

    const todayKey = formatDateInTimeZone(now, timezone)
    const nowParts = getZonedParts(now, timezone)
    const nowMinutes = nowParts.hour * 60 + nowParts.minute
    const nowVisible = nowMinutes >= hourRange.start * 60 && nowMinutes <= hourRange.end * 60
    const nowTop = ((nowMinutes - hourRange.start * 60) / 60) * HOUR_HEIGHT

    const move = useCallback((direction) => {
        setAnchorDate((current) => addDaysToDateString(current, direction * (viewMode === 'week' ? 7 : 1)))
    }, [viewMode])

    const goToday = useCallback(() => {
        setAnchorDate(formatDateInTimeZone(new Date(), timezone))
    }, [timezone])

    const handleViewChange = useCallback((nextView) => {
        setViewMode(nextView)
    }, [])

    const handleSubscribe = useCallback(async () => {
        if (!onSubscribe) return
        setFeedLoading(true)
        setFeedError('')
        setCopyState('')
        try {
            const url = await onSubscribe(
                practitionerFilter === 'all' ? null : Number(practitionerFilter)
            )
            if (url) setFeedUrl(url)
        } catch (error) {
            setFeedError(error?.message || 'Failed to create subscription URL')
        } finally {
            setFeedLoading(false)
        }
    }, [onSubscribe, practitionerFilter])

    const copyFeedUrl = useCallback(async () => {
        if (!feedUrl) return
        try {
            await navigator.clipboard.writeText(feedUrl)
            setCopyState('Copied')
        } catch {
            setCopyState('Copy failed')
        }
    }, [feedUrl])

    return (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-md border border-gray-300 bg-white">
                        <button
                            type="button"
                            onClick={() => move(-1)}
                            className="inline-flex h-9 w-9 items-center justify-center text-gray-600 hover:bg-gray-50"
                            aria-label="Previous period"
                        >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={goToday}
                            className="border-x border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Today
                        </button>
                        <button
                            type="button"
                            onClick={() => move(1)}
                            className="inline-flex h-9 w-9 items-center justify-center text-gray-600 hover:bg-gray-50"
                            aria-label="Next period"
                        >
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>

                    <div>
                        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                            <CalendarDays className="h-4 w-4 text-gray-500" aria-hidden="true" />
                            {formatRangeLabel(days)}
                        </h2>
                        <p className="text-xs text-gray-500">
                            {loading ? 'Loading appointments…' : `${visibleAppointments.length} appointment${visibleAppointments.length === 1 ? '' : 's'}`}
                            {' · '}
                            {timezone}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={practitionerFilter}
                        onChange={(event) => setPractitionerFilter(event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        aria-label="Filter by practitioner"
                    >
                        <option value="all">All practitioners</option>
                        {practitioners.map((practitioner) => (
                            <option key={practitioner.id} value={practitioner.id}>
                                {practitioner.display_name}
                            </option>
                        ))}
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        {APPOINTMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                        ))}
                    </select>

                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                        <button
                            type="button"
                            onClick={() => handleViewChange('week')}
                            className={`px-3 py-2 text-sm ${viewMode === 'week' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                        >
                            Week
                        </button>
                        <button
                            type="button"
                            onClick={() => handleViewChange('day')}
                            className={`border-l border-gray-300 px-3 py-2 text-sm ${viewMode === 'day' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                        >
                            Day
                        </button>
                    </div>

                    {onSubscribe && (
                        <button
                            type="button"
                            onClick={handleSubscribe}
                            disabled={feedLoading}
                            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {feedLoading
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                : <Link2 className="h-4 w-4" aria-hidden="true" />}
                            Subscribe
                        </button>
                    )}
                </div>
            </div>

            {(feedUrl || feedError) && (
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                    {feedError ? (
                        <p className="text-red-700">{feedError}</p>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs text-gray-600">
                                Subscribe from Google Calendar, Apple Calendar or Outlook. The URL is a private
                                credential and only shows patient initials.
                            </p>
                            <div className="flex w-full items-center gap-2">
                                <input
                                    readOnly
                                    value={feedUrl}
                                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700"
                                    aria-label="Calendar subscription URL"
                                />
                                <button
                                    type="button"
                                    onClick={copyFeedUrl}
                                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                    {copyState || 'Copy'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
                <div className={viewMode === 'day' ? 'min-w-[420px]' : 'min-w-[760px]'}>
                    <div className="sticky top-0 z-10 flex border-b border-gray-200 bg-white">
                        <div className="w-16 shrink-0" />
                        {days.map((day) => {
                            const isToday = day === todayKey
                            return (
                                <div
                                    key={day}
                                    className={`flex-1 border-l border-gray-200 px-2 py-2 text-center ${isToday ? 'bg-blue-50' : ''}`}
                                >
                                    <div className={`text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                                        {formatDayHeader(day)}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex">
                        <div className="relative w-16 shrink-0" style={{ height: bodyHeight }}>
                            {hours.map((hour) => (
                                <div
                                    key={hour}
                                    className="absolute right-2 text-[11px] font-medium text-gray-400"
                                    style={{ top: (hour - hourRange.start) * HOUR_HEIGHT + 2 }}
                                >
                                    {formatHour(hour)}
                                </div>
                            ))}
                        </div>

                        {days.map((day) => {
                            const dayAppointments = appointmentsByDay.get(day) || []
                            const layout = layoutByDay.get(day) || new Map()

                            return (
                                <div
                                    key={day}
                                    className="relative flex-1 border-l border-gray-200"
                                    style={{ height: bodyHeight }}
                                >
                                    {hours.map((hour) => (
                                        <div
                                            key={hour}
                                            className="absolute inset-x-0 border-t border-gray-100"
                                            style={{ top: (hour - hourRange.start) * HOUR_HEIGHT }}
                                        />
                                    ))}

                                    {dayAppointments.map((appointment) => {
                                        const position = layout.get(appointment.id) || {
                                            top: 0,
                                            height: 26,
                                            column: 0,
                                            total: 1,
                                        }
                                        const status = appointment.appointment_status || 'confirmed'
                                        const style = STATUS_STYLES[status] || STATUS_STYLES.confirmed
                                        const selected = String(appointment.id) === String(selectedAppointmentId)
                                        const patient = appointment.linked_patient_name
                                            || appointment.patient_name
                                            || 'Unnamed patient'

                                        return (
                                            <button
                                                key={appointment.id}
                                                type="button"
                                                onClick={() => onSelectAppointment?.(appointment)}
                                                className={`absolute overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-sm transition ${style} ${selected ? 'z-20 ring-2 ring-gray-900 ring-offset-1' : 'z-0'}`}
                                                style={{
                                                    top: position.top,
                                                    height: position.height,
                                                    left: `calc(${(position.column / position.total) * 100}% + 2px)`,
                                                    width: `calc(${100 / position.total}% - 4px)`,
                                                }}
                                                title={`${patient} · ${appointment.service || 'Appointment'}`}
                                            >
                                                <span className="block text-[11px] font-semibold">
                                                    {formatTime(appointment.starts_at, timezone)}
                                                    {position.height >= 48 ? `–${formatTime(appointment.ends_at, timezone)}` : ''}
                                                </span>
                                                <span className={`block truncate font-medium ${status === 'cancelled' ? 'line-through opacity-70' : ''}`}>
                                                    {patient}
                                                </span>
                                                {position.height >= 58 && (
                                                    <span className="block truncate text-[11px] opacity-80">
                                                        {appointment.service || appointment.location || ''}
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}

                                    {day === todayKey && nowVisible && (
                                        <div
                                            className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                                            style={{ top: nowTop }}
                                        >
                                            <span className="absolute -left-1 -top-1.5 h-2.5 w-2.5 rounded-full bg-red-500" />
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {!loading && visibleAppointments.length === 0 && (
                <div className="border-t border-gray-200 px-4 py-4 text-center text-sm text-gray-500">
                    No appointments in this range. Add availability rules or import a CSV export.
                </div>
            )}

            <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 px-4 py-2">
                {APPOINTMENT_STATUSES.map((status) => (
                    <span key={status} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOTS[status]}`} />
                        {STATUS_LABELS[status]}
                    </span>
                ))}
            </div>
        </div>
    )
}
