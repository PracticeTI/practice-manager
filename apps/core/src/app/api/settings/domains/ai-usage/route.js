import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    CUSTOMER_COHORTS_SETTINGS_KEY,
    resolveDomainUsageMarkupPercent,
} from '@/lib/customerCohorts'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getDomainSetting, getSystemSetting } from '@/lib/appSettings'
import { resolvePreferredModel } from '@/lib/aiUsageModel'
import { summarizeUsageValue } from '@/lib/usageValue'
import { DEFAULT_DOMAIN_KEY, getHostnameDomainMap } from '@/lib/domainMode'

const DEFAULT_REPORTS_TABLE = 'patient_reports'
const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'
const DEFAULT_TRANSCRIPTIONS_TABLE = 'patient_transcriptions'
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_BILLING_CURRENCY = 'AUD'
const WINDOW_DAYS = 30

// Standard (non-batch, short-context) list prices in USD per million tokens, verified on
// 2026-11-04 against https://platform.claude.com/docs/en/about-claude/pricing and
// https://developers.openai.com/api/docs/pricing. The report worker keeps the same table in its
// own repo - keep the two in step.
//
// Long-context and >100k-prompt bands are deliberately not modelled: these calls stay inside the
// short-context band, where the listed rate is the one actually charged. A model missing from this
// table is priced as DEFAULT_MODEL, which understates anything expensive - add the row rather than
// relying on the fallback.
const MODEL_PRICING_USD_PER_MILLION = {
    // Claude
    'claude-fable-5-1': { input: 10.0, output: 50.0 },
    'claude-fable-5': { input: 10.0, output: 50.0 },
    'claude-opus-5-5': { input: 4.0, output: 20.0 },
    'claude-opus-5': { input: 5.0, output: 25.0 },
    'claude-opus-4-8': { input: 5.0, output: 25.0 },
    'claude-opus-4-7': { input: 5.0, output: 25.0 },
    'claude-opus-4-6': { input: 5.0, output: 25.0 },
    'claude-opus-4-5': { input: 5.0, output: 25.0 },
    'claude-sonnet-5-5': { input: 2.0, output: 10.0 },
    'claude-sonnet-5': { input: 2.0, output: 10.0 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
    // OpenRouter (namespaced ids; rates read from GET /v1/models on 2026-11-04)
    'moonshotai/kimi-k3': { input: 0.2, output: 16.0 },
    'qwen/qwen3.8-2.4t-a95b': { input: 2.0, output: 6.0 },
    'minimax/minimax-m3.1-flash': { input: 0.15, output: 0.6 },
    'xiaomi/mimo-v2.6-pro': { input: 0.43, output: 0.87 },
    'z-ai/glm-5.3': { input: 0.08, output: 3.6 },
    // OpenAI
    'gpt-5.6-sol': { input: 4.0, output: 20.0 },
    'gpt-5.6-terra': { input: 2.0, output: 12.0 },
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.5': { input: 5.0, output: 30.0 },
    'gpt-5.4': { input: 2.5, output: 15.0 },
    'gpt-5.4-mini': { input: 0.75, output: 4.5 },
    'gpt-5.4-nano': { input: 0.2, output: 1.25 },
    'gpt-5.2': { input: 1.75, output: 14.0 },
    'gpt-5.1': { input: 1.25, output: 10.0 },
    'gpt-5': { input: 1.25, output: 10.0 },
    'gpt-5-mini': { input: 0.25, output: 2.0 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-4.1': { input: 2.0, output: 8.0 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

const USD_EXCHANGE_RATES = {
    USD: 1,
    AUD: 1.52,
    CAD: 1.37,
    EUR: 0.92,
    GBP: 0.78,
    NZD: 1.67,
    SGD: 1.35,
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || '').trim())
}

function resolveTableName(value, fallback) {
    const table = String(value || fallback).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error(`Invalid table name: ${table}`)
    }
    return table
}

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function resolveDomainAliases(domainKey) {
    const normalizedDomainKey = normalizeDomainKey(domainKey)
    if (!normalizedDomainKey) return []

    const aliases = new Set([normalizedDomainKey])
    const hostnameDomainMap = getHostnameDomainMap()
    Object.entries(hostnameDomainMap).forEach(([hostname, mode]) => {
        if (normalizeDomainKey(mode) !== normalizedDomainKey) return
        const normalizedHostname = normalizeDomainKey(hostname)
        if (!normalizedHostname) return
        aliases.add(normalizedHostname)
        aliases.add(`www.${normalizedHostname}`)
    })

    aliases.add(`${normalizedDomainKey}.localhost`)
    return Array.from(aliases)
}

