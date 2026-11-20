// The AI selection a queued job must run with.
//
// This lives outside the patient routes because every enqueue path needs it: the report job, the
// analyst job, and the analyst backfill. It used to be copy-pasted into each patient route, which
// meant the analyst backfill (which lived in the worker service) had no access to it at all - jobs
// queued there ran on a hardcoded worker default and silently ignored the domain's chosen model.

import { readReportConfigForDomain } from '@/lib/reportSettingsStore'
import { readAiProviderModelCatalog } from '@/lib/aiProviderModelCatalog'
import {
    getReportAiProviderApiKeyAvailability,
    resolveReportAiSelection,
} from '@/lib/reportAiProviders'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

/**
 * Resolve the provider, tier, model, and base URL a domain's jobs should use.
 *
 * The stored model catalog wins over the domain's own copy, so an operator refreshing the catalog
 * changes every domain without re-saving its report settings.
 */
export async function buildReportAiUsagePayload(domain) {
    const domainKey = normalizeDomainKey(domain)
    const [config, catalog] = await Promise.all([
        readReportConfigForDomain(domainKey),
        readAiProviderModelCatalog(),
    ])
    const selected = resolveReportAiSelection({
        ...config,
        providerModels: catalog?.models,
    })
    const providerApiKeyStatus = getReportAiProviderApiKeyAvailability()

    return {
        gateway: selected.provider === 'openai' ? 'openai' : 'direct',
        vendor: selected.providerLabel,
        provider: selected.provider,
        modelTier: selected.tier,
        model: selected.model,
        baseUrl: selected.baseUrl,
        hasApiKey: providerApiKeyStatus[selected.provider] === true,
    }
}
