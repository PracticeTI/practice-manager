import { createSchedulingItemHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingItemHandlers('waitlist')

export const GET = handlers.GET
export const PATCH = handlers.PATCH
export const DELETE = handlers.DELETE
