// SMS delivery for appointment reminders and waitlist offers.
//
// Twilio is the only Phase 2 provider. When it is not configured the caller
// records the message as skipped instead of failing the whole reminder run.

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function getSmsProvider() {
    return cleanText(process.env.SMS_PROVIDER || 'twilio').toLowerCase()
}

export function isSmsConfigured() {
    if (getSmsProvider() !== 'twilio') return false
    return Boolean(
        cleanText(process.env.TWILIO_ACCOUNT_SID)
        && cleanText(process.env.TWILIO_AUTH_TOKEN)
        && cleanText(process.env.TWILIO_FROM_NUMBER)
    )
}

/**
 * Send one SMS.
 *
 * @returns {Promise<{success: boolean, provider?: string, providerMessageId?: string|null, error?: string}>}
 */
export async function sendSms({ to, body } = {}) {
    const recipient = cleanText(to)
    const message = cleanText(body)
    if (!recipient || !message) {
        return { success: false, error: 'SMS recipient and body are required' }
    }
    if (getSmsProvider() !== 'twilio') {
        return { success: false, error: `Unsupported SMS provider: ${getSmsProvider()}` }
    }
    if (!isSmsConfigured()) {
        return { success: false, error: 'not_configured' }
    }

    const accountSid = cleanText(process.env.TWILIO_ACCOUNT_SID)
    const authToken = cleanText(process.env.TWILIO_AUTH_TOKEN)
    const from = cleanText(process.env.TWILIO_FROM_NUMBER)
    const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

    try {
        const response = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${authorization}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    To: recipient,
                    From: from,
                    Body: message,
                }),
            }
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            return {
                success: false,
                provider: 'twilio',
                error: data?.message || `SMS provider returned ${response.status}`,
            }
        }
        return {
            success: true,
            provider: 'twilio',
            providerMessageId: data?.sid || null,
        }
    } catch (error) {
        return {
            success: false,
            provider: 'twilio',
            error: error?.message || 'SMS provider request failed',
        }
    }
}
