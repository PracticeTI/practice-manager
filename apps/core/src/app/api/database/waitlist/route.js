import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('waitlist')

export const GET = handlers.GET
export const POST = handlers.POST
