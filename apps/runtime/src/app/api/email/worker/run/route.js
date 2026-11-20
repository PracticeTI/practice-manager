import { createWorkerRunRoute } from '@/lib/routeHandlers'

const handlers = createWorkerRunRoute({
  worker: 'email',
  label: 'email',
  fallbackMessage: 'Email worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
