const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const TEMPLATE_MODE_MARKDOWN = 'markdown'
export const TEMPLATE_MODE_DOCX_LOCKED = 'docx-locked'
export const DEFAULT_TEMPLATE_MODE = TEMPLATE_MODE_MARKDOWN

export const STRICT_TEMPLATE_POLICY_NONE = 'none'
export const STRICT_TEMPLATE_POLICY_TAC_V1 = 'tac-v1'
export const DEFAULT_STRICT_TEMPLATE_POLICY = STRICT_TEMPLATE_POLICY_NONE

export const STRICT_TEMPLATE_POLICY_REGISTRY = {
    [STRICT_TEMPLATE_POLICY_NONE]: {
        key: STRICT_TEMPLATE_POLICY_NONE,
        label: 'No strict policy',
        enforceDocxLocked: false,
        defaultRequiredPlaceholders: [],
    },
    [STRICT_TEMPLATE_POLICY_TAC_V1]: {
        key: STRICT_TEMPLATE_POLICY_TAC_V1,
        label: 'TAC v1 strict',
        enforceDocxLocked: true,
        defaultRequiredPlaceholders: [],
    },
}

function normalizeArray(value) {
    return Array.isArray(value) ? value : []
}

function normalizeAnchorText(value) {
    return String(value || '').trim()
}

function normalizePlaceholderToken(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^\{\{[A-Za-z0-9_.-]+\}\}$/.test(raw)) return raw

    const cleaned = raw.replace(/^[{\s]+|[}\s]+$/g, '').trim()
    if (!cleaned) return ''
    if (!/^[A-Za-z0-9_.-]+$/.test(cleaned)) return ''
    return `{{${cleaned}}}`
}

export function normalizeTemplateMode(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === TEMPLATE_MODE_DOCX_LOCKED) return TEMPLATE_MODE_DOCX_LOCKED
    return TEMPLATE_MODE_MARKDOWN
}

export function normalizeStrictTemplatePolicy(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (STRICT_TEMPLATE_POLICY_REGISTRY[normalized]) {
        return normalized
    }
    return DEFAULT_STRICT_TEMPLATE_POLICY
}

export function normalizeRequiredPlaceholders(value) {
    const source = normalizeArray(value)
    const deduped = new Set()

    for (const item of source) {
        const token = normalizePlaceholderToken(item)
        if (!token) continue
        deduped.add(token)
    }

    return Array.from(deduped)
}

export function normalizeRequiredAnchors(value) {
    const source = normalizeArray(value)
    const deduped = new Set()

    for (const item of source) {
        const anchor = normalizeAnchorText(item)
        if (!anchor) continue
        deduped.add(anchor)
    }

    return Array.from(deduped)
}

export function normalizeReportTypeTemplateSettings(input = {}) {
    const templateMode = normalizeTemplateMode(input.templateMode)
    const strictTemplatePolicy = normalizeStrictTemplatePolicy(input.strictTemplatePolicy)
    const profile = STRICT_TEMPLATE_POLICY_REGISTRY[strictTemplatePolicy] || STRICT_TEMPLATE_POLICY_REGISTRY[DEFAULT_STRICT_TEMPLATE_POLICY]
    const requiredPlaceholdersRaw = normalizeRequiredPlaceholders(input.requiredPlaceholders)
    const requiredPlaceholders = requiredPlaceholdersRaw.length > 0
        ? requiredPlaceholdersRaw
        : profile.defaultRequiredPlaceholders

    return {
        templateMode,
        strictTemplatePolicy,
        requiredPlaceholders,
        requiredAnchors: normalizeRequiredAnchors(input.requiredAnchors),
    }
}

export function findMissingPlaceholdersInText({ requiredPlaceholders, sourceText }) {
    const required = normalizeRequiredPlaceholders(requiredPlaceholders)
    if (required.length === 0) {
        return []
    }

    const haystack = String(sourceText || '')
    return required.filter((token) => !haystack.includes(token))
}

export function findMissingAnchorsInText({ requiredAnchors, sourceText }) {
    const required = normalizeRequiredAnchors(requiredAnchors)
    if (required.length === 0) {
        return []
    }

    const haystack = String(sourceText || '')
    return required.filter((anchor) => !haystack.includes(anchor))
}

export function validateReportTypeTemplateBindings({ reportTypes, templates }) {
    const templateMap = new Map((Array.isArray(templates) ? templates : []).map((template) => [String(template?.id || '').trim(), template]))
    const failures = []

    for (const reportType of (Array.isArray(reportTypes) ? reportTypes : [])) {
        const reportTypeId = String(reportType?.id || '').trim()
        const reportTypeName = String(reportType?.name || '').trim() || reportTypeId || 'Report type'
        const templateId = String(reportType?.templateId || '').trim()
        const settings = normalizeReportTypeTemplateSettings(reportType)
        const profile = STRICT_TEMPLATE_POLICY_REGISTRY[settings.strictTemplatePolicy] || STRICT_TEMPLATE_POLICY_REGISTRY[DEFAULT_STRICT_TEMPLATE_POLICY]
        const requiresDocx = settings.templateMode === TEMPLATE_MODE_DOCX_LOCKED || profile.enforceDocxLocked === true

        if (requiresDocx && !templateId) {
            failures.push(`${reportTypeName}: requires a linked template when strict DOCX mode is enabled.`)
            continue
        }

        if (!templateId) {
            continue
        }

        const template = templateMap.get(templateId)
        if (!template) {
            failures.push(`${reportTypeName}: linked template was not found.`)
            continue
        }

        const mimeType = String(template?.mimeType || '').trim().toLowerCase()
        if (requiresDocx && mimeType !== DOCX_MIME_TYPE) {
            failures.push(`${reportTypeName}: strict DOCX mode requires a .docx template.`)
        }

        if (profile.enforceDocxLocked && settings.templateMode !== TEMPLATE_MODE_DOCX_LOCKED) {
            failures.push(`${reportTypeName}: strict policy ${profile.label} requires template mode docx-locked.`)
        }
    }

    return {
        valid: failures.length === 0,
        failures,
    }
}

export function getStrictTemplatePolicies() {
    return Object.values(STRICT_TEMPLATE_POLICY_REGISTRY).map((policy) => ({
        key: policy.key,
        label: policy.label,
        enforceDocxLocked: policy.enforceDocxLocked === true,
        defaultRequiredPlaceholders: normalizeRequiredPlaceholders(policy.defaultRequiredPlaceholders),
    }))
}
