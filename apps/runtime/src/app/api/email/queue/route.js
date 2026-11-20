import { enqueueEmailMessage } from '@practice-manager/jobs/enqueue'
import { createQueueRoute } from '@/lib/routeHandlers'

export const POST = createQueueRoute({
  enqueue: enqueueEmailMessage,
  fallbackMessage: 'Failed to enqueue email',
})
