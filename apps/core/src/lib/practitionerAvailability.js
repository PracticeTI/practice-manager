// Availability engine for the native scheduling layer.
//
// Pure and browser-safe: the API route, the calendar UI and the tests all use
// the same slot generation. Times are stored as UTC instants; availability
// rules are wall-clock times in the practitioner's timezone, so the conversion
// below has to survive daylight-saving boundaries.
//
// Travel time is represented by the service's before/after buffers in Phase 1.
// Drive-time routing between visits is a later phase; the buffer contract stays
// the same when it lands.

import { DEFAULT_TIMEZONE, normalizeAppointmentStatus } from './scheduling.js'

export const DEFAULT_AVAILABILITY_TIMEZONE = DEFAULT_TIMEZONE
export const DEFAULT_SLOT_INTERVAL_MINUTES = 15
export const DEFAULT_MIN_NOTICE_MINUTES = 0
export const DEFAULT_MAX_ADVANCE_DAYS = 365
export const MAX_AVAILABILITY_DAYS = 62

const MINUTE_MS = 60000
const DAY_MS = 86400000

// Completed appointments still occupy the calendar, so they block new slots.
// Cancelled and no-show rows do not.
const BUSY_STATUSES = new Set(['tentative', 'confirmed', 'arrived', 'completed'])

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function toEpochMs(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.getTime()
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.getTime()
}

export function getTimeZoneOffsetMs(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
    const parts = formatter.formatToParts(date)
    const values = {}
    parts.forEach((part) => {
        if (part.type !== 'literal') values[part.type] = part.value
    })
    const asUtc = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour) % 24,
        Number(values.minute),
        Number(values.second)
    )
    return asUtc - date.getTime()
}

/**
 * Convert a wall-clock date/time in `timeZone` to a UTC epoch millisecond.
 * Two passes handle the offset change at a DST boundary.
 */
export function zonedDateTimeToUtc(dateString, timeString, timeZone) {
    const [year, month, day] = String(dateString).split('-').map(Number)
    const [hour, minute] = String(timeString).split(':').map(Number)
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)

    const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone)
    let result = utcGuess - firstOffset
    const secondOffset = getTimeZoneOffsetMs(new Date(result), timeZone)
    if (secondOffset !== firstOffset) {
        result = utcGuess - secondOffset
    }
    return result
}

export function getZonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
    const values = {}
    formatter.formatToParts(date).forEach((part) => {
        if (part.type !== 'literal') values[part.type] = part.value
    })
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour) % 24,
        minute: Number(values.minute),
        date: `${values.year}-${values.month}-${values.day}`,
    }
}

export function formatDateInTimeZone(date, timeZone) {
    return getZonedParts(date, timeZone).date
}

