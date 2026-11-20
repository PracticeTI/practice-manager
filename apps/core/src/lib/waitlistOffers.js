// Send a waitlist offer to a participant. Email goes through the shared queue;
// SMS goes directly through Twilio when configured.

import { queueEmail } from '@/lib/emailQueueClient'
import { isSmsConfigured, sendSms } from '@/lib/smsClient'
import {
    buildWaitlistActionUrls,
    buildWaitlistOfferMessage,
    resolvePatientContact,
} from '@/lib/appointmentMessaging'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { resolvePublicOrigin, resolveSchedulingSecret } from '@/lib/appointmentReminders'

export async function sendWaitlistOffer(connection, {
    offer,
    entry,
    slot,
    origin = '',
    now = new Date(),
} = {}) {
    const secret = resolveSchedulingSecret()
    if (!secret) {
        return { success: false, skipped: true, reason: 'signing_secret_not_configured' }
    }

    const contact = resolvePatientContact(entry?.patient_metadata || entry?.metadata)
    const practiceName = await readDomainPracticeName(offer.domain).catch(() => 'Practice')
    const urls = buildWaitlistActionUrls({
        origin: resolvePublicOrigin(origin),
        domain: offer.domain,
        offerId: offer.id,
        secret,
        expiresAt: offer.expires_at,
    })
    const message = buildWaitlistOfferMessage({
        entry,
        slot,
        practiceName,
        urls,
    })

    if (contact.email) {
        const queued = await queueEmail(connection, {
            toEmail: contact.email,
            category: 'waitlist-offer',
            subject: message.subject,
            text: message.text,
            html: message.html,
            payload: {
                domain: offer.domain,
                waitlistEntryId: offer.waitlist_entry_id,
                offerId: offer.id,
                kind: 'waitlist-offer',
            },
        })
        await connection.query(
            `UPDATE waitlist_offers
             SET status = 'sent', channel = 'email', sent_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [offer.id]
        )
        return { success: true, channel: 'email', ...queued }
    }

    if (contact.phone && isSmsConfigured()) {
        const sent = await sendSms({
            to: contact.phone,
            body: `${message.text.split('\n').filter(Boolean).slice(0, 6).join(' ')} ${urls.accept}`,
        })
        if (sent.success) {
            await connection.query(
                `UPDATE waitlist_offers
                 SET status = 'sent', channel = 'sms', sent_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [offer.id]
            )
            return {
                success: true,
                channel: 'sms',
                provider: sent.provider,
                providerMessageId: sent.providerMessageId || null,
            }
        }
        return { success: false, channel: 'sms', reason: sent.error || 'sms_failed' }
    }

    if (contact.phone && !isSmsConfigured()) {
        return { success: false, skipped: true, reason: 'sms_not_configured' }
    }

    return { success: false, skipped: true, reason: 'no_contact_details' }
}
