const PENDING_DELETE_STATUS = 'pending delete'

export function filterRecentContentUpdates(items = []) {
    return (Array.isArray(items) ? items : []).filter((item) => {
        const contentStatus = item?.contentStatus ?? item?.status
        return String(contentStatus || '').trim().toLowerCase() !== PENDING_DELETE_STATUS
    })
}