function normalizeCurrencyCode(value) {
    return String(value || DEFAULT_BILLING_CURRENCY).trim().toUpperCase() || DEFAULT_BILLING_CURRENCY
}

function normalizeModelName(value, fallback = DEFAULT_MODEL) {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized) return normalized
    return String(fallback || DEFAULT_MODEL).trim().toLowerCase() || DEFAULT_MODEL
}

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return ''
    return authHeader.slice('Bearer '.length).trim()
}

function parseJsonObject(value) {
    if (!value) return null
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || (message.includes('relation') && message.includes('does not exist'))
}

function isMissingColumnError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('unknown column')
        || (message.includes('column') && message.includes('does not exist'))
}

function estimateTokensFromText(value) {
    const text = String(value || '').trim()
    if (!text) return 0
    return Math.max(1, Math.ceil(text.length / 4))
}

function extractTokenCounts(metadata) {
    const totals = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        found: false,
    }

    function visit(node, depth = 0) {
        if (!node || depth > 5) return

        if (Array.isArray(node)) {
            node.slice(0, 25).forEach((item) => visit(item, depth + 1))
            return
        }

        if (typeof node !== 'object') return

        Object.entries(node).forEach(([rawKey, rawValue]) => {
            const normalizedKey = String(rawKey || '').toLowerCase().replace(/[^a-z]/g, '')
            if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
                if (normalizedKey === 'prompttokens' || normalizedKey === 'inputtokens') {
                    totals.inputTokens += rawValue
                    totals.found = true
                    return
                }

                if (normalizedKey === 'completiontokens' || normalizedKey === 'outputtokens') {
                    totals.outputTokens += rawValue
                    totals.found = true
                    return
                }

                if (normalizedKey === 'totaltokens' || normalizedKey === 'tokens') {
                    totals.totalTokens += rawValue
                    totals.found = true
                    return
                }
            }

            if (rawValue && typeof rawValue === 'object') {
                visit(rawValue, depth + 1)
            }
        })
    }

    visit(metadata)

    if (totals.totalTokens === 0 && (totals.inputTokens > 0 || totals.outputTokens > 0)) {
        totals.totalTokens = totals.inputTokens + totals.outputTokens
    } else if (totals.totalTokens > 0 && totals.inputTokens === 0 && totals.outputTokens === 0) {
        totals.outputTokens = totals.totalTokens
    }

    return totals
}

function extractModelName(metadata) {
    let resolvedModel = ''

    function visit(node, depth = 0) {
        if (!node || depth > 5 || resolvedModel) return

        if (Array.isArray(node)) {
            node.slice(0, 25).forEach((item) => visit(item, depth + 1))
            return
        }

        if (typeof node !== 'object') return

        Object.entries(node).forEach(([rawKey, rawValue]) => {
            if (resolvedModel) return
            const normalizedKey = String(rawKey || '').toLowerCase().replace(/[^a-z]/g, '')
            if (normalizedKey.includes('model') && typeof rawValue === 'string') {
                const candidate = String(rawValue || '').trim()
                if (candidate) {
                    resolvedModel = candidate
                    return
                }
            }

            if (rawValue && typeof rawValue === 'object') {
                visit(rawValue, depth + 1)
            }
        })
    }

    visit(metadata)
    return resolvedModel
}

function resolvePricing(modelName) {
    const normalizedModel = String(modelName || '').trim().toLowerCase()
    const direct = MODEL_PRICING_USD_PER_MILLION[normalizedModel]
    if (direct) return direct
    // A dated alias (`claude-sonnet-4-5-20250929`) is the same model at the same price.
    const undated = normalizedModel.replace(/-\d{8}$/, '')
    return MODEL_PRICING_USD_PER_MILLION[undated] || MODEL_PRICING_USD_PER_MILLION[DEFAULT_MODEL]
}

function convertFromUsd(amountUsd, currency) {
    const normalizedCurrency = normalizeCurrencyCode(currency)
    const numericAmount = Number(amountUsd || 0)
    if (!Number.isFinite(numericAmount)) return 0
    const rate = USD_EXCHANGE_RATES[normalizedCurrency] || USD_EXCHANGE_RATES.USD
    return numericAmount * rate
}

