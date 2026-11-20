import { getPrivateDomainFieldMap } from './domainExtension.js'
export const DEFAULT_WEBSITE_MONTHLY_COST = 19
export const MAX_REPLACED_TOOLS = 30

// Seeded examples so a domain shows a meaningful value comparison before it is configured.
const DEFAULT_REPLACED_TOOLS_BY_DOMAIN = getPrivateDomainFieldMap('replacedTools')

export function normalizeMonthlyCost(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    return Math.round(numeric * 100) / 100
}

export function getDefaultUsageValueSettings(domainKey = '') {
    const normalizedDomainKey = String(domainKey || '').trim().toLowerCase()
    const seededTools = DEFAULT_REPLACED_TOOLS_BY_DOMAIN[normalizedDomainKey] || []
    return {
        websiteMonthlyCost: DEFAULT_WEBSITE_MONTHLY_COST,
        replacedTools: seededTools.map((tool) => ({ ...tool })),
    }
}

export function normalizeUsageValueSettings(value, domainKey = '') {
    const source = value && typeof value === 'object' ? value : {}
    const defaults = getDefaultUsageValueSettings(domainKey)

    const hasWebsiteCost = source.websiteMonthlyCost !== undefined
        && source.websiteMonthlyCost !== null
        && String(source.websiteMonthlyCost).trim() !== ''

    const replacedTools = (Array.isArray(source.replacedTools) ? source.replacedTools : [])
        .map((tool) => ({
            name: String(tool?.name || '').trim().slice(0, 120),
            monthlyCost: normalizeMonthlyCost(tool?.monthlyCost),
        }))
        .filter((tool) => tool.name.length > 0)
        .slice(0, MAX_REPLACED_TOOLS)

    return {
        websiteMonthlyCost: hasWebsiteCost ? normalizeMonthlyCost(source.websiteMonthlyCost) : defaults.websiteMonthlyCost,
        replacedTools: Array.isArray(source.replacedTools) ? replacedTools : defaults.replacedTools,
    }
}

export function summarizeUsageValue(usageValueSettings, aiMonthlyCost = 0, domainKey = '') {
    const normalized = normalizeUsageValueSettings(usageValueSettings, domainKey)
    const aiCost = normalizeMonthlyCost(aiMonthlyCost)
    const websiteMonthlyCost = normalized.websiteMonthlyCost
    const platformMonthlyCost = Math.round((aiCost + websiteMonthlyCost) * 100) / 100
    const replacedToolsMonthlyCost = normalized.replacedTools.reduce(
        (sum, tool) => sum + normalizeMonthlyCost(tool.monthlyCost),
        0
    )
    const netMonthlySaving = Math.round((replacedToolsMonthlyCost - platformMonthlyCost) * 100) / 100

    return {
        websiteMonthlyCost,
        aiMonthlyCost: aiCost,
        platformMonthlyCost,
        replacedTools: normalized.replacedTools,
        replacedToolsMonthlyCost: Math.round(replacedToolsMonthlyCost * 100) / 100,
        netMonthlySaving,
        netAnnualSaving: Math.round(netMonthlySaving * 12 * 100) / 100,
        valueMultiple: platformMonthlyCost > 0
            ? Math.round((replacedToolsMonthlyCost / platformMonthlyCost) * 10) / 10
            : 0,
    }
}
