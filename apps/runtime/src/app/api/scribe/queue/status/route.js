import { getScribeJobStatus } from '@practice-manager/jobs/read'
import { createStatusRoute } from '@/lib/routeHandlers'

export const GET = createStatusRoute({
  read: getScribeJobStatus,
  fallbackMessage: 'Failed to load Transcript Summarizer queue status',
})
