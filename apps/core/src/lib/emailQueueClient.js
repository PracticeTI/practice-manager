// Queue an email through the domain backend, falling back to the shared
// outbound_messages table when the backend is unreachable. This is the same
// pattern used by admin notifications and keeps reminder/waitlist mail on the
// existing delivery path.

import { enqueueOutboundEmail } from '@/lib/serviceClient'
import { insertOutboundMessageRow } from '@/lib/outboundMessageQueue'

/**
 * @returns {Promise<{provider: string, providerMessageId: string|null}>}
 */
export async function queueEmail(connection, message) {
    try {
        const upstream = await enqueueOutboundEmail(message)
        if (upstream?.success) {
            return {
                provider: 'domain-backend',
                providerMessageId: upstream.id ? String(upstream.id) : null,
            }
        }
    } catch {
        // Fall through to the local queue.
    }

    const id = await insertOutboundMessageRow(connection, message)
    return {
        provider: 'local-queue',
        providerMessageId: id ? String(id) : null,
    }
}