async function fetchRecentReports(connection, dbType, table, domainCandidates) {
    const safeDomainCandidates = Array.isArray(domainCandidates)
        ? domainCandidates.map((value) => normalizeDomainKey(value)).filter(Boolean)
        : []
    if (safeDomainCandidates.length === 0) return []

    try {
        const result = await connection.query(
            `
                SELECT id, patient_id, source_notes, report_markdown, source_metadata_json, created_at, updated_at
                FROM ${table}
                WHERE LOWER(domain) = ANY($1)
                  AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
            `,
            [safeDomainCandidates]
        )
        return result.rows || []
    } catch (error) {
        if (isMissingTableError(error)) {
            return []
        }
        throw error
    }
}

async function fetchRecentTranscriptions(connection, dbType, table, domainCandidates) {
    const safeDomainCandidates = Array.isArray(domainCandidates)
        ? domainCandidates.map((value) => normalizeDomainKey(value)).filter(Boolean)
        : []
    if (safeDomainCandidates.length === 0) return []

    try {
        const result = await connection.query(
            `
                SELECT id, transcript_text, metadata, created_at, updated_at
                FROM ${table}
                WHERE LOWER(domain) = ANY($1)
                  AND COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
            `,
            [safeDomainCandidates]
        )
        return result.rows || []
    } catch (error) {
        if (isMissingTableError(error)) {
            return []
        }
        throw error
    }
}

async function fetchRecentCompletedReportJobs(connection, dbType, table, domainCandidates) {
    const safeDomainCandidates = Array.isArray(domainCandidates)
        ? domainCandidates.map((value) => normalizeDomainKey(value)).filter(Boolean)
        : []
    if (safeDomainCandidates.length === 0) return []

    try {
        const result = await connection.query(
            `
                SELECT id, patient_id, usage_model, usage_input_tokens, usage_output_tokens, usage_total_tokens, usage_estimated_cost_usd
                FROM ${table}
                WHERE LOWER(domain) = ANY($1)
                  AND status = 'completed'
                  AND COALESCE(completed_at, updated_at, created_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
            `,
            [safeDomainCandidates]
        )
        return result.rows || []
    } catch (error) {
        if (isMissingTableError(error)) {
            return null
        }
        if (isMissingColumnError(error)) {
            try {
                const legacyResult = await connection.query(
                    `
                        SELECT id, patient_id
                        FROM ${table}
                        WHERE LOWER(domain) = ANY($1)
                          AND status = 'completed'
                          AND COALESCE(completed_at, updated_at, created_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
                    `,
                    [safeDomainCandidates]
                )
                return legacyResult.rows || []
            } catch (fallbackError) {
                if (isMissingTableError(fallbackError)) {
                    return null
                }
                throw fallbackError
            }
        }
        throw error
    }
}

