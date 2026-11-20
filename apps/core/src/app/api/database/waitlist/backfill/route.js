import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { rankWaitlistEntries, buildWaitlistActionToken } from '@/lib/appointmentMessaging'
import { findInvalidDomainReferences } from '@/lib/schedulingReferences'
import { loadAppointmentForMessaging, resolveSchedulingSecret } from '@/lib/appointmentReminders'
import { sendWaitlistOffer } from '@/lib/waitlistOffers'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toIso(value) {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function resolveOrigin(request) {
    const url = new URL(request.url)
    const host = request.headers.get('x-forwarded-host')
        || request.headers.get('host')
        || url.host
    const protocol = request.headers.get('x-forwarded-proto')
        || url.protocol.replace(':', '')
        || 'http'
    return `${protocol}://${host}`
}

/**
 * POST /api/database/waitlist/backfill
 *
 * Body:
 *   { appointment_id }                      offer a cancelled appointment's slot
 *   or { practitioner_id, service_id, location_id, starts_at, ends_at }
 *
 * Creates an expiring offer for the best-matching waiting entries and sends the
 * offer by email/SMS. The slot is re-checked when the participant accepts.
 */
export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    const payload = await request.json().catch(() => ({}))
    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain') || payload?.domain)
    if (context?.error) return jsonError(context.error, context.status)
    const domain = context.domain

    if (!resolveSchedulingSecret()) {
        return jsonError('SCHEDULING_CONFIRMATION_SECRET or JWT_SECRET must be configured', 503)
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const appointmentId = parsePositiveInt(payload?.appointment_id)
        let slot = null

        if (appointmentId) {
            const appointment = await loadAppointmentForMessaging(connection, { domain, appointmentId })
            if (!appointment) return jsonError('Appointment not found', 404)
            if (appointment.appointment_status !== 'cancelled') {
                return jsonError('Only cancelled appointments can be offered to the waitlist', 409)
            }
            slot = {
                appointment_id: appointment.id,
                practitioner_id: appointment.practitioner_id,
                service_id: appointment.service_id,
                location_id: appointment.location_id ?? null,
                starts_at: toIso(appointment.starts_at),
                ends_at: toIso(appointment.ends_at),
                service: appointment.service || '',
                location: appointment.location || '',
                practitioner: appointment.practitioner || '',
                timezone: appointment.timezone || 'Australia/Sydney',
            }
        } else {
            const practitionerId = parsePositiveInt(payload?.practitioner_id)
            const serviceId = parsePositiveInt(payload?.service_id)
            const locationId = parsePositiveInt(payload?.location_id)
            const startsAt = toIso(payload?.starts_at)
            const endsAt = toIso(payload?.ends_at)

            if (!practitionerId) return jsonError('practitioner_id or appointment_id is required')
            if (!startsAt || !endsAt) return jsonError('starts_at and ends_at are required')
            if (new Date(endsAt) <= new Date(startsAt)) return jsonError('ends_at must be after starts_at')
            if (new Date(startsAt) <= new Date()) return jsonError('The slot must be in the future')

            const referenceErrors = await findInvalidDomainReferences(connection, domain, {
                practitioner_id: practitionerId,
                service_id: serviceId,
                location_id: locationId,
            })
            if (referenceErrors.length > 0) return jsonError(referenceErrors[0])

            slot = {
                appointment_id: null,
                practitioner_id: practitionerId,
                service_id: serviceId,
                location_id: locationId,
                starts_at: startsAt,
                ends_at: endsAt,
                service: String(payload?.service || '').trim(),
                location: String(payload?.location || '').trim(),
                practitioner: String(payload?.practitioner || '').trim(),
                timezone: String(payload?.timezone || 'Australia/Sydney').trim(),
            }
        }

        if (!slot.starts_at || !slot.ends_at) {
            return jsonError('The slot is missing its start or end time')
        }

        const entries = await connection.query(
            `SELECT w.*, p.metadata AS patient_metadata
             FROM waitlist_entries w
             LEFT JOIN patients p ON p.id = w.patient_id AND p.domain = w.domain
             WHERE w.domain = $1 AND w.status = 'waiting'
             ORDER BY w.priority DESC, w.earliest_date ASC NULLS LAST, w.id ASC`,
            [domain]
        )

        const ranked = rankWaitlistEntries(entries.rows || [], slot)
        if (ranked.length === 0) {
            return NextResponse.json({
                success: true,
                data: { offered: 0, reason: 'no_matching_waitlist_entries', slot },
            })
        }

        const requestedLimit = Number.parseInt(String(payload?.limit || '1'), 10)
        const limit = Math.min(5, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 1))
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        const origin = resolveOrigin(request)
        const results = []

        for (const { entry } of ranked.slice(0, limit)) {
            const temporaryToken = crypto.randomUUID()
            const inserted = await connection.query(
                `INSERT INTO waitlist_offers
                    (domain, waitlist_entry_id, appointment_id, token, status,
                     starts_at, ends_at, practitioner_id, service_id, location_id,
                     expires_at, metadata)
                 VALUES ($1, $2, $3, $4, 'offered', $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [
                    domain,
                    entry.id,
                    slot.appointment_id,
                    temporaryToken,
                    slot.starts_at,
                    slot.ends_at,
                    slot.practitioner_id,
                    slot.service_id,
                    slot.location_id,
                    expiresAt,
                    JSON.stringify({
                        service: slot.service,
                        location: slot.location,
                        practitioner: slot.practitioner,
                        timezone: slot.timezone,
                    }),
                ]
            )
            const offer = inserted.rows?.[0]
            if (!offer) continue

            const acceptToken = buildWaitlistActionToken({
                domain,
                offerId: offer.id,
                action: 'accept',
                expiresAt,
                secret: resolveSchedulingSecret(),
            })
            await connection.query(
                'UPDATE waitlist_offers SET token = $1 WHERE id = $2',
                [acceptToken, offer.id]
            )

            const sendResult = await sendWaitlistOffer(connection, {
                offer,
                entry,
                slot,
                origin,
            })

            if (sendResult.success) {
                await connection.query(
                    `UPDATE waitlist_entries
                     SET status = 'offered', updated_at = NOW()
                     WHERE id = $1 AND domain = $2`,
                    [entry.id, domain]
                )
            } else {
                await connection.query(
                    `UPDATE waitlist_offers
                     SET status = $2, updated_at = NOW()
                     WHERE id = $1`,
                    [offer.id, sendResult.skipped ? 'skipped' : 'failed']
                )
            }

            results.push({
                offerId: offer.id,
                waitlistEntryId: entry.id,
                patientName: entry.patient_name,
                send: sendResult,
            })
        }

        return NextResponse.json({
            success: true,
            data: {
                offered: results.filter((item) => item.send?.success).length,
                slot,
                results,
            },
        })
    } catch (error) {
        return jsonError(error?.message || 'Failed to backfill the waitlist', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
