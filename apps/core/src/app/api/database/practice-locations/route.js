import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('practice-locations')

export const GET = handlers.GET
export const POST = handlers.POST
