export const DEFAULT_LATEST_POSTS_ORDER_MODE = 'newest'
export const DEFAULT_LATEST_POSTS_LAYOUT = 'grid'

// Keep this false for now. Flip to true to restore the legacy fixed Latest Posts
// section in the admin homepage editor and the public homepage fallback.
export const ENABLE_LEGACY_LATEST_POSTS_SECTION = false

export function normalizeLatestPostsLayout(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'list') return 'list'
    if (normalized === 'compact') return 'compact'
    return DEFAULT_LATEST_POSTS_LAYOUT
}

function parseMaybeJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return {}
        }
    }
    return {}
}

function getItemId(item) {
    return String(item?.id || '').trim()
}

function getItemSlug(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)
    return String(metadata?.slug || item?.slug || '').trim().toLowerCase()
}

export function resolveLatestPostItems({
    items = [],
    heroPostId = '',
    limit = 4,
    orderMode = DEFAULT_LATEST_POSTS_ORDER_MODE,
    orderedIds = [],
    orderedSlugs = []
}) {
    const normalizedHeroPostId = String(heroPostId || '').trim()
    const filteredItems = normalizedHeroPostId
        ? items.filter((item) => getItemId(item) !== normalizedHeroPostId)
        : items

    const normalizedLimit = Number.isFinite(Number(limit))
        ? Math.max(1, Math.floor(Number(limit)))
        : 4
    const normalizedOrderMode = String(orderMode || DEFAULT_LATEST_POSTS_ORDER_MODE).trim().toLowerCase() || DEFAULT_LATEST_POSTS_ORDER_MODE

    if (normalizedOrderMode !== 'manual') {
        return filteredItems.slice(0, normalizedLimit)
    }

    const orderedItems = []
    const seenIds = new Set()
    const byId = new Map(filteredItems.map((item) => [getItemId(item), item]))
    const bySlug = new Map(filteredItems.map((item) => [getItemSlug(item), item]))

    orderedIds.forEach((id) => {
        const normalizedId = String(id || '').trim()
        if (!normalizedId) return

        const match = byId.get(normalizedId)
        if (!match) return

        const matchId = getItemId(match)
        if (!matchId || seenIds.has(matchId)) return
        seenIds.add(matchId)
        orderedItems.push(match)
    })

    if (orderedItems.length === 0) {
        orderedSlugs.forEach((slug) => {
            const normalizedSlug = String(slug || '').trim().toLowerCase()
            if (!normalizedSlug) return

            const match = bySlug.get(normalizedSlug)
            if (!match) return

            const matchId = getItemId(match)
            if (!matchId || seenIds.has(matchId)) return
            seenIds.add(matchId)
            orderedItems.push(match)
        })
    }

    const remainingItems = filteredItems.filter((item) => {
        const itemId = getItemId(item)
        return itemId && !seenIds.has(itemId)
    })

    return [...orderedItems, ...remainingItems].slice(0, normalizedLimit)
}