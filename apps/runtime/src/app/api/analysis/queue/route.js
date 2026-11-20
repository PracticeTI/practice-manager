import { enqueueAnalysisJob } from '@practice-manager/jobs/enqueue'
import { createQueueRoute } from '@/lib/routeHandlers'

export const POST = createQueueRoute({
  enqueue: enqueueAnalysisJob,
  fallbackMessage: 'Failed to enqueue analysis job',
})