function buildUsageSummary({ reports, transcriptions, model, billingCurrency, completedReportJobs, usageMarkupPercent = 0, customerCohort = null }) {
    const resolvedDefaultModel = normalizeModelName(model)
    let reportInputTokens = 0
    let reportOutputTokens = 0
    let transcriptTokens = 0
    let measuredTokenRecords = 0
    let reportRowsWithoutCompletedJobs = 0
    const modelUsageMap = new Map()

    function addModelUsage(modelName, usage = {}) {
        const resolvedModelName = normalizeModelName(modelName, resolvedDefaultModel)
        const existing = modelUsageMap.get(resolvedModelName) || {
            model: resolvedModelName,
            reportCount: 0,
            transcriptCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
        }

        const nextInputTokens = Number(usage?.inputTokens)
        const nextOutputTokens = Number(usage?.outputTokens)
        const nextTotalTokens = Number(usage?.totalTokens)
        const nextEstimatedCostUsd = Number(usage?.estimatedCostUsd)
        const nextReportCount = Number(usage?.reportCount)
        const nextTranscriptCount = Number(usage?.transcriptCount)

        existing.inputTokens += Number.isFinite(nextInputTokens) ? nextInputTokens : 0
        existing.outputTokens += Number.isFinite(nextOutputTokens) ? nextOutputTokens : 0
        existing.totalTokens += Number.isFinite(nextTotalTokens)
            ? nextTotalTokens
            : ((Number.isFinite(nextInputTokens) ? nextInputTokens : 0) + (Number.isFinite(nextOutputTokens) ? nextOutputTokens : 0))
        existing.estimatedCostUsd += Number.isFinite(nextEstimatedCostUsd) ? nextEstimatedCostUsd : 0
        existing.reportCount += Number.isFinite(nextReportCount) ? nextReportCount : 0
        existing.transcriptCount += Number.isFinite(nextTranscriptCount) ? nextTranscriptCount : 0

        modelUsageMap.set(resolvedModelName, existing)
    }

    const completedReportCountsByPatient = new Map()
    const persistedUsageCountsByPatient = new Map()
    let completedReportJobCount = 0

    for (const row of completedReportJobs || []) {
        completedReportJobCount += 1
        const patientId = Number.parseInt(String(row?.patient_id || ''), 10)
        if (Number.isFinite(patientId) && patientId > 0) {
            completedReportCountsByPatient.set(patientId, Number(completedReportCountsByPatient.get(patientId) || 0) + 1)
        }

        const inputTokens = Number(row?.usage_input_tokens)
        const outputTokens = Number(row?.usage_output_tokens)
        const totalTokens = Number(row?.usage_total_tokens)
        const estimatedCostUsd = Number(row?.usage_estimated_cost_usd)
        const hasPersistedUsage = Number.isFinite(inputTokens)
            || Number.isFinite(outputTokens)
            || Number.isFinite(totalTokens)
            || Number.isFinite(estimatedCostUsd)

        if (!hasPersistedUsage) {
            continue
        }

        const resolvedInputTokens = Number.isFinite(inputTokens) ? inputTokens : 0
        const resolvedOutputTokens = Number.isFinite(outputTokens)
            ? outputTokens
            : Math.max(0, (Number.isFinite(totalTokens) ? totalTokens : 0) - resolvedInputTokens)
        const resolvedTotalTokens = Number.isFinite(totalTokens)
            ? totalTokens
            : resolvedInputTokens + resolvedOutputTokens
        const usageModel = normalizeModelName(row?.usage_model, resolvedDefaultModel)
        const usagePricing = resolvePricing(usageModel)
        const rowEstimatedCostUsd = Number.isFinite(estimatedCostUsd)
            ? estimatedCostUsd
            : ((resolvedInputTokens * usagePricing.input) + (resolvedOutputTokens * usagePricing.output)) / 1000000

        reportInputTokens += resolvedInputTokens
        reportOutputTokens += resolvedOutputTokens
        measuredTokenRecords += 1
        addModelUsage(usageModel, {
            reportCount: 1,
            inputTokens: resolvedInputTokens,
            outputTokens: resolvedOutputTokens,
            totalTokens: resolvedTotalTokens,
            estimatedCostUsd: rowEstimatedCostUsd,
        })

        if (Number.isFinite(patientId) && patientId > 0) {
            persistedUsageCountsByPatient.set(patientId, Number(persistedUsageCountsByPatient.get(patientId) || 0) + 1)
        }
    }

    for (const row of reports) {
        const patientId = Number.parseInt(String(row?.patient_id || ''), 10)
        const matchedCompletedCount = Number.isFinite(patientId) && patientId > 0
            ? Number(completedReportCountsByPatient.get(patientId) || 0)
            : 0
        const matchedPersistedUsageCount = Number.isFinite(patientId) && patientId > 0
            ? Number(persistedUsageCountsByPatient.get(patientId) || 0)
            : 0
        const generationCount = matchedCompletedCount > 0
            ? Math.max(0, matchedCompletedCount - matchedPersistedUsageCount)
            : 1
        if (matchedCompletedCount <= 0) {
            reportRowsWithoutCompletedJobs += 1
        }
        if (generationCount <= 0) {
            continue
        }
        const metadata = parseJsonObject(row?.source_metadata_json)
        const reportModel = normalizeModelName(extractModelName(metadata), resolvedDefaultModel)
        const reportPricing = resolvePricing(reportModel)
        const extracted = extractTokenCounts(metadata)
        if (extracted.found) {
            const inputTokens = extracted.inputTokens * generationCount
            const outputTokens = (extracted.outputTokens || Math.max(0, extracted.totalTokens - extracted.inputTokens)) * generationCount
            const totalTokens = extracted.totalTokens > 0
                ? extracted.totalTokens * generationCount
                : inputTokens + outputTokens

            reportInputTokens += inputTokens
            reportOutputTokens += outputTokens
            measuredTokenRecords += generationCount
            addModelUsage(reportModel, {
                reportCount: generationCount,
                inputTokens,
                outputTokens,
                totalTokens,
                estimatedCostUsd: ((inputTokens * reportPricing.input) + (outputTokens * reportPricing.output)) / 1000000,
            })
            continue
        }

        const estimatedInputTokens = estimateTokensFromText(row?.source_notes) * generationCount
        const estimatedOutputTokens = estimateTokensFromText(row?.report_markdown) * generationCount
        reportInputTokens += estimatedInputTokens
        reportOutputTokens += estimatedOutputTokens
        addModelUsage(reportModel, {
            reportCount: generationCount,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
            totalTokens: estimatedInputTokens + estimatedOutputTokens,
            estimatedCostUsd: ((estimatedInputTokens * reportPricing.input) + (estimatedOutputTokens * reportPricing.output)) / 1000000,
        })
    }

    for (const row of transcriptions) {
        const metadata = parseJsonObject(row?.metadata)
        const transcriptModel = normalizeModelName(extractModelName(metadata), resolvedDefaultModel)
        const transcriptPricing = resolvePricing(transcriptModel)
        const extracted = extractTokenCounts(metadata)
        if (extracted.found) {
            const resolvedTranscriptTokens = extracted.totalTokens || extracted.outputTokens || extracted.inputTokens
            transcriptTokens += resolvedTranscriptTokens
            measuredTokenRecords += 1
            addModelUsage(transcriptModel, {
                transcriptCount: 1,
                outputTokens: resolvedTranscriptTokens,
                totalTokens: resolvedTranscriptTokens,
                estimatedCostUsd: (resolvedTranscriptTokens * transcriptPricing.output) / 1000000,
            })
            continue
        }

        const estimatedTranscriptTokens = estimateTokensFromText(row?.transcript_text)
        transcriptTokens += estimatedTranscriptTokens
        addModelUsage(transcriptModel, {
            transcriptCount: 1,
            outputTokens: estimatedTranscriptTokens,
            totalTokens: estimatedTranscriptTokens,
            estimatedCostUsd: (estimatedTranscriptTokens * transcriptPricing.output) / 1000000,
        })
    }

    const exactMonthlyCostUsd = Array.from(modelUsageMap.values()).reduce((sum, entry) => {
        const amount = Number(entry?.estimatedCostUsd)
        return sum + (Number.isFinite(amount) ? amount : 0)
    }, 0)
    const normalizedBillingCurrency = normalizeCurrencyCode(billingCurrency)
    const baseEstimatedMonthlyCost = convertFromUsd(exactMonthlyCostUsd, normalizedBillingCurrency)
    const normalizedUsageMarkupPercent = Number.isFinite(Number(usageMarkupPercent)) ? Math.max(0, Number(usageMarkupPercent)) : 0
    const markupMultiplier = 1 + (normalizedUsageMarkupPercent / 100)
    const exactMonthlyCostWithMarkupUsd = exactMonthlyCostUsd * markupMultiplier
    const exactMonthlyCostWithMarkup = convertFromUsd(exactMonthlyCostWithMarkupUsd, normalizedBillingCurrency)
    const markupAmountUsd = exactMonthlyCostWithMarkupUsd - exactMonthlyCostUsd
    const markupAmount = exactMonthlyCostWithMarkup - baseEstimatedMonthlyCost

    const roundedMonthlyCostUsd = exactMonthlyCostWithMarkupUsd > 0 ? Math.ceil(exactMonthlyCostWithMarkupUsd) : 0
    const roundedMonthlyCost = exactMonthlyCostWithMarkup > 0 ? Math.ceil(exactMonthlyCostWithMarkup) : 0
    const roundedBaseMonthlyCostUsd = exactMonthlyCostUsd > 0 ? Math.ceil(exactMonthlyCostUsd) : 0
    const roundedBaseMonthlyCost = baseEstimatedMonthlyCost > 0 ? Math.ceil(baseEstimatedMonthlyCost) : 0
    const modelBreakdown = Array.from(modelUsageMap.values())
        .filter((entry) => entry.totalTokens > 0 || entry.estimatedCostUsd > 0)
        .map((entry) => {
            const baseEstimatedCost = convertFromUsd(entry.estimatedCostUsd, normalizedBillingCurrency)
            const estimatedCost = baseEstimatedCost * markupMultiplier
            return {
                model: entry.model,
                reportCount: entry.reportCount,
                transcriptCount: entry.transcriptCount,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                totalTokens: entry.totalTokens,
                baseEstimatedCostUsd: entry.estimatedCostUsd,
                baseEstimatedCost,
                estimatedCostUsd: entry.estimatedCostUsd * markupMultiplier,
                estimatedCost,
            }
        })
        .sort((left, right) => right.estimatedCost - left.estimatedCost)
    const primaryModel = modelBreakdown[0]?.model || resolvedDefaultModel
    const primaryPricing = resolvePricing(primaryModel)

    return {
        model: primaryModel,
        modelsUsed: modelBreakdown,
        modelCount: modelBreakdown.length,
        billingCurrency: normalizedBillingCurrency,
        customerCohortKey: customerCohort?.key || '',
        customerCohortLabel: customerCohort?.label || '',
        usageMarkupPercent: normalizedUsageMarkupPercent,
        periodDays: WINDOW_DAYS,
        reportCount: completedReportJobCount + reportRowsWithoutCompletedJobs,
        transcriptCount: transcriptions.length,
        reportInputTokens,
        reportOutputTokens,
        transcriptTokens,
        totalEstimatedTokens: reportInputTokens + reportOutputTokens + transcriptTokens,
        estimatedMonthlyCostUsd: exactMonthlyCostWithMarkupUsd,
        roundedMonthlyCostUsd,
        estimatedMonthlyCost: exactMonthlyCostWithMarkup,
        roundedMonthlyCost,
        baseEstimatedMonthlyCostUsd: exactMonthlyCostUsd,
        roundedBaseMonthlyCostUsd,
        baseEstimatedMonthlyCost,
        roundedBaseMonthlyCost,
        markupAmountUsd,
        markupAmount,
        measuredTokenRecords,
        pricing: primaryPricing,
    }
}

