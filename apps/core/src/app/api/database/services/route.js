import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('services')

export const GET = handlers.GET
export const POST = handlers.POST
