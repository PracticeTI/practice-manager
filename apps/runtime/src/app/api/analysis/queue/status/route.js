import { getAnalysisJobStatus } from '@practice-manager/jobs/read'
import { createStatusRoute } from '@/lib/routeHandlers'

export const GET = createStatusRoute({
  read: getAnalysisJobStatus,
  fallbackMessage: 'Failed to load analysis queue status',
})
