import { createSchedulingCollectionHandlers } from '@/lib/schedulingApi'

const handlers = createSchedulingCollectionHandlers('practitioner-services')

export const GET = handlers.GET
export const POST = handlers.POST
