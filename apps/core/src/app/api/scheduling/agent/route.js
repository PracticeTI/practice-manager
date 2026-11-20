import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveDomainAiConfig } from '@/lib/domainAiConfig'
import { DOMAIN_AI_FEATURE_BOOKING_ASSISTANT } from '@/lib/domainAiFeatures'
import { requestOpenAiChatCompletion } from '@/lib/openaiClient'
import { formatDateInTimeZone } from '@/lib/practitionerAvailability'
import { loadAvailabilitySlots } from '@/lib/schedulingAvailability'
import {
    buildAgentSystemPrompt,
    formatBookingWindow,
    normalizeAgentIntent,
    parseAgentJson,
    parseAgentMessageFallback,
    sanitizeAgentHistory,
    selectAgentSlots,
} from '@/lib/publicBooking'
import {
    clientIp,
    consumeRateLimit,
    loadBookingCatalog,
    readBookingSettings,
    resolvePublicBookingDomain,
} from '@/lib/schedulingBooking'

const MAX_MESSAGE_LENGTH = 600
const MAX_PRACTITIONERS = 3

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

function buildReply({ modelReply, slots, service, practitionerName, fromDate, toDate, timeOfDay }) {
    if (modelReply) return modelReply
    if (slots.length === 0) {
        const window = timeOfDay === 'any' ? '' : `${timeOfDay} `
        return `I couldn't find ${window}times between ${fromDate} and ${toDate}. Try a wider date range or another appointment type.`
    }
    const who = practitionerName ? ` with ${practitionerName}` : ''
    return `I found ${slots.length} time${slots.length === 1 ? '' : 's'} for ${service.name}${who}. Pick one to continue.`
}

/**
 * POST /api/scheduling/agent
 *
 * Natural-language slot search. The model only extracts intent; every time it
 * offers comes from the same availability engine the calendar uses, so the
 * assistant can never invent an appointment.
 */
