export const ADMIN_BUILTIN_QUICK_ACTIONS = [
    {
        key: 'post',
        label: 'New Post',
        description: 'Create a new post record from the dashboard.',
        contentType: 'post',
        tone: 'from-sky-200 via-blue-300 to-indigo-200',
        glow: 'shadow-blue-300/70',
    },
    {
        key: 'page',
        label: 'New Page',
        description: 'Create a new page record from the dashboard.',
        contentType: 'page',
        tone: 'from-emerald-200 via-teal-300 to-green-200',
        glow: 'shadow-emerald-300/70',
    },
]

// Backward-compatible export used by existing imports.
export const ADMIN_QUICK_ACTION_DEFINITIONS = ADMIN_BUILTIN_QUICK_ACTIONS

export const ADMIN_CUSTOM_QUICK_ACTION_ICON_OPTIONS = ['🔗', '📄', '🧭', '⚡', '📊', '🛠️', '📝', '📁', '🏠', '⭐']

const DEFAULT_BUILTIN_KEYS = ADMIN_BUILTIN_QUICK_ACTIONS.map((definition) => definition.key)

function normalizeBuiltinEnabledFlags(incoming) {
    const source = incoming && typeof incoming === 'object' ? incoming : {}

    return DEFAULT_BUILTIN_KEYS.reduce((acc, actionKey) => {
        acc[actionKey] = source[actionKey] !== false
        return acc
    }, {})
}

function normalizeBuiltinOrder(incomingOrder) {
    const seen = new Set()
    const order = []

    if (Array.isArray(incomingOrder)) {
        incomingOrder.forEach((value) => {
            const key = String(value || '').trim()
            if (!key || seen.has(key)) return
            if (!DEFAULT_BUILTIN_KEYS.includes(key)) return
            seen.add(key)
            order.push(key)
        })
    }

    DEFAULT_BUILTIN_KEYS.forEach((key) => {
        if (seen.has(key)) return
        seen.add(key)
        order.push(key)
    })

    return order
}

function normalizeCustomLinkAction(item, index) {
    const source = item && typeof item === 'object' ? item : {}
    const id = String(source.id || '').trim() || `custom-link-${index + 1}`
    const label = String(source.label || source.name || '').trim()
    const url = String(source.url || source.href || '').trim()
    const icon = String(source.icon || '').trim() || '🔗'
    const color = normalizeHexColor(source.color, '#94a3b8')

    return {
        id,
        label,
        url,
        icon,
        color,
        openInNewTab: source.openInNewTab !== false,
        enabled: source.enabled !== false,
    }
}

function normalizeHexColor(value, fallback) {
    const raw = String(value || '').trim()
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
        return raw.toLowerCase()
    }
    return fallback
}

export function getDefaultAdminQuickActionsConfig() {
    return {
        enabled: normalizeBuiltinEnabledFlags({}),
        order: [...DEFAULT_BUILTIN_KEYS],
        customLinks: [],
    }
}

export function normalizeAdminQuickActionsConfig(value) {
    const incoming = value && typeof value === 'object' ? value : {}
    const defaults = getDefaultAdminQuickActionsConfig()

    // Backward compatibility: old shape was { post: true, page: true, ... }.
    const hasLegacyFlatFlags = DEFAULT_BUILTIN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(incoming, key))
    const legacyEnabledFlags = hasLegacyFlatFlags
        ? DEFAULT_BUILTIN_KEYS.reduce((acc, key) => {
            acc[key] = incoming[key] !== false
            return acc
        }, {})
        : {}

    const enabled = normalizeBuiltinEnabledFlags({
        ...legacyEnabledFlags,
        ...(incoming.enabled && typeof incoming.enabled === 'object' ? incoming.enabled : {}),
    })

    const order = normalizeBuiltinOrder(incoming.order)
    const customSource = Array.isArray(incoming.customLinks)
        ? incoming.customLinks
        : (Array.isArray(incoming.custom) ? incoming.custom : [])

    const customLinks = customSource
        .map((item, index) => normalizeCustomLinkAction(item, index))
        .filter((item) => item.label.length > 0 && item.url.length > 0)

    return {
        ...defaults,
        enabled,
        order,
        customLinks,
    }
}
