import { enqueueBillingJob } from '@practice-manager/jobs/enqueue'
import { createQueueRoute } from '@/lib/routeHandlers'

export const POST = createQueueRoute({
  enqueue: enqueueBillingJob,
  fallbackMessage: 'Failed to enqueue billing job',
})
