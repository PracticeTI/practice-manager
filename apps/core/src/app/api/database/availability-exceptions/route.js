import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('availability-exceptions')

export const GET = handlers.GET
export const POST = handlers.POST
