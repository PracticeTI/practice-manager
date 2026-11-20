function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value, maxLength = 160) {
    const normalized = normalizeText(value)
    if (!normalized) return ''
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function sentenceCase(value) {
    const normalized = normalizeText(value)
    if (!normalized) return ''
    return `${normalized[0].toUpperCase()}${normalized.slice(1)}`
}

function toTitleCase(value) {
    const normalized = normalizeText(value)
    if (!normalized) return ''
    return normalized
        .split(' ')
        .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
        .join(' ')
}

function firstNonEmpty(...values) {
    for (const candidate of values) {
        const normalized = normalizeText(candidate)
        if (normalized) return normalized
    }
    return ''
}

function getLatestUserMessage(messages = []) {
    return [...messages]
        .reverse()
        .find((message) => normalizeText(message?.role).toLowerCase() === 'user')
}

function isSkippableValue(value) {
    const normalized = normalizeText(value).toLowerCase()
    return !normalized || normalized === '(skip)' || normalized === 'skip' || normalized === 'none' || normalized === 'n/a'
}

function inferTranscriptFields(messages = []) {
    const inferred = {
        name: '',
        email: '',
        company: '',
        phone: '',
        subject: '',
        message: '',
    }

    for (let index = 1; index < messages.length; index += 1) {
        const current = messages[index]
        const previous = messages[index - 1]
        const role = normalizeText(current?.role).toLowerCase()
        const previousRole = normalizeText(previous?.role).toLowerCase()

        if (role !== 'user' || previousRole !== 'assistant') continue

        const answer = normalizeText(current?.content)
        if (isSkippableValue(answer)) continue

        const prompt = normalizeText(previous?.content).toLowerCase()
        if (!prompt) continue

        if (!inferred.name && /what'?s your name|your name/.test(prompt)) {
            inferred.name = answer
            continue
        }

        if (!inferred.email && /email/.test(prompt)) {
            inferred.email = answer
            continue
        }

        if (!inferred.company && /company|organization|business/.test(prompt)) {
            inferred.company = answer
            continue
        }

        if (!inferred.phone && /phone|number|call you/.test(prompt)) {
            inferred.phone = answer
            continue
        }

        if (!inferred.subject && /subject/.test(prompt)) {
            inferred.subject = answer
            continue
        }

        if (!inferred.message && /what would you like to say|message|tell me more|how can i help/.test(prompt)) {
            inferred.message = answer
        }
    }

    return inferred
}

function summarizeChatIntent({ subject, message, latestUserContent, role }) {
    const combined = [subject, message, latestUserContent]
        .map((value) => normalizeText(value).toLowerCase())
        .filter(Boolean)
        .join(' ')

    if (/\b(call\s?back|call me|phone me|ring me|give me a call)\b/.test(combined)) {
        return 'requested a call back'
    }

    if (/\b(book|booking|appointment|schedule|consult)\b/.test(combined)) {
        return 'asked to book an appointment'
    }

    if (/\b(quote|pricing|price|cost|estimate|proposal)\b/.test(combined)) {
        return 'asked about pricing'
    }

    if (/\b(help|support|advice|guidance|question)\b/.test(combined)) {
        return 'asked for help'
    }

    if (subject) {
        return `asked about ${truncateText(subject, 48)}`
    }

    if (latestUserContent) {
        return `said: "${truncateText(latestUserContent, 56)}"`
    }

    const normalizedRole = normalizeText(role) || 'contact'
    return `started a ${normalizedRole.toLowerCase()} chat`
}

function buildEditorialSummary({ subject, message, latestUserContent, intent }) {
    const normalizedSubject = normalizeText(subject)
    const normalizedMessage = normalizeText(message || latestUserContent)
    const normalizedIntent = normalizeText(intent)

    if (normalizedSubject && normalizedMessage) {
        return `${normalizedSubject}: ${normalizedMessage}`
    }

    if (normalizedSubject) {
        return sentenceCase(`subject: ${normalizedSubject}`)
    }

    if (normalizedIntent === 'requested a call back') {
        return 'Requested a callback.'
    }

    if (normalizedIntent === 'asked to book an appointment') {
        return 'Requested an appointment.'
    }

    if (normalizedIntent === 'asked about pricing') {
        return 'Asked about pricing.'
    }

    if (normalizedIntent === 'asked for help') {
        return 'Asked for help.'
    }

    if (normalizedMessage) {
        return normalizedMessage
    }

    return sentenceCase(normalizedIntent)
}

export function buildChatPresentation({ role = 'Contact', metadata = {}, messages = [] } = {}) {
    const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {}
    const normalizedMessages = Array.isArray(messages) ? messages : []
    const latestUserMessage = getLatestUserMessage(normalizedMessages)
    const latestUserContent = normalizeText(latestUserMessage?.content)
    const inferredTranscriptFields = inferTranscriptFields(normalizedMessages)

    const fromName = firstNonEmpty(
        normalizedMetadata?.contactName,
        normalizedMetadata?.name,
        normalizedMetadata?.fullName,
        normalizedMetadata?.senderName,
        inferredTranscriptFields.name
    )

    const fromOrganization = firstNonEmpty(
        normalizedMetadata?.company,
        normalizedMetadata?.organization,
        normalizedMetadata?.businessName,
        normalizedMetadata?.companyName,
        inferredTranscriptFields.company
    )

    const fromEmail = firstNonEmpty(
        normalizedMetadata?.contactEmail,
        normalizedMetadata?.email,
        normalizedMetadata?.fromEmail,
        normalizedMetadata?.senderEmail,
        inferredTranscriptFields.email
    )

    const fromPhone = firstNonEmpty(
        normalizedMetadata?.phone,
        normalizedMetadata?.contactPhone,
        normalizedMetadata?.senderPhone,
        inferredTranscriptFields.phone
    )

    const from = firstNonEmpty(fromName, fromEmail, fromPhone, normalizedMetadata?.source) || 'Unknown'
    const subject = firstNonEmpty(normalizedMetadata?.subject, normalizedMetadata?.topic, inferredTranscriptFields.subject)
    const message = firstNonEmpty(normalizedMetadata?.message, normalizedMetadata?.summary, inferredTranscriptFields.message)
    const intent = summarizeChatIntent({ subject, message, latestUserContent, role })

    const actorLabel = fromName
        ? `${fromName}${fromOrganization ? ` from ${fromOrganization}` : ''}`
        : fromOrganization
            ? fromOrganization
            : from

    const title = truncateText(`${actorLabel} ${intent}`, 120)
    const detailSnippet = truncateText(message || latestUserContent, 180)
    const editorialSummary = buildEditorialSummary({
        subject,
        message,
        latestUserContent,
        intent,
    })
    const summary = editorialSummary || `${toTitleCase(role)} chat with ${actorLabel}`

    return {
        from,
        title: title || `${toTitleCase(role)} chat`,
        summary: truncateText(summary, 220),
        preview: truncateText(detailSnippet || summary, 160),
    }
}