export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const domain = resolvePublicBookingDomain(request, payload?.domain)
        const message = String(payload?.message || '').trim().slice(0, MAX_MESSAGE_LENGTH)
        if (message.length < 2) return jsonError('Tell me what you are looking for')

        await ensureSchedulingTables()
        connection = await getDatabaseConnection()

        const limited = await consumeRateLimit(connection, {
            bucketKey: `agent:${domain}:${clientIp(request)}`,
            limit: 30,
            windowSeconds: 600,
        })
        if (!limited.allowed) {
            return jsonError('Too many assistant requests. Please try again shortly.', 429)
        }

        const settings = await readBookingSettings(domain)
        if (!settings.enabled) {
            return jsonError('Online booking is not available for this practice', 403)
        }

        const catalog = await loadBookingCatalog(connection, domain)
        if (catalog.services.length === 0) {
            return NextResponse.json({
                success: true,
                data: {
                    reply: 'Online booking is not open yet. Please call the practice and we will find a time for you.',
                    slots: [],
                    services: [],
                },
            })
        }

        const today = formatDateInTimeZone(new Date(), catalog.practitioners[0]?.timezone || 'Australia/Sydney')
        const context = {
            services: catalog.services,
            practitioners: catalog.practitioners,
            today,
            maxAdvanceDays: settings.maxAdvanceDays,
        }

        let rawIntent = null
        let modelReply = ''
        let usedModel = false

        const aiConfig = await resolveDomainAiConfig({
            domainKey: domain,
            feature: DOMAIN_AI_FEATURE_BOOKING_ASSISTANT,
        }).catch(() => null)
        if (aiConfig?.apiKey) {
            const prompt = buildAgentSystemPrompt({
                practiceName: catalog.practiceName,
                services: catalog.services,
                practitioners: catalog.practitioners,
                today,
                maxAdvanceDays: settings.maxAdvanceDays,
            })
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const completion = await requestOpenAiChatCompletion({
                provider: aiConfig.provider,
                model: aiConfig.model,
                baseUrl: aiConfig.baseUrl,
                apiKey: aiConfig.apiKey,
                messages: [
                    { role: 'system', content: prompt },
                    ...sanitizeAgentHistory(payload?.history),
                    { role: 'user', content: message },
                ],
                temperature: 0.2,
                maxOutputTokens: 400,
                signal: controller.signal,
            }).catch(() => null).finally(() => clearTimeout(timeout))

            if (completion?.ok) {
                const modelText = String(completion.text || '')
                rawIntent = parseAgentJson(modelText)
                usedModel = Boolean(rawIntent)
                if (usedModel) modelReply = String(rawIntent?.reply || '').trim().slice(0, 300)
            }
        }

        if (!rawIntent) {
            rawIntent = parseAgentMessageFallback(message, context)
        }

        const { intent, warnings } = normalizeAgentIntent(rawIntent, context)

        if (!intent.serviceId) {
            return NextResponse.json({
                success: true,
                data: {
                    reply: modelReply
                        || 'Which appointment type do you need? Tell me the service and roughly when, and I will find times.',
                    intent,
                    warnings,
                    used_model: usedModel,
                    services: catalog.services.map((service) => ({ id: service.id, name: service.name })),
                    slots: [],
                },
            })
        }

        const service = catalog.services.find((item) => Number(item.id) === intent.serviceId)
        const eligible = catalog.practitioners.filter((item) => item.service_ids.includes(service.id))
        const selected = intent.practitionerId
            ? eligible.filter((item) => item.id === intent.practitionerId)
            : eligible.slice(0, MAX_PRACTITIONERS)

        if (selected.length === 0) {
            return NextResponse.json({
                success: true,
                data: {
                    reply: `No one is available for ${service.name} just yet. Please call the practice and we will sort it out.`,
                    intent,
                    warnings,
                    used_model: usedModel,
                    service: { id: service.id, name: service.name },
                    slots: [],
                },
            })
        }

        const slots = []
        for (const practitioner of selected) {
            const { availability } = await loadAvailabilitySlots(connection, {
                domain,
                practitioner,
                service,
                from: intent.fromDate,
                to: intent.toDate,
                intervalMinutes: settings.slotIntervalMinutes,
                minNoticeMinutes: settings.minNoticeMinutes,
                maxAdvanceDays: settings.maxAdvanceDays,
                limit: 400,
                syncExternalCalendars: true,
            })

            ;(availability?.slots || []).forEach((slot) => {
                slots.push({
                    starts_at: slot.start,
                    ends_at: slot.end,
                    practitioner_id: practitioner.id,
                    practitioner_name: practitioner.display_name,
                    timezone: practitioner.timezone || 'Australia/Sydney',
                })
            })
        }

        slots.sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at))
        const timezone = selected[0].timezone || 'Australia/Sydney'
        const shortlist = selectAgentSlots(slots, {
            timeOfDay: intent.timeOfDay,
            timezone,
            limit: 6,
        }).map((slot) => ({
            ...slot,
            time_label: formatBookingWindow({
                startsAt: slot.starts_at,
                endsAt: slot.ends_at,
                timezone: slot.timezone,
            }),
        }))

        return NextResponse.json({
            success: true,
            data: {
                reply: buildReply({
                    modelReply,
                    slots: shortlist,
                    service,
                    practitionerName: intent.practitionerName,
                    fromDate: intent.fromDate,
                    toDate: intent.toDate,
                    timeOfDay: intent.timeOfDay,
                }),
                intent,
                warnings,
                used_model: usedModel,
                service: { id: service.id, name: service.name },
                practitioner: intent.practitionerId
                    ? { id: intent.practitionerId, display_name: intent.practitionerName }
                    : null,
                timezone,
                slots: shortlist,
            },
        })
    } catch (error) {
        return jsonError(error?.message || 'The booking assistant is unavailable', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
