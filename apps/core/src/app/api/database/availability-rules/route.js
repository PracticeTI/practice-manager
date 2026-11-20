import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('availability-rules')

export const GET = handlers.GET
export const POST = handlers.POST
