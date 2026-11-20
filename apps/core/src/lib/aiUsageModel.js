function normalizeModel(value) {
    return String(value || '').trim().toLowerCase()
}

function pickFirstModel(values) {
    for (const value of values) {
        const normalized = normalizeModel(value)
        if (normalized) {
            return normalized
        }
    }
    return ''
}

export function resolvePreferredModel({ defaultModel, completedReportJobs = [], reports = [] }) {
    const candidateModels = []

    for (const row of completedReportJobs || []) {
        candidateModels.push(row?.usage_model)
    }

    for (const row of reports || []) {
        const metadata = row?.source_metadata_json
        if (!metadata) continue

        const parsed = typeof metadata === 'string' ? (() => {
            try {
                return JSON.parse(metadata)
            } catch {
                return null
            }
        })() : metadata

        const nestedModel = parsed?.usage?.model
            || parsed?.model
            || parsed?.generation?.model
            || parsed?.metadata?.model
            || parsed?.metadata?.usage?.model

        if (nestedModel) {
            candidateModels.push(nestedModel)
        }
    }

    return pickFirstModel([pickFirstModel(candidateModels), defaultModel])
}
