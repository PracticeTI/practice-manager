import { getBillingJobStatus } from '@practice-manager/jobs/read'
import { createStatusRoute } from '@/lib/routeHandlers'

export const GET = createStatusRoute({
  read: getBillingJobStatus,
  fallbackMessage: 'Failed to load billing queue status',
})
