export const DISPLAY_POLICY_SYSTEM_KEY = 'display_policy_v1'

export const DEFAULT_DISPLAY_POLICY = {
    frontend: {
        showPracticeContent: true
    },
    backend: {
        showPracticeContent: true
    }
}

function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return true
        if (normalized === 'false') return false
    }
    return fallback
}

export function normalizeDisplayPolicy(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    return {
        frontend: {
            showPracticeContent: parseBoolean(
                next?.frontend?.showPracticeContent,
                DEFAULT_DISPLAY_POLICY.frontend.showPracticeContent
            )
        },
        backend: {
            showPracticeContent: parseBoolean(
                next?.backend?.showPracticeContent,
                DEFAULT_DISPLAY_POLICY.backend.showPracticeContent
            )
        }
    }
}

export function shouldShowPracticeContent({ surface, policy }) {
    const normalizedPolicy = normalizeDisplayPolicy(policy)

    if (surface === 'backend') {
        return normalizedPolicy.backend.showPracticeContent
    }

    return normalizedPolicy.frontend.showPracticeContent
}
