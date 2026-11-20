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

export function getPageBlockPostTitle(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)

    return String(
        metadata?.presentation?.default?.title ||
        metadata?.presentation?.default?.name ||
        item?.title ||
        item?.name ||
        ''
    ).trim()
}

export function getPageBlockPostSummary(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)

    return String(
        metadata?.presentation?.default?.summary ||
        item?.summary ||
        item?.preview ||
        item?.description ||
        item?.body ||
        ''
    ).trim()
}

export function getPageBlockPostHeading(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)
    const presentation = parseMaybeJsonObject(metadata?.presentation)
    const defaultPresentation = parseMaybeJsonObject(presentation?.default)
    const attributes = parseMaybeJsonObject(item?.attributes)

    return String(
        defaultPresentation?.heading ||
        metadata?.heading ||
        item?.heading ||
        attributes?.heading ||
        ''
    ).trim()
}

export function toPageBlockPostOption(item) {
    const metadata = parseMaybeJsonObject(item?.metadata)
    const slug = String(metadata?.slug || item?.slug || '').trim()
    const id = String(item?.id || '').trim()
    const title = getPageBlockPostTitle(item)

    return {
        id,
        slug,
        type: String(item?.type || '').trim().toLowerCase(),
        title,
        heading: getPageBlockPostHeading(item),
        summary: getPageBlockPostSummary(item),
        status: String(item?.status || '').trim().toLowerCase(),
        href: slug ? `/${slug}` : ''
    }
}

export function resolvePageBlockPostItem({ items = [], postId, postSlug }) {
    const normalizedId = String(postId || '').trim()
    const normalizedSlug = String(postSlug || '').trim().toLowerCase()
    const normalizedItems = (Array.isArray(items) ? items : [])
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id || item.slug)

    if (!normalizedId && !normalizedSlug) return null

    if (normalizedId) {
        const byId = normalizedItems.find((item) => item.id === normalizedId)
        if (byId) return byId
    }

    if (normalizedSlug) {
        const bySlug = normalizedItems.find((item) => item.slug.toLowerCase() === normalizedSlug)
        if (bySlug) return bySlug
    }

    return null
}

export function attachResolvedSinglePostBlocks(blocks = [], items = []) {
    const normalizedItems = (Array.isArray(items) ? items : [])
        .map((item) => toPageBlockPostOption(item))
        .filter((item) => item.id || item.slug)

    return (Array.isArray(blocks) ? blocks : []).map((block) => {
        if (block?.type !== 'single_post' && block?.type !== 'three_panel' && block?.type !== 'cards') return block

        if (block?.type === 'cards') {
            const nextItems = (Array.isArray(block.items) ? block.items : []).map((item) => {
                if (!item?.postId && !item?.postSlug) return item
                const resolvedPost = resolvePageBlockPostItem({
                    items: normalizedItems,
                    postId: item.postId,
                    postSlug: item.postSlug
                })
                return resolvedPost ? { ...item, resolvedPost } : item
            })
            return { ...block, items: nextItems }
        }

        const resolvedPost = resolvePageBlockPostItem({
            items: normalizedItems,
            postId: block.postId,
            postSlug: block.postSlug
        })

        if (block?.type === 'three_panel') {
            return {
                ...block,
                resolvedIntroPost: resolvedPost
            }
        }

        return {
            ...block,
            resolvedPost
        }
    })
}