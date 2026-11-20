import { enqueueReportJob } from '@practice-manager/jobs/enqueue'
import { createQueueRoute } from '@/lib/routeHandlers'

export const POST = createQueueRoute({
  enqueue: enqueueReportJob,
  fallbackMessage: 'Failed to enqueue report job',
})