export function addDaysToDateString(dateString, days) {
    const date = new Date(`${dateString}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + Number(days || 0))
    return date.toISOString().slice(0, 10)
}

export function weekdayForDateString(dateString) {
    return new Date(`${dateString}T00:00:00Z`).getUTCDay()
}

export function timeToMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cleanText(value))
    if (!match) return null
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours > 23 || minutes > 59) return null
    return hours * 60 + minutes
}

/**
 * Parse a query bound. A bare `YYYY-MM-DD` is interpreted as a wall-clock date
 * in the practitioner's timezone; anything else must be an ISO timestamp.
 */
export function parseAvailabilityRangeBound(value, timeZone, { endOfDay = false } = {}) {
    const text = cleanText(value)
    if (!text) return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        if (endOfDay) {
            const nextDay = addDaysToDateString(text, 1)
            return zonedDateTimeToUtc(nextDay, '00:00', timeZone) - 1
        }
        return zonedDateTimeToUtc(text, '00:00', timeZone)
    }

    return toEpochMs(text)
}

export function enumerateDateStrings(startDate, endDate, maxDays = MAX_AVAILABILITY_DAYS) {
    const dates = []
    let cursor = startDate
    let truncated = false

    while (cursor <= endDate) {
        if (dates.length >= maxDays) {
            truncated = true
            break
        }
        dates.push(cursor)
        cursor = addDaysToDateString(cursor, 1)
    }

    return { dates, truncated }
}

function withinValidity(rule, dateString) {
    const validFrom = cleanText(rule?.valid_from).slice(0, 10)
    const validTo = cleanText(rule?.valid_to).slice(0, 10)
    if (validFrom && dateString < validFrom) return false
    if (validTo && dateString > validTo) return false
    return true
}

function ruleMatches(rule, { weekday, dateString, serviceId, locationId }) {
    if (!rule || rule.active === false) return false
    if (Number(rule.weekday) !== weekday) return false
    if (!withinValidity(rule, dateString)) return false

    const ruleLocation = rule.location_id === null || rule.location_id === undefined
        ? null
        : Number(rule.location_id)
    if (locationId && ruleLocation !== null && ruleLocation !== Number(locationId)) return false

    const ruleService = rule.service_id === null || rule.service_id === undefined
        ? null
        : Number(rule.service_id)
    if (serviceId && ruleService !== null && ruleService !== Number(serviceId)) return false

    return true
}

function subtractInterval(windows, block) {
    const next = []
    for (const window of windows) {
        if (block.end <= window.start || block.start >= window.end) {
            next.push(window)
            continue
        }
        if (block.start > window.start) {
            next.push({ start: window.start, end: Math.min(block.start, window.end) })
        }
        if (block.end < window.end) {
            next.push({ start: Math.max(block.end, window.start), end: window.end })
        }
    }
    return next
}

function overlaps(a, b) {
    return a.start < b.end && b.start < a.end
}

/**
 * Build the blocked intervals for a practitioner.
 *
 * Appointments are padded by the buffers of the service they belong to, so a
 * 60-minute session with a 15-minute travel buffer blocks 75 minutes.
 */
export function buildBusyIntervals(appointments = [], servicesById = {}) {
    const intervals = []

    for (const appointment of appointments || []) {
        if (appointment?.archived) continue

        const start = toEpochMs(appointment?.starts_at)
        const end = toEpochMs(appointment?.ends_at)
        if (start === null || end === null || end <= start) continue

        const isBusyBlock = appointment.unavailable_block === true
        if (!isBusyBlock) {
            const status = normalizeAppointmentStatus(appointment.appointment_status)
            if (!status || !BUSY_STATUSES.has(status)) continue
        }

        const service = appointment.service_id ? servicesById[appointment.service_id] : null
        const bufferBefore = isBusyBlock ? 0 : Math.max(0, Number(service?.buffer_before_minutes) || 0)
        const bufferAfter = isBusyBlock ? 0 : Math.max(0, Number(service?.buffer_after_minutes) || 0)

        intervals.push({
            start: start - bufferBefore * MINUTE_MS,
            end: end + bufferAfter * MINUTE_MS,
        })
    }

    return intervals.sort((a, b) => a.start - b.start)
}

/**
 * Generate bookable slots.
 *
 * @returns {{
 *   slots: Array<{start: string, end: string, practitioner_id: number|null,
 *     service_id: number|null, timezone: string}>,
 *   timezone: string, from: string|null, to: string|null, truncated: boolean
 * }}
 */
export function generateAvailability({
    practitionerId = null,
    service = null,
    locationId = null,
    rules = [],
    exceptions = [],
    appointments = [],
    servicesById = {},
    timezone = DEFAULT_AVAILABILITY_TIMEZONE,
    from = null,
    to = null,
    intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTES,
    minNoticeMinutes = DEFAULT_MIN_NOTICE_MINUTES,
    maxAdvanceDays = DEFAULT_MAX_ADVANCE_DAYS,
    limit = 500,
    now = new Date(),
} = {}) {
    const serviceId = service?.id === null || service?.id === undefined ? null : Number(service.id)
    const durationMinutes = Math.max(1, Number(service?.duration_minutes) || 60)
    const bufferBefore = Math.max(0, Number(service?.buffer_before_minutes) || 0)
    const bufferAfter = Math.max(0, Number(service?.buffer_after_minutes) || 0)
    const interval = Math.max(5, Math.min(120, Number(intervalMinutes) || DEFAULT_SLOT_INTERVAL_MINUTES))
    const maxSlots = Math.max(1, Math.min(2000, Number(limit) || 500))

    const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now()
    const noticeMs = Math.max(0, Number(minNoticeMinutes) || 0) * MINUTE_MS
    const earliestMs = nowMs + noticeMs

    const rangeStart = parseAvailabilityRangeBound(from, timezone, { endOfDay: false })
        ?? nowMs
    const defaultRangeEnd = rangeStart + 14 * DAY_MS
    const requestedEnd = parseAvailabilityRangeBound(to, timezone, { endOfDay: true })
        ?? defaultRangeEnd
    const maxAdvanceMs = nowMs + Math.max(1, Number(maxAdvanceDays) || DEFAULT_MAX_ADVANCE_DAYS) * DAY_MS
    const rangeEnd = Math.min(requestedEnd, maxAdvanceMs)

    if (rangeEnd <= rangeStart) {
        return {
            slots: [],
            timezone,
            from: new Date(rangeStart).toISOString(),
            to: new Date(rangeEnd).toISOString(),
            truncated: false,
        }
    }

    const startDate = formatDateInTimeZone(new Date(rangeStart), timezone)
    const endDate = formatDateInTimeZone(new Date(rangeEnd), timezone)
    const { dates, truncated } = enumerateDateStrings(startDate, endDate)

    const busyIntervals = buildBusyIntervals(appointments, servicesById)
    const exceptionBlocks = (exceptions || [])
        .map((exception) => {
            const start = toEpochMs(exception?.starts_at)
            const end = toEpochMs(exception?.ends_at)
            if (start === null || end === null || end <= start) return null
            return {
                start,
                end,
                extra: String(exception?.exception_type || '').toLowerCase() === 'extra',
            }
        })
        .filter(Boolean)

    const slots = []
    const seen = new Set()

    for (const dateString of dates) {
        const weekday = weekdayForDateString(dateString)
        const matchingRules = rules.filter((rule) => ruleMatches(rule, {
            weekday,
            dateString,
            serviceId,
            locationId,
        }))

        const dayStart = zonedDateTimeToUtc(dateString, '00:00', timezone)
        const dayEnd = zonedDateTimeToUtc(addDaysToDateString(dateString, 1), '00:00', timezone)

        let windows = matchingRules.map((rule) => ({
            start: zonedDateTimeToUtc(dateString, rule.start_time, timezone),
            end: zonedDateTimeToUtc(dateString, rule.end_time, timezone),
        }))

        const dayExceptions = exceptionBlocks.filter(
            (block) => block.start < dayEnd && block.end > dayStart
        )
        for (const block of dayExceptions) {
            if (block.extra) {
                windows.push({ start: block.start, end: block.end })
            } else {
                windows = subtractInterval(windows, block)
            }
        }

        const dayBusy = busyIntervals.filter(
            (block) => block.end > dayStart && block.start < dayEnd
        )
        for (const block of dayBusy) {
            windows = subtractInterval(windows, block)
        }

        for (const window of windows) {
            if (window.end <= window.start) continue

            const durationMs = durationMinutes * MINUTE_MS
            const beforeMs = bufferBefore * MINUTE_MS
            const afterMs = bufferAfter * MINUTE_MS
            const stepMs = interval * MINUTE_MS

            // Align slot starts to the local-day grid so slots land on clean
            // wall-clock boundaries in every practice timezone, including
            // half-hour offsets and DST days.
            const localDayAnchor = zonedDateTimeToUtc(dateString, '00:00', timezone)
            let cursor = localDayAnchor
                + Math.ceil((window.start - localDayAnchor) / stepMs) * stepMs

            while (cursor + durationMs <= window.end) {
                const candidate = {
                    start: cursor,
                    end: cursor + durationMs,
                    paddedStart: cursor - beforeMs,
                    paddedEnd: cursor + durationMs + afterMs,
                }

                const fits = cursor >= earliestMs
                    && !dayBusy.some((block) => overlaps(
                        { start: candidate.paddedStart, end: candidate.paddedEnd },
                        block
                    ))

                if (fits && !seen.has(cursor)) {
                    seen.add(cursor)
                    slots.push({
                        start: new Date(candidate.start).toISOString(),
                        end: new Date(candidate.end).toISOString(),
                        practitioner_id: practitionerId,
                        service_id: serviceId,
                        timezone,
                    })
                    if (slots.length >= maxSlots) {
                        return {
                            slots: slots.sort((a, b) => a.start.localeCompare(b.start)),
                            timezone,
                            from: new Date(rangeStart).toISOString(),
                            to: new Date(rangeEnd).toISOString(),
                            truncated: true,
                        }
                    }
                }

                cursor += stepMs
            }
        }
    }

    return {
        slots: slots.sort((a, b) => a.start.localeCompare(b.start)),
        timezone,
        from: new Date(rangeStart).toISOString(),
        to: new Date(rangeEnd).toISOString(),
        truncated,
    }
}
