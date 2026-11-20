// Admin alert for a supplier answering an equipment quote request.
//
// The alert is queued as an outbound email (`equipment_quote_reply`), which is
// also the row the notification feed reads, so the content builders here stay
// pure: the inbound webhook sends what they build and the feed describes the
// queued payload with the same wording.
//
// The wording and the reply preview come from the matched sourcing item, so the
// email says exactly what the Sourcing page shows.

export const EQUIPMENT_QUOTE_REPLY_CATEGORY = 'equipment_quote_reply'

function toText(value) {
    return String(value || '').trim()
}

function toIsoString(value) {
    const time = new Date(value || '').getTime()
    return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * Sourcing items whose matched supplier reply is the inbound message that just
 * arrived. An item only ever matches one reply, so a repeated webhook delivery
 * sends no second alert.
 */
export function findEquipmentQuoteReplyMatches(items, inboundMessageId) {
    const id = toText(inboundMessageId)
    if (!id) return []

    return (Array.isArray(items) ? items : []).filter(
        (item) => toText(item?.response?.id) === id
    )
}

function buildReplyItems(matches) {
    return (Array.isArray(matches) ? matches : []).map((match) => ({
        patientId: match?.patientId ?? null,
        patientName: toText(match?.patientName) || null,
        itemName: toText(match?.name) || null,
        supplierName: toText(match?.supplierName) || null,
    }))
}

function supplierLabel(payload) {
    return toText(payload?.supplierName)
        || toText(payload?.supplierEmail)
        || 'a supplier'
}

function itemSummary(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : []
    const described = items
        .map((item) => [toText(item?.itemName), toText(item?.patientName)].filter(Boolean).join(' · '))
        .filter(Boolean)

    if (described.length === 0) return toText(payload?.replySubject)
    if (described.length === 1) return described[0]
    return `${described[0]} and ${described.length - 1} more`
}

/**
 * Title and one-line summary for a queued alert, shared by the email subject
 * and the notification feed row.
 */
export function describeEquipmentQuoteReplyAlert(payload) {
    return {
        title: `Quote reply from ${supplierLabel(payload)}`,
        summary: itemSummary(payload),
    }
}

/**
 * Everything the alert needs: the email body, plus the payload the feed reads
 * back. Returns null when there is nothing to alert about.
 */
export function buildEquipmentQuoteReplyAlert({
    domain = '',
    matches = [],
    senderEmail = '',
    replyToEmail = '',
    sourcingUrl = '',
    receivedAt = new Date().toISOString(),
} = {}) {
    const items = buildReplyItems(matches)
    if (items.length === 0) return null

    const reply = matches[0]?.response || {}
    const payload = {
        domain: toText(domain) || null,
        source: 'one:equipment-quote-reply-alert',
        supplierEmail: toText(reply.fromEmail) || null,
        supplierName: items[0]?.supplierName || null,
        replySubject: toText(reply.subject) || null,
        preview: toText(reply.preview) || null,
        inboundMessageId: reply.id ?? null,
        receivedAt: toIsoString(reply.receivedAt) || receivedAt,
        items,
        senderEmail: toText(senderEmail) || undefined,
        replyToEmail: toText(replyToEmail) || undefined,
    }

    const { title, summary } = describeEquipmentQuoteReplyAlert(payload)
    const subject = summary ? `${title} · ${summary}` : title

    const textLines = [
        `${title}.`,
        summary ? `Item: ${summary}` : '',
        payload.replySubject ? `Subject: ${payload.replySubject}` : '',
        payload.preview ? `\n"${payload.preview}"` : '',
        sourcingUrl ? `\nOpen Equipment sourcing to see the reply: ${sourcingUrl}` : '',
    ].filter(Boolean)

    const htmlLines = [
        `<p>${escapeHtml(title)}.</p>`,
        summary ? `<p><strong>Item:</strong> ${escapeHtml(summary)}</p>` : '',
        payload.replySubject ? `<p><strong>Subject:</strong> ${escapeHtml(payload.replySubject)}</p>` : '',
        payload.preview ? `<blockquote>${escapeHtml(payload.preview)}</blockquote>` : '',
        sourcingUrl
            ? `<p><a href="${escapeHtml(sourcingUrl)}">Open Equipment sourcing</a></p>`
            : '',
    ].filter(Boolean)

    return {
        title,
        summary,
        subject,
        text: textLines.join('\n'),
        html: htmlLines.join('\n'),
        payload,
    }
}
