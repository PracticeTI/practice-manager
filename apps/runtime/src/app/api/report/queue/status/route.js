import { getReportJobStatus } from '@practice-manager/jobs/read'
import { createStatusRoute } from '@/lib/routeHandlers'

export const GET = createStatusRoute({
  read: getReportJobStatus,
  fallbackMessage: 'Failed to load report queue status',
})
