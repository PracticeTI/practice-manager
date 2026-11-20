export const ASANA_CONTACT_SETTINGS_KEY = 'asana_contact_settings_v1'

export const DEFAULT_ASANA_CONTACT_SETTINGS = {
    enabled: false,
    projectGid: '',
    sectionGid: '',
    assigneeGid: '',
    tagGids: [],
    taskNamePrefix: 'Website Contact'
}

function normalizeBoolean(value) {
    return value === true
}

function normalizeGid(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return ''
    return /^\d+$/.test(normalized) ? normalized : ''
}

function normalizeTaskNamePrefix(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return DEFAULT_ASANA_CONTACT_SETTINGS.taskNamePrefix
    return normalized.slice(0, 80)
}

function parseTagGids(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeGid(item))
            .filter(Boolean)
    }

    if (typeof value === 'string') {
        return value
            .split(/[\s,]+/)
            .map((item) => normalizeGid(item))
            .filter(Boolean)
    }

    return []
}

export function normalizeAsanaContactSettings(value) {
    const settings = value && typeof value === 'object' ? value : {}

    return {
        enabled: normalizeBoolean(settings.enabled),
        projectGid: normalizeGid(settings.projectGid),
        sectionGid: normalizeGid(settings.sectionGid),
        assigneeGid: normalizeGid(settings.assigneeGid),
        tagGids: parseTagGids(settings.tagGids),
        taskNamePrefix: normalizeTaskNamePrefix(settings.taskNamePrefix)
    }
}

export function isAsanaContactConfigured(settings, options = {}) {
    const normalized = normalizeAsanaContactSettings(settings)
    const hasAccessToken = options.hasAccessToken === true

    return Boolean(normalized.enabled && normalized.projectGid && hasAccessToken)
}
