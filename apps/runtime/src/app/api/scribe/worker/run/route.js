import { createWorkerRunRoute } from '@/lib/routeHandlers'

const handlers = createWorkerRunRoute({
  worker: 'scribe',
  label: 'scribe',
  fallbackMessage: 'Scribe worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
