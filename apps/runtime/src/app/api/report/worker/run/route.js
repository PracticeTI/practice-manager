import { createWorkerRunRoute } from '@/lib/routeHandlers'

const handlers = createWorkerRunRoute({
  worker: 'report',
  label: 'report',
  fallbackMessage: 'Report worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
