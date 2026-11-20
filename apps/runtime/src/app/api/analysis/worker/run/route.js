import { createWorkerRunRoute } from '@/lib/routeHandlers'

const handlers = createWorkerRunRoute({
  worker: 'analysis',
  label: 'analysis',
  fallbackMessage: 'Analysis worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
