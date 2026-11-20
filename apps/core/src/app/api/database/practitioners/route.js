import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('practitioners')

export const GET = handlers.GET
export const POST = handlers.POST