export async function GET(request) {
    let connection = null
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedDomainKey = normalizeDomainKey(searchParams.get('domainKey'))
        const scopedAdminDomain = normalizeDomainKey(adminUser?.domain)
        const domainKey = isSuperAdmin(adminUser)
            ? (requestedDomainKey || DEFAULT_DOMAIN_KEY)
            : scopedAdminDomain

        if (!domainKey) {
            return NextResponse.json({ error: 'Domain key is required' }, { status: 400 })
        }

        if (!isSuperAdmin(adminUser) && requestedDomainKey && requestedDomainKey !== scopedAdminDomain) {
            return NextResponse.json({ error: 'Unauthorized: domain scope mismatch' }, { status: 403 })
        }

        const domainSettings = (await getDomainSetting(domainKey, 'management')) || {}
        const customerCohorts = (await getSystemSetting(CUSTOMER_COHORTS_SETTINGS_KEY)) || []
        const { usageMarkupPercent, customerCohort } = resolveDomainUsageMarkupPercent(domainSettings, customerCohorts)
        const configuredModel = String(domainSettings?.aiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL
        const billingCurrency = normalizeCurrencyCode(domainSettings?.billingCurrency)
        const enabled = domainSettings?.aiUsageEnabled === true

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({
                success: true,
                enabled,
                domainKey,
                summary: {
                    ...buildUsageSummary({ reports: [], transcriptions: [], model: configuredModel, billingCurrency, usageMarkupPercent, customerCohort }),
                    value: summarizeUsageValue(domainSettings?.usageValue, 0, domainKey),
                },
                unavailableReason: 'Relational database not configured',
            })
        }

        connection = await getDatabaseConnection()
        const reportsTable = resolveTableName(process.env.PATIENT_REPORTS_TABLE, DEFAULT_REPORTS_TABLE)
        const reportQueueTable = resolveTableName(process.env.REPORT_QUEUE_TABLE, DEFAULT_REPORT_QUEUE_TABLE)
        const transcriptionsTable = resolveTableName(process.env.PATIENT_TRANSCRIPTIONS_TABLE, DEFAULT_TRANSCRIPTIONS_TABLE)
        const domainCandidates = resolveDomainAliases(domainKey)
        const [reports, completedReportJobs, transcriptions] = await Promise.all([
            fetchRecentReports(connection, dbType, reportsTable, domainCandidates),
            fetchRecentCompletedReportJobs(connection, dbType, reportQueueTable, domainCandidates),
            fetchRecentTranscriptions(connection, dbType, transcriptionsTable, domainCandidates),
        ])

        const model = resolvePreferredModel({
            defaultModel: configuredModel,
            completedReportJobs,
            reports,
        })

        const summary = buildUsageSummary({ reports, transcriptions, model, billingCurrency, completedReportJobs, usageMarkupPercent, customerCohort })

        return NextResponse.json({
            success: true,
            enabled,
            domainKey,
            summary: {
                ...summary,
                value: summarizeUsageValue(domainSettings?.usageValue, summary.roundedMonthlyCost, domainKey),
            },
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load AI usage summary' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}