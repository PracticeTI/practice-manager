import { enqueueScribeJob } from '@practice-manager/jobs/enqueue'
import { createQueueRoute } from '@/lib/routeHandlers'

export const POST = createQueueRoute({
  enqueue: enqueueScribeJob,
  fallbackMessage: 'Failed to enqueue Transcript Summarizer job',
})
