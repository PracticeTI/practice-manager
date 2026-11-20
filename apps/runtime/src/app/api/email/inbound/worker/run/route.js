import { createWorkerRunRoute } from '@/lib/routeHandlers'

// The inbound worker decides for itself whether its own flag and the outbound email flag
// enable it, so a trigger runs one cycle of whatever that configuration resolves to.
const handlers = createWorkerRunRoute({
  worker: 'inboundEmail',
  label: 'inbound-email',
  forceRun: false,
  fallbackMessage: 'Inbound email worker cycle failed',
})

export const GET = handlers.GET
export const POST = handlers.POST
