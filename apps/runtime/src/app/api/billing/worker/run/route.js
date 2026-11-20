import { createWorkerRunRoute } from '@/lib/routeHandlers'

const handlers = createWorkerRunRoute({
  worker: 'billing',
  label: 'billing',
  fallbackMessage: 'Billing worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
