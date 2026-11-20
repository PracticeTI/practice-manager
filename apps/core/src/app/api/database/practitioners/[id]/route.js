import { createSchedulingItemHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingItemHandlers('practitioners')

export const GET = handlers.GET
export const PATCH = handlers.PATCH
export const DELETE = handlers.DELETE
