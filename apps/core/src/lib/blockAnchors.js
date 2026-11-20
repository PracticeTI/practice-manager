export function normalizeBlockAnchorId(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
}

export function resolveBlockAnchorId({ slug, blockId }) {
    return normalizeBlockAnchorId(slug) || String(blockId || '').trim()
}
