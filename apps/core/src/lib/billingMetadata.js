export const BILLING_EVENT_TYPES = ['invoice', 'payment', 'refund', 'adjustment', 'note', 'other']

function toTrimmedString(value) {
    const text = String(value ?? '').trim()
    return text || null
}

function toAmount(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number.parseFloat(String(value))
    return Number.isFinite(number) ? number : null
}

function toIsoDate(value) {
    const text = String(value ?? '').trim()
    if (!text) return new Date().toISOString()

    const parsed = new Date(text)
    if (!Number.isFinite(parsed.getTime())) {
        return new Date().toISOString()
    }

    return parsed.toISOString()
}

export function normalizeBillingMetadata(input) {
    const metadata = input && typeof input === 'object' && !Array.isArray(input) ? input : {}

    const {
        event,
        event_type,
        invoice_id,
        payment_id,
        occurred_at,
        eventDate,
        event_date,
        description,
        ...rest
    } = metadata

    const rawEventType =
        toTrimmedString(metadata.eventType) ||
        toTrimmedString(event_type) ||
        toTrimmedString(event) ||
        'note'

    const eventType = BILLING_EVENT_TYPES.includes(rawEventType.toLowerCase())
        ? rawEventType.toLowerCase()
        : 'other'

    const amount = toAmount(metadata.amount)
    const currency = toTrimmedString(metadata.currency)?.toUpperCase() || (amount === null ? null : 'AUD')

    const normalized = {
        ...rest,
        eventType,
        invoiceId: toTrimmedString(metadata.invoiceId) || toTrimmedString(invoice_id),
        paymentId: toTrimmedString(metadata.paymentId) || toTrimmedString(payment_id),
        status: toTrimmedString(metadata.status)?.toLowerCase() || null,
        amount,
        currency,
        note: toTrimmedString(metadata.note) || toTrimmedString(description),
        occurredAt: toIsoDate(metadata.occurredAt || occurred_at || eventDate || event_date),
    }

    return normalized
